/**
 * The ledger — database-bound half.
 *
 * The hash format itself lives in ledger-core.ts, which has no dependencies so
 * it can be tested (`npm run verify:ledger`) and reimplemented by a third party
 * who wants to check our arithmetic. This file is the part that talks to
 * Postgres: appending an event to a batch's chain, and verifying a stored chain.
 */

import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { ANCHORED_KINDS, custodyEvents, outbox } from "@/db/schema";
import {
  type CanonicalEvent,
  type ChainCheck,
  canonicalise,
  hashEvent,
  haversineMetres,
  round6,
  saltedRef as saltedRefWith,
  sha256,
  verifyChainOf,
} from "./ledger-core";

export { canonicalise, hashEvent, haversineMetres, sha256, verifyChainOf };
export type { CanonicalEvent, ChainCheck };

/**
 * Every write here must be able to run inside a caller's transaction — a batch
 * and its first three events either all land or none do. So the handle type is
 * the database OR a transaction, derived from Drizzle rather than hand-written
 * so it stays correct across upgrades.
 */
type Database = NodePgDatabase<typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Db = Database | Transaction;

type EventKind = (typeof schema.eventKind.enumValues)[number];

/** Reads the salt from the environment. See ledger-core for why it cannot rotate. */
export function saltedRef(id: string): string {
  return saltedRefWith(id, process.env.LEDGER_SALT ?? "");
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
      ? { lat: round6(input.geo.lat), lng: round6(input.geo.lng), acc: input.geo.accuracy ?? null }
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

/**
 * Loads a batch's chain and recomputes it.
 *
 * The public verify page runs this on every request. It deliberately rebuilds
 * each digest from the stored fields rather than trusting the stored `hash`
 * column — that is the difference between "our database says this is fine" and
 * "here is the arithmetic".
 */
export async function verifyChain(db: Db, batchId: string): Promise<ChainCheck> {
  const rows = await db
    .select()
    .from(custodyEvents)
    .where(eq(custodyEvents.batchId, batchId))
    .orderBy(custodyEvents.seq);

  const events: CanonicalEvent[] = rows.map((e) => ({
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
  }));

  return verifyChainOf(
    events,
    rows.map((e) => e.hash),
  );
}
