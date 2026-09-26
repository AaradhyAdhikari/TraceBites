/**
 * One-time codes — the database half.
 *
 * Decisions live in otp-core.ts and are tested without a database. This file
 * stores challenges, counts attempts, enforces the send limit, and delivers the
 * code. Nothing here decides whether a code is valid.
 */

import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { otpChallenges } from "@/db/schema";
import {
  type Evaluation,
  MAX_ATTEMPTS,
  SEND_WINDOW_SECONDS,
  canSend,
  evaluate,
  expiryFrom,
  generateCode,
  hashCode,
} from "./otp-core";

function pepper(): string {
  const p = process.env.OTP_PEPPER ?? process.env.SESSION_SECRET;
  if (!p) throw new Error("OTP_PEPPER is not set — refusing to issue codes");
  return p;
}

export type Purpose = "signin" | "signup";

export interface SendResult {
  sent: boolean;
  /** Present only outside production, so local development needs no gateway. */
  devCode?: string;
  message?: string;
}

/**
 * Issues a code for a phone number.
 *
 * Any live challenge for that phone is consumed first: leaving several valid at
 * once multiplies an attacker's chances by the number outstanding, and lets the
 * attempt cap be sidestepped by requesting a fresh code after every few guesses.
 */
export async function issueCode(phone: string, purpose: Purpose = "signin"): Promise<SendResult> {
  const windowStart = new Date(Date.now() - SEND_WINDOW_SECONDS * 1000);

  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(otpChallenges)
    .where(and(eq(otpChallenges.phone, phone), gte(otpChallenges.createdAt, windowStart)));

  if (!canSend(n)) {
    return { sent: false, message: "Too many codes requested. Try again in a few minutes." };
  }

  await db
    .update(otpChallenges)
    .set({ consumedAt: new Date() })
    .where(and(eq(otpChallenges.phone, phone), isNull(otpChallenges.consumedAt)));

  const code = generateCode();
  await db.insert(otpChallenges).values({
    phone,
    codeHash: hashCode(code, phone, pepper()),
    purpose,
    expiresAt: expiryFrom(),
  });

  await deliver(phone, code);

  // Never returned in production — that would put the code in the HTTP response,
  // which defeats the point of sending it out of band.
  return process.env.NODE_ENV === "production" ? { sent: true } : { sent: true, devCode: code };
}

/**
 * Delivery.
 *
 * Phase 5 replaces the console with an SMS gateway. The seam is deliberately
 * this narrow: verification is already real, so only this function is still
 * pretending.
 */
async function deliver(phone: string, code: string): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("No SMS gateway is configured — refusing to pretend a code was sent");
  }
  console.log(`\n  [dev] code for ${phone}: ${code}\n`);
}

export interface VerifyResult extends Evaluation {
  purpose: Purpose | null;
}

/**
 * Checks a submitted code against the newest challenge for that phone.
 *
 * The attempt counter is incremented before the verdict is returned, so a
 * client that abandons the request mid-flight still pays for the guess.
 */
export async function verifyCode(phone: string, submitted: string): Promise<VerifyResult> {
  const [challenge] = await db
    .select()
    .from(otpChallenges)
    .where(eq(otpChallenges.phone, phone))
    .orderBy(desc(otpChallenges.createdAt))
    .limit(1);

  if (!challenge) {
    // Same wording as a wrong code: whether a challenge exists for a number is
    // itself information about whether that number has an account.
    return {
      outcome: "mismatch",
      countsAsAttempt: false,
      message: "That code is not right.",
      purpose: null,
    };
  }

  const result = evaluate(
    {
      phone: challenge.phone,
      codeHash: challenge.codeHash,
      expiresAt: challenge.expiresAt,
      attempts: challenge.attempts,
      consumedAt: challenge.consumedAt,
    },
    submitted,
    pepper(),
  );

  if (result.countsAsAttempt) {
    await db
      .update(otpChallenges)
      .set({ attempts: challenge.attempts + 1 })
      .where(eq(otpChallenges.id, challenge.id));
  }

  if (result.outcome === "ok") {
    // Spend it. A correct code must not work twice.
    await db
      .update(otpChallenges)
      .set({ consumedAt: new Date() })
      .where(eq(otpChallenges.id, challenge.id));
  }

  return { ...result, purpose: challenge.purpose as Purpose };
}

export { MAX_ATTEMPTS };
