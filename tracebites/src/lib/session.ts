/**
 * Sessions.
 *
 * Phone + OTP, because a farmer is far more likely to have a phone number than
 * an email address. Codes are issued and verified in lib/otp.ts: hashed,
 * peppered, expiring, attempt-limited and single-use. Only delivery is still
 * a console line — an SMS gateway is the one remaining seam.
 *
 * The cookie holds a signed { userId, orgId, role } — signed, not encrypted, so
 * it is tamper-evident but never trusted for authorisation on its own: every
 * query re-checks membership against the database.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { memberships, organizations, users } from "@/db/schema";

const COOKIE = "cs_session";
const MAX_AGE = 60 * 60 * 24 * 30;

export interface Session {
  userId: string;
  orgId: string;
  role: string;
}

/**
 * The session signing key.
 *
 * Deliberately NOT the ledger salt. Those two secrets have opposite lifetimes:
 * LEDGER_SALT can never rotate, because every past event's actor reference was
 * hashed with it and rotating breaks verification forever. A session key must
 * rotate the moment it might have leaked. One value cannot do both jobs — using
 * the salt here meant a suspected session-key leak was unfixable.
 */
function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET is not set — refusing to sign sessions in production");
  }
  return "dev-only-session-secret";
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

function seal(s: Session): string {
  const payload = Buffer.from(JSON.stringify(s)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function unseal(raw: string): Session | null {
  const [payload, sig] = raw.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Session;
  } catch {
    return null;
  }
}

/* --------------------------------------------------------------- OTP */

/*
 * Code issuing and verification now live in lib/otp.ts, backed by
 * otp-core.ts and its tests. The previous version here generated a code,
 * printed it, and accepted any six digits.
 */

/* ----------------------------------------------------------- sessions */

export async function signIn(phone: string): Promise<Session | null> {
  const [user] = await db.select().from(users).where(eq(users.phone, phone)).limit(1);
  if (!user) return null;

  const [m] = await db
    .select({ orgId: memberships.orgId, role: memberships.role })
    .from(memberships)
    .where(eq(memberships.userId, user.id))
    .limit(1);
  if (!m) return null;

  const session: Session = { userId: user.id, orgId: m.orgId, role: m.role };
  const jar = await cookies();
  jar.set(COOKIE, seal(session), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
  return session;
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value;
  if (!raw) return null;

  const s = unseal(raw);
  if (!s) return null;

  // The cookie is a hint, not an authorisation. Re-check the membership every time:
  // a revoked member must lose access on their next request, not on cookie expiry.
  const [live] = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.userId, s.userId), eq(memberships.orgId, s.orgId)))
    .limit(1);

  return live ? { ...s, role: live.role } : null;
}

export async function requireFarmer() {
  const session = await getSession();
  if (!session || session.role !== "farmer") return null;

  const [row] = await db
    .select({
      user: users,
      org: organizations,
    })
    .from(users)
    .innerJoin(organizations, eq(organizations.id, session.orgId))
    .where(eq(users.id, session.userId))
    .limit(1);

  return row ? { session, user: row.user, org: row.org } : null;
}
