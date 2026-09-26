/**
 * One-time code self-test.  `npm run verify:otp`
 *
 * No database, no SMS gateway. This is the file that has to stay green, because
 * everything the project says about who may write what rests on the code in it
 * actually being checked.
 */

import {
  CODE_LENGTH,
  type ChallengeState,
  MAX_ATTEMPTS,
  MAX_SENDS_PER_WINDOW,
  canSend,
  evaluate,
  expiryFrom,
  generateCode,
  hashCode,
  hashesMatch,
  isWellFormed,
  normalisePhone,
} from "../src/lib/otp-core";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const PEPPER = "test-pepper";
const PHONE = "9876500001";
const NOW = new Date("2026-09-26T12:00:00Z");

function challenge(code: string, over: Partial<ChallengeState> = {}): ChallengeState {
  return {
    phone: PHONE,
    codeHash: hashCode(code, PHONE, PEPPER),
    expiresAt: expiryFrom(NOW),
    attempts: 0,
    consumedAt: null,
    ...over,
  };
}

/* ------------------------------------------------------------- generation */

console.log("\ncode generation");

{
  const codes = Array.from({ length: 500 }, generateCode);
  check("every code is six digits", codes.every(isWellFormed));
  check(
    "leading zeros are preserved",
    codes.every((c) => c.length === CODE_LENGTH),
    "a truncated 000042 would shrink the search space enormously",
  );
  check("codes are not all identical", new Set(codes).size > 400, `${new Set(codes).size} distinct`);
  // A predictable generator is the classic OTP bug; this catches a constant or
  // a sequence, though not a weak PRNG on its own.
  const ascending = codes.every((c, i) => i === 0 || Number(c) >= Number(codes[i - 1]));
  check("codes are not sequential", !ascending);
}

/* ------------------------------------------------------------- hashing */

console.log("\nhashing");

check("same inputs hash the same", hashCode("123456", PHONE, PEPPER) === hashCode("123456", PHONE, PEPPER));
check("the raw code does not survive in the hash", !hashCode("123456", PHONE, PEPPER).includes("123456"));
check(
  "a code is bound to its phone",
  hashCode("123456", PHONE, PEPPER) !== hashCode("123456", "9876500002", PEPPER),
  "otherwise a code seen on one number could be replayed on another",
);
check("a different pepper gives a different hash", hashCode("123456", PHONE, PEPPER) !== hashCode("123456", PHONE, "other"));

{
  let threw = false;
  try {
    hashCode("123456", PHONE, "");
  } catch {
    threw = true;
  }
  check("an empty pepper is refused rather than silently used", threw);
}

check("hashesMatch accepts equal hashes", hashesMatch("abc123", "abc123"));
check("hashesMatch rejects different hashes", !hashesMatch("abc123", "abc124"));
check("hashesMatch rejects different lengths without throwing", !hashesMatch("abc", "abcd"));

/* ------------------------------------------------------------- acceptance */

console.log("\nacceptance");

{
  const e = evaluate(challenge("123456"), "123456", PEPPER, NOW);
  check("the right code is accepted", e.outcome === "ok", e.outcome);
}
{
  const e = evaluate(challenge("123456"), "999999", PEPPER, NOW);
  check("a wrong code is rejected", e.outcome === "mismatch", e.outcome);
  check("a wrong code counts against the attempt limit", e.countsAsAttempt);
}
{
  const e = evaluate(challenge("123456"), "12345", PEPPER, NOW);
  check("a short code is malformed, not a mismatch", e.outcome === "malformed", e.outcome);
  check("a malformed code does not burn an attempt", !e.countsAsAttempt);
}
{
  const e = evaluate(challenge("123456"), "abcdef", PEPPER, NOW);
  check("letters are malformed", e.outcome === "malformed", e.outcome);
}

/* ------------------------------------------------------------- expiry */

console.log("\nexpiry");

{
  const justBefore = new Date(expiryFrom(NOW).getTime() - 1000);
  const e = evaluate(challenge("123456"), "123456", PEPPER, justBefore);
  check("a code one second before expiry still works", e.outcome === "ok", e.outcome);
}
{
  const atExpiry = expiryFrom(NOW);
  const e = evaluate(challenge("123456"), "123456", PEPPER, atExpiry);
  check("a code is dead exactly at its expiry", e.outcome === "expired", e.outcome);
}
{
  const later = new Date(expiryFrom(NOW).getTime() + 60_000);
  const e = evaluate(challenge("123456"), "123456", PEPPER, later);
  check("a correct but expired code is refused", e.outcome === "expired", e.outcome);
  check("an expired attempt does not burn an attempt", !e.countsAsAttempt);
}

/* --------------------------------------------------------- single use */

console.log("\nsingle use and attempt limit");

{
  const used = challenge("123456", { consumedAt: new Date(NOW.getTime() - 1000) });
  const e = evaluate(used, "123456", PEPPER, NOW);
  check("a consumed code cannot be reused", e.outcome === "already_used", e.outcome);
}
{
  const spent = challenge("123456", { attempts: MAX_ATTEMPTS });
  const e = evaluate(spent, "123456", PEPPER, NOW);
  check(
    "the right code is refused once attempts are exhausted",
    e.outcome === "too_many_attempts",
    e.outcome,
  );
}
{
  const nearly = challenge("123456", { attempts: MAX_ATTEMPTS - 1 });
  const e = evaluate(nearly, "123456", PEPPER, NOW);
  check("the final attempt is still allowed to succeed", e.outcome === "ok", e.outcome);
}

/* ------------------------------------------------------- disclosure */

console.log("\nwhat the user is told");

{
  const wrong = evaluate(challenge("123456"), "999999", PEPPER, NOW);
  const expired = evaluate(
    challenge("123456"),
    "123456",
    PEPPER,
    new Date(expiryFrom(NOW).getTime() + 1),
  );
  check("every refusal carries a message", wrong.message.length > 0 && expired.message.length > 0);
  check(
    "no message ever contains a code",
    !wrong.message.includes("123456") && !expired.message.includes("123456"),
  );
}

/* --------------------------------------------------------- send limits */

console.log("\nsend rate limit");

check("a first code may be sent", canSend(0));
check("sending is allowed up to the limit", canSend(MAX_SENDS_PER_WINDOW - 1));
check("sending is refused at the limit", !canSend(MAX_SENDS_PER_WINDOW));
check("sending is refused beyond the limit", !canSend(MAX_SENDS_PER_WINDOW + 5));

/* --------------------------------------------------------- phone format */

console.log("\nphone normalisation");

check("a plain ten-digit number passes", normalisePhone("9876500001") === "9876500001");
check("a +91 prefix is stripped", normalisePhone("+919876500001") === "9876500001");
check("a bare 91 prefix is stripped", normalisePhone("919876500001") === "9876500001");
check("a leading zero is stripped", normalisePhone("09876500001") === "9876500001");
check("spaces and dashes are ignored", normalisePhone("+91 98765-00001") === "9876500001");
check(
  "every spelling maps to one identity",
  new Set(
    ["9876500001", "+919876500001", "09876500001", "+91 98765 00001"].map((p) => normalisePhone(p)),
  ).size === 1,
  "otherwise one person is several accounts, each with its own rate-limit budget",
);
check("a landline-style number is rejected", normalisePhone("1234567890") === null);
check("too few digits is rejected", normalisePhone("98765") === null);
check("gibberish is rejected", normalisePhone("hello") === null);

/* ---------------------------------------------------------------- report */

console.log(
  `\n${failures.length === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failures.length} failed\n`,
);
if (failures.length) {
  for (const f of failures) console.log(`  · ${f}`);
  process.exit(1);
}
