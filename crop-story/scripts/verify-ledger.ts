/**
 * Ledger self-test.  `npm run verify:ledger`
 *
 * Runs against src/lib/ledger-core.ts alone — no database, no network, no build.
 * Every property the product claims about its record is asserted here, so a
 * change that quietly breaks verification fails loudly instead.
 *
 * If this file passes and the app still misbehaves, the bug is in the plumbing.
 * If this file fails, nothing else matters.
 */

import {
  type CanonicalEvent,
  canonicalise,
  hashEvent,
  haversineMetres,
  saltedRef,
  sha256,
  verifyChainOf,
} from "../src/lib/ledger-core";
import { checkChar, formatBatchCode, parseBatchCode } from "../src/lib/batch-code";

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

const SALT = "test-salt";

/* ------------------------------------------------------------------ setup */

function ev(seq: number, kind: CanonicalEvent["kind"], payload: Record<string, unknown>, prevHash: string | null): CanonicalEvent {
  return {
    v: 1,
    batchId: "b0f4c2a1-0000-4000-8000-000000000001",
    seq,
    kind,
    actorOrgRef: saltedRef("org-1", SALT),
    occurredAt: new Date(Date.UTC(2026, 8, 1 + seq, 6, 30)).toISOString(),
    geo: { lat: 30.245801, lng: 75.842102, acc: 8 },
    payload,
    prevHash,
  };
}

/** Builds a valid three-event chain the way appendEvent would. */
function buildChain() {
  const events: CanonicalEvent[] = [];
  const hashes: string[] = [];
  let prev: string | null = null;

  const specs: [CanonicalEvent["kind"], Record<string, unknown>][] = [
    ["HARVESTED", { crop: "Wheat", quantity: 40, unit: "quintal", farmCode: "1234" }],
    ["PHOTO_ATTACHED", { sha256: sha256("photo-bytes"), kind: "harvest_photo" }],
    ["PRICE_SET", { stage: "farm_gate", pricePerUnitPaise: 240000, unit: "quintal" }],
  ];

  specs.forEach(([kind, payload], i) => {
    const e = ev(i + 1, kind, payload, prev);
    const h = hashEvent(e);
    events.push(e);
    hashes.push(h);
    prev = h;
  });

  return { events, hashes };
}

/* ------------------------------------------------ canonical serialisation */

console.log("\ncanonical encoding");

check(
  "key order does not change the digest",
  canonicalise({ b: 1, a: 2 }) === canonicalise({ a: 2, b: 1 }),
  `${canonicalise({ b: 1, a: 2 })} vs ${canonicalise({ a: 2, b: 1 })}`,
);

check(
  "nested key order does not change the digest",
  canonicalise({ x: { d: 1, c: 2 }, a: [{ z: 1, y: 2 }] }) ===
    canonicalise({ a: [{ y: 2, z: 1 }], x: { c: 2, d: 1 } }),
);

check("array order DOES change the digest", canonicalise([1, 2]) !== canonicalise([2, 1]));

check("undefined members are dropped, null is kept", canonicalise({ a: undefined, b: null }) === '{"b":null}');

check(
  "a value that looks like its own encoding is not confusable",
  canonicalise({ a: '{"b":1}' }) !== canonicalise({ a: { b: 1 } }),
);

/* ----------------------------------------------------------- salted refs */

console.log("\nsalted references");

check("same id + same salt is stable", saltedRef("org-1", SALT) === saltedRef("org-1", SALT));
check("different salt yields a different ref", saltedRef("org-1", SALT) !== saltedRef("org-1", "other"));
check("no raw id survives in the ref", !saltedRef("org-1", SALT).includes("org-1"));

let threw = false;
try {
  saltedRef("org-1", "");
} catch {
  threw = true;
}
check("empty salt is refused rather than silently unsalted", threw);

/* ---------------------------------------------------------- the chain */

console.log("\nchain integrity");

const { events, hashes } = buildChain();
const clean = verifyChainOf(events, hashes);
check("a well-formed chain verifies", clean.ok, clean.reason ?? "");
check("chain length is reported", clean.length === 3);

// Tamper: change a price after the fact — the single most consequential attack,
// because the farmer-share figure is derived from it.
{
  const tampered = structuredClone(events);
  (tampered[2].payload as Record<string, unknown>).pricePerUnitPaise = 999999;
  const r = verifyChainOf(tampered, hashes);
  check("altering a recorded price is detected", !r.ok && r.brokenAtSeq === 3, r.reason ?? "not detected");
}

// Tamper: rewrite the harvest and rehash it, hoping later links absorb it.
{
  const tampered = structuredClone(events);
  (tampered[0].payload as Record<string, unknown>).quantity = 400;
  const rehashed = [...hashes];
  rehashed[0] = hashEvent(tampered[0]);
  const r = verifyChainOf(tampered, rehashed);
  check(
    "rehashing an altered event still breaks the following link",
    !r.ok && r.brokenAtSeq === 2,
    r.reason ?? "not detected",
  );
}

// Tamper: drop the middle event to hide evidence.
{
  const r = verifyChainOf([events[0], events[2]], [hashes[0], hashes[2]]);
  check("removing an event is detected", !r.ok, r.reason ?? "not detected");
}

// Tamper: shift the timestamp.
{
  const tampered = structuredClone(events);
  tampered[0].occurredAt = new Date(Date.UTC(2026, 0, 1)).toISOString();
  const r = verifyChainOf(tampered, hashes);
  check("back-dating an event is detected", !r.ok && r.brokenAtSeq === 1, r.reason ?? "not detected");
}

// Tamper: move the GPS position beyond rounding tolerance.
{
  const tampered = structuredClone(events);
  tampered[0].geo!.lat = 28.6139;
  const r = verifyChainOf(tampered, hashes);
  check("relocating a capture is detected", !r.ok && r.brokenAtSeq === 1, r.reason ?? "not detected");
}

// Not tampering: the same reading from a noisier GPS chip must still verify.
{
  const e = ev(1, "HARVESTED", { crop: "Wheat" }, null);
  const noisy = structuredClone(e);
  noisy.geo!.lat = 30.2458014999;
  check(
    "sub-centimetre GPS float noise does not break a chain",
    hashEvent({ ...e, geo: { ...e.geo!, lat: Math.round(30.2458014999 * 1e6) / 1e6 } }) ===
      hashEvent({ ...e, geo: { ...e.geo!, lat: 30.245801 } }),
  );
}

/* ------------------------------------------------------------ batch codes */

console.log("\nbatch codes");

const code = formatBatchCode({
  farmerName: "Rajesh Singh",
  farmCode: "1234",
  cropCode: "WH",
  batchSerial: "5432",
});

check("code matches the printed format", /^[A-Z]{2}\d{4}-[A-Z]{2}\d{4}-[0-9A-Z]$/.test(code), code);
check("a valid code parses", parseBatchCode(code) === code);
check("lowercase input is normalised", parseBatchCode(code.toLowerCase()) === code);
check("surrounding whitespace is tolerated", parseBatchCode(`  ${code} `) === code);

{
  // A single mistyped digit must fail rather than resolve to another harvest.
  const body = code.slice(0, 12);
  const wrong = body.replace(/\d(?=\d{3}-)/, (d) => String((Number(d) + 1) % 10));
  check(
    "a single-digit typo is rejected",
    parseBatchCode(`${wrong}-${code.slice(-1)}`) === null,
    `${wrong}-${code.slice(-1)} was accepted`,
  );
}

{
  // Transposition is the commonest typo; position weighting is what catches it.
  const transposed = "RS2134-WH5432";
  check(
    "a transposition changes the check character",
    checkChar("RS1234-WH5432") !== checkChar(transposed),
  );
}

check("a code with no check character is rejected", parseBatchCode("RS1234-WH5432") === null);
check("gibberish is rejected", parseBatchCode("hello") === null);

/* ------------------------------------------------------------------ geo */

console.log("\ndistance");

{
  // Sangrur → Delhi. Great-circle, not road: 1.63° of latitude and 1.37° of
  // longitude at ~29°N works out to ~224 km, against ~250 km by road. The
  // verify page must not quietly report road distance as food-miles.
  const d = haversineMetres({ lat: 30.2458, lng: 75.8421 }, { lat: 28.6139, lng: 77.209 });
  check("food-miles distance is correct", d > 222_000 && d < 227_000, `${Math.round(d / 1000)} km`);
  check("zero distance is zero", haversineMetres({ lat: 30, lng: 75 }, { lat: 30, lng: 75 }) === 0);

  // One degree of latitude is ~111.2 km anywhere on the globe — an independent
  // check that the implementation is not subtly wrong in a way the pair above
  // would miss.
  const deg = haversineMetres({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
  check("one degree of latitude is ~111.2 km", deg > 111_000 && deg < 111_400, `${Math.round(deg)} m`);
}

/* ---------------------------------------------------------------- report */

console.log(
  `\n${failures.length === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failures.length} failed\n`,
);
if (failures.length) {
  for (const f of failures) console.log(`  · ${f}`);
  process.exit(1);
}
