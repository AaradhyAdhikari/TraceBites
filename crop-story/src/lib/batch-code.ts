/**
 * Batch codes.
 *
 * The SIH deck defines the printed code as:
 *   farmer initials + 4-digit farm ID + "-" + 2 crop letters + 4-digit batch ID
 * e.g. RS1234-WH5432
 *
 * That code is good at what it is for — a human can read it off a crate and type
 * it into a phone. It is bad as a key: two Rajesh Singhs collide, it leaks a name,
 * and it is guessable, so anyone can enumerate their neighbour's harvests.
 *
 * So: the code is a LABEL, the row's uuid is the KEY, and we append a check
 * character. A single mistyped digit then fails loudly instead of quietly
 * resolving to a stranger's harvest — which on a food-safety recall matters.
 */

const ALPHABET = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I or O — they read as 1 and 0
const MOD = ALPHABET.length; // 34

/** Damm-style check character over the code's alphanumerics. */
export function checkChar(body: string): string {
  const chars = body.toUpperCase().replace(/[^0-9A-Z]/g, "");
  let sum = 0;
  for (let i = 0; i < chars.length; i++) {
    const v = ALPHABET.indexOf(chars[i]);
    if (v < 0) continue;
    // Position-weighted so transpositions (the commonest typo) change the result.
    sum += v * (i % 2 === 0 ? 2 : 3);
  }
  return ALPHABET[sum % MOD];
}

export interface BatchCodeParts {
  farmerName: string;
  farmCode: string; // 4 digits
  cropCode: string; // 2 letters
  batchSerial: string; // 4 digits
}

export function formatBatchCode(parts: BatchCodeParts): string {
  const initials = parts.farmerName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("")
    .padEnd(2, "X");

  const body = `${initials}${parts.farmCode}-${parts.cropCode.toUpperCase()}${parts.batchSerial}`;
  return `${body}-${checkChar(body)}`;
}

/** Returns the normalised code, or null when the check character disagrees. */
export function parseBatchCode(input: string): string | null {
  const code = input.trim().toUpperCase().replace(/\s+/g, "");
  const m = code.match(/^([A-Z]{2}\d{4}-[A-Z]{2}\d{4})-([0-9A-Z])$/);
  if (!m) return null;
  return checkChar(m[1]) === m[2] ? code : null;
}

export function randomSerial(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

/** The URL printed as a QR code. Scanning it opens the public verify page. */
export function verifyUrl(code: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/v/${code}`;
}
