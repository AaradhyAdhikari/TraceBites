/**
 * Ledger core — the specification, with no dependencies.
 *
 * This file defines exactly how a custody event becomes a hash. It deliberately
 * imports nothing but `node:crypto`, for three reasons:
 *
 *   1. It is the part a third party must be able to reimplement. A consumer who
 *      wants to check our arithmetic should be able to port ~40 lines to Python
 *      and get identical digests — not link against our ORM.
 *   2. It can be tested without a database, a network, or a build step
 *      (`npm run verify:ledger`).
 *   3. Coupling the hash format to the ORM is how hash formats accidentally
 *      change. Nothing in here should ever need to change again.
 *
 * Treat this file as frozen. Adding a field to `CanonicalEvent` invalidates
 * every event ever written; new data belongs inside `payload`.
 */

import { createHash } from "node:crypto";

/* ------------------------------------------------------ canonical encoding */

/**
 * Deterministic JSON: object keys sorted at every depth, no whitespace,
 * `undefined` members dropped.
 *
 * Two servers, two languages, two years apart must produce identical bytes for
 * the same event, or verification breaks for everyone. `JSON.stringify` alone
 * does not promise this — its key order follows insertion order, so the same
 * event assembled by a different code path would hash differently.
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
 * Six decimal places ≈ 11 cm. Enough to place a person in a field, and it keeps
 * the digest stable against float noise from different GPS chips reporting the
 * same position.
 */
export function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/* -------------------------------------------------------------- references */

/**
 * Public reference for an organisation or person.
 *
 * Names and phone numbers never touch the chain. The DPDP Act 2023 grants a
 * right to erasure that an immutable ledger cannot honour, so we anchor a salted
 * hash instead: deleting the salt renders the on-chain value permanently
 * unlinkable to anyone. The chain stays intact and the obligation is met.
 *
 * Consequence worth stating plainly: LEDGER_SALT is not a rotatable secret.
 * Losing it breaks verification for every event ever written.
 */
export function saltedRef(id: string, salt: string): string {
  if (!salt) throw new Error("LEDGER_SALT is not set — refusing to write an unsalted reference");
  return sha256(`${salt}:${id}`);
}

/* ------------------------------------------------------------- the envelope */

export type EventKindName =
  | "HARVESTED"
  | "PHOTO_ATTACHED"
  | "CERT_LINKED"
  | "QUALITY_GRADED"
  | "PRICE_SET"
  | "CUSTODY_TRANSFERRED"
  | "BATCH_SPLIT"
  | "COLD_CHAIN_PING"
  | "IN_TRANSIT"
  | "LISTED"
  | "SOLD"
  | "RATED"
  | "INSPECTED"
  | "RECALLED";

/** The exact bytes that get hashed. Frozen — see the file header. */
export interface CanonicalEvent {
  v: 1;
  batchId: string;
  seq: number;
  kind: EventKindName;
  actorOrgRef: string;
  /** ISO 8601, UTC, millisecond precision. */
  occurredAt: string;
  geo: { lat: number; lng: number; acc: number | null } | null;
  payload: Record<string, unknown>;
  prevHash: string | null;
}

export function hashEvent(e: CanonicalEvent): string {
  return sha256(canonicalise(e));
}

/* ------------------------------------------------------------ verification */

export interface ChainCheck {
  ok: boolean;
  length: number;
  brokenAtSeq: number | null;
  reason: string | null;
}

/**
 * Recomputes a chain from its events and reports the first break.
 *
 * Deliberately recomputes every digest rather than trusting the stored `hash`.
 * That is the whole difference between "our database says this is fine" and
 * "here is the arithmetic, check it yourself" — and it is why this function
 * takes plain data rather than a database handle.
 */
export function verifyChainOf(events: CanonicalEvent[], storedHashes: string[]): ChainCheck {
  if (events.length !== storedHashes.length) {
    return { ok: false, length: events.length, brokenAtSeq: null, reason: "event/hash count mismatch" };
  }

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
    if (hashEvent(e) !== storedHashes[i]) {
      return {
        ok: false,
        length: events.length,
        brokenAtSeq: e.seq,
        reason: "content does not match its hash — this event was altered after it was written",
      };
    }
    prevHash = storedHashes[i];
  }

  return { ok: true, length: events.length, brokenAtSeq: null, reason: null };
}

/* -------------------------------------------------------------------- geo */

/** Metres between two points. Source of measured food-miles, not assumed ones. */
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
