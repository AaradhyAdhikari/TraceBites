/**
 * One-time codes — the decision logic, with no dependencies.
 *
 * Kept pure for the same reason as ledger-core: this is security-critical, and
 * security-critical code that needs a database and an SMS gateway to exercise
 * gets tested once and never again. Everything here runs in `npm run verify`.
 *
 * What this replaced: a code was generated, printed, and never checked — any six
 * digits signed you in, so a phone number was a login.
 */

import { createHash, randomInt, timingSafeEqual } from "node:crypto";

export const CODE_LENGTH = 6;
export const TTL_SECONDS = 5 * 60;
export const MAX_ATTEMPTS = 5;
/** A phone may not request more than this many codes inside the window. */
export const MAX_SENDS_PER_WINDOW = 3;
export const SEND_WINDOW_SECONDS = 15 * 60;

/**
 * A cryptographically random code.
 *
 * `randomInt` rather than `Math.random`, which is seeded predictably and would
 * make codes guessable from a handful of observations. Padded, so 000042 stays
 * six digits — truncating it to "42" would shrink the space by four orders of
 * magnitude for exactly the codes an attacker tries first.
 */
export function generateCode(): string {
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0");
}

/**
 * Codes are stored hashed, and bound to the phone they were issued for.
 *
 * Binding matters: without the phone in the hash, a code observed for one number
 * could be replayed against another account whose live code happens to match.
 * With ~10^6 codes and many concurrent challenges, that collision is not
 * hypothetical.
 */
export function hashCode(code: string, phone: string, pepper: string): string {
  if (!pepper) throw new Error("OTP pepper is not set — refusing to hash a code unpeppered");
  return createHash("sha256").update(`${pepper}:${phone}:${code}`, "utf8").digest("hex");
}

/** Constant-time comparison, so response timing does not leak the digits. */
export function hashesMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

export function isWellFormed(code: string): boolean {
  return new RegExp(`^\\d{${CODE_LENGTH}}$`).test(code);
}

/* ------------------------------------------------------------- evaluation */

export interface ChallengeState {
  phone: string;
  codeHash: string;
  expiresAt: Date;
  attempts: number;
  consumedAt: Date | null;
}

export type Outcome =
  | "ok"
  | "malformed"
  | "expired"
  | "already_used"
  | "too_many_attempts"
  | "mismatch";

export interface Evaluation {
  outcome: Outcome;
  /** Whether this attempt should increment the counter. */
  countsAsAttempt: boolean;
  /** What the user is told. Deliberately identical for mismatch and expiry. */
  message: string;
}

/**
 * Decides whether a submitted code is accepted.
 *
 * Checks run in this order deliberately: a consumed or expired challenge is
 * rejected before the code is compared at all, so a correct-but-stale code
 * cannot be distinguished from a wrong one by watching which path runs.
 */
export function evaluate(
  state: ChallengeState,
  submitted: string,
  pepper: string,
  now: Date = new Date(),
): Evaluation {
  if (!isWellFormed(submitted)) {
    return { outcome: "malformed", countsAsAttempt: false, message: "Enter the 6-digit code." };
  }
  if (state.consumedAt !== null) {
    return {
      outcome: "already_used",
      countsAsAttempt: false,
      message: "That code has already been used. Request a new one.",
    };
  }
  if (state.attempts >= MAX_ATTEMPTS) {
    return {
      outcome: "too_many_attempts",
      countsAsAttempt: false,
      message: "Too many attempts. Request a new code.",
    };
  }
  if (now.getTime() >= state.expiresAt.getTime()) {
    return {
      outcome: "expired",
      countsAsAttempt: false,
      message: "That code has expired. Request a new one.",
    };
  }

  const submittedHash = hashCode(submitted, state.phone, pepper);
  if (!hashesMatch(submittedHash, state.codeHash)) {
    return {
      outcome: "mismatch",
      countsAsAttempt: true,
      message: "That code is not right.",
    };
  }

  return { outcome: "ok", countsAsAttempt: true, message: "" };
}

/** Whether another code may be sent, given how many went out in the window. */
export function canSend(recentSends: number): boolean {
  return recentSends < MAX_SENDS_PER_WINDOW;
}

export function expiryFrom(now: Date = new Date()): Date {
  return new Date(now.getTime() + TTL_SECONDS * 1000);
}

/* ------------------------------------------------------------------ phone */

/**
 * Normalises an Indian mobile number to a single stored form.
 *
 * Without this, 9876500001, +919876500001 and 09876500001 are three different
 * accounts for one person — and three separate rate-limit buckets, which is a
 * hole rather than an inconvenience.
 */
export function normalisePhone(input: string): string | null {
  const digits = input.replace(/[\s\-()]/g, "").replace(/^\+/, "");
  const local = digits.replace(/^91/, "").replace(/^0/, "");
  return /^[6-9]\d{9}$/.test(local) ? local : null;
}
