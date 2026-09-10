/**
 * The ledger.
 *
 * Everything the product claims rests on one property: an event, once written,
 * cannot be altered without the alteration being detectable by someone who does
 * not trust us. That requires three things, in this order:
 *
 *   1. a CANONICAL serialisation, so the same event always hashes the same way
 *      regardless of key order or how JSON.stringify felt that day;
 *   2. a CHAIN, so changing event 3 invalidates events 4..n as well;
 *   3. an ANCHOR on a public chain, so the chain head itself cannot be quietly
 *      rewritten by whoever holds the database.
 *
 * (1) and (2) live here. (3) lives in lib/chain.
 */

import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { ANCHORED_KINDS, custodyEvents, outbox } from "@/db/schema";

type Db = NodePgDatabase<typeof schema>;
type EventKind = (typeof schema.eventKind.enumValues)[number];

/* ------------------------------------------------------ canonical hashing */

/**
 * Deterministic JSON: object keys sorted at every depth, no whitespace.
 * Two servers, two languages, two years apart must produce identical bytes for
 * the same event or verification breaks for everyone.
 */
export function canonicalise(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalise).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalise(v)}`).join(",")}}`;
}

export function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Public reference for an organisation or person.
 *
 * Names and phone numbers never touch the chain. The DPDP Act 2023 gives a
 * person the right to erasure and an immutable ledger cannot honour it — so we
 * anchor a salted hash instead. Deleting the salt makes the on-chain value
 * permanently unlinkable to anyone: crypto-erasure. The chain stays intact and
 * the obligation is met.
 */
export function saltedRef(id: string): string {
  const salt = process.env.LEDGER_SALT;
  if (!salt) throw new Error("LEDGER_SALT is not set — refusing to write an unsalted reference");
  return sha256(`${salt}:${id}`);
}

/** The exact bytes that get hashed. Changing this shape breaks every past event. */
export interface CanonicalEvent {
  v: 1;
  batchId: string;
  seq: number;
  kind: EventKind;
  actorOrgRef: string;
  occurredAt: string; // ISO 8601, UTC, millisecond precision
  geo: { lat: number; lng: number; acc: number | null } | null;
  payload: Record<string, unknown>;
  prevHash: string | null;
}

export function hashEvent(e: CanonicalEvent): string {
  return sha256(canonicalise(e));
}

/* --------------------------------------------------------- append an event */

export interface AppendInput {
  batchId: string;
  kind: EventKind;
  actorOrgId: string;
  actorUserId?: string | null;
  payload: Record<string, unknown>;
  occurredAt?: Date;
  geo?: { lat: number; lng: number; accuracy?: number | null } | null;
  withinGeofence?: boolean | null;
}

/**
 * Appends one event to a batch's chain.
 *
 * Must be called inside a transaction. Takes a row lock on the batch so two
 * concurrent writers cannot claim the same seq — the unique index on
 * (batch_id, seq) would catch it anyway, but a lock turns a 500 into a wait.
 */
export async function appendEvent(tx: Db, input: AppendInput) {
  await tx.execute(sql`SELECT id FROM batches WHERE id = ${input.batchId} FOR UPDATE`);

  const [prev] = await tx
    .select({ seq: custodyEvents.seq, hash: custodyEvents.hash })
    .from(custodyEvents)
    .where(eq(custodyEvents.batchId, input.batchId))
    .orderBy(sql`${custodyEvents.seq} DESC`)
    .limit(1);

  const seq = (prev?.seq ?? 0) + 1;
  const prevHash = prev?.hash ?? null;
  const occurredAt = input.occurredAt ?? new Date();

  const canonical: CanonicalEvent = {
    v: 1,
    batchId: input.batchId,
    seq,
    kind: input.kind,
    actorOrgRef: saltedRef(input.actorOrgId),
    occurredAt: occurredAt.toISOString(),
    geo: input.geo
      ? {
          // Six decimals ≈ 11 cm. Enough for a field, and it keeps the hash
          // stable against float noise from different GPS chips.
          lat: round6(input.geo.lat),
          lng: round6(input.geo.lng),
          acc: input.geo.accuracy ?? null,
        }
      : null,
    payload: input.payload,
    prevHash,
  };

  const hash = hashEvent(canonical);

  const [row] = await tx
    .insert(custodyEvents)
    .values({
      batchId: input.batchId,
      seq,
      kind: input.kind,
      actorOrgId: input.actorOrgId,
      actorUserId: input.actorUserId ?? null,
      lat: input.geo?.lat ?? null,
      lng: input.geo?.lng ?? null,
      accuracyMetres: input.geo?.accuracy ?? null,
      withinGeofence: input.withinGeofence ?? null,
      payload: input.payload,
      occurredAt,
      prevHash,
      hash,
    })
    .returning();

  // Queue the chain write. The caller returns to the user immediately; a worker
  // carries this to Polygon and writes the tx hash back.
  await tx.insert(outbox).values({ eventId: row.id });

  return row;
}

export function isIndividuallyAnchored(kind: EventKind): boolean {
  return (ANCHORED_KINDS as readonly string[]).includes(kind);
}

/* ------------------------------------------------------------- verification */

export interface ChainCheck {
  ok: boolean;
  length: number;
  brokenAtSeq: number | null;
  reason: string | null;
}

/**
 * Recomputes a batch's whole chain from stored fields.
 *
 * The public verify page runs this on every request. It is the difference
 * between "our database says this is fine" and "here is the arithmetic, do it
 * yourself" — so it deliberately recomputes rather than trusting `hash`.
 */
export async function verifyChain(db: Db, batchId: string): Promise<ChainCheck> {
  const events = await db
    .select()
    .from(custodyEvents)
    .where(eq(custodyEvents.batchId, batchId))
    .orderBy(custodyEvents.seq);

  let prevHash: string | null = null;

  for (const [i, e] of events.entries()) {
    if (e.seq !== i + 1) {
      return { ok: false, length: events.length, brokenAtSeq: e.seq, reason: "gap in sequence" };
    }
    if (e.prevHash !== prevHash) {
      return {
        ok: false,
        length: events.length,
        brokenAtSeq: e.seq,
        reason: "previous-hash link does not match",
      };
    }

    const recomputed = hashEvent({
      v: 1,
      batchId: e.batchId,
      seq: e.seq,
      kind: e.kind,
      actorOrgRef: saltedRef(e.actorOrgId),
      occurredAt: e.occurredAt.toISOString(),
      geo:
        e.lat !== null && e.lng !== null
          ? { lat: round6(e.lat), lng: round6(e.lng), acc: e.accuracyMetres ?? null }
          : null,
      payload: e.payload,
      prevHash: e.prevHash,
    });

    if (recomputed !== e.hash) {
      return {
        ok: false,
        length: events.length,
        brokenAtSeq: e.seq,
        reason: "content does not match its hash — this event was altered after it was written",
      };
    }
    prevHash = e.hash;
  }

  return { ok: true, length: events.length, brokenAtSeq: null, reason: null };
}

/* ------------------------------------------------------------------ geo */

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Metres between two points. Used for geofencing and for computed food-miles. */
export function haversineMetres(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export { and, eq };
