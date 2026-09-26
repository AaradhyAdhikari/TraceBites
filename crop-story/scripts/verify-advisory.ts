/**
 * Advisory and earnings self-test.  `npm run verify:advisory`
 *
 * Runs against the pure modules only — no database, no network, no build.
 * These are the two places where a plausible-looking wrong answer would be
 * worst: sowing advice a farmer acts on, and money figures they plan around.
 */

import {
  CROP_RULES,
  type DailyForecast,
  adviseAll,
  adviseCrop,
  adviseIrrigation,
  nextSowingMonth,
} from "../src/lib/advisory";
import { type EarningsRow, farmerSharePercent, summariseEarnings } from "../src/lib/earnings";

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

/* ------------------------------------------------------------- forecasts */

function forecast(days: Partial<DailyForecast>[], startISO = "2026-11-10"): DailyForecast[] {
  const start = new Date(`${startISO}T00:00:00Z`);
  return days.map((d, i) => ({
    date: new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10),
    tempMaxC: d.tempMaxC ?? 22,
    tempMinC: d.tempMinC ?? 12,
    rainMm: d.rainMm ?? 0,
  }));
}

const wheat = CROP_RULES.find((r) => r.cropCode === "WH")!;
const rice = CROP_RULES.find((r) => r.cropCode === "RI")!;
const NOV = new Date("2026-11-10T06:00:00Z");
const APR = new Date("2026-04-10T06:00:00Z");

/* --------------------------------------------------------- sowing window */

console.log("\nsowing window");

{
  const a = adviseCrop(wheat, forecast(Array(7).fill({ tempMaxC: 22 })), NOV);
  check("wheat in November with mild weather says sow now", a.suitability === "sow_now", a.reason);
  check("a best day is named", a.bestDay !== null);
}

{
  const a = adviseCrop(wheat, forecast(Array(7).fill({ tempMaxC: 22 })), APR);
  check("wheat in April is outside its window", a.suitability === "outside_window", a.reason);
  check("the advice names the next window", a.reason.includes("October") || a.reason.includes("November"));
  check("no sowing day is offered outside the window", a.bestDay === null);
}

{
  // Heat is the binding constraint, not the calendar.
  const a = adviseCrop(wheat, forecast(Array(7).fill({ tempMaxC: 34 })), NOV);
  check("wheat in a November heatwave is unsuitable", a.suitability === "unsuitable", a.reason);
  check("the reason names the actual temperature", /3\d°C/.test(a.reason), a.reason);
}

{
  // 30 mm over three days exceeds wheat's 25 mm tolerance.
  const a = adviseCrop(wheat, forecast([{ rainMm: 12 }, { rainMm: 10 }, { rainMm: 8 }, {}, {}, {}, {}]), NOV);
  check("heavy rain after sowing says wait", a.suitability === "wait", a.reason);
  check("the reason names the rainfall", a.reason.includes("mm"), a.reason);
}

{
  // Same rainfall, but paddy is transplanted into standing water — rain is fine.
  const JUL = new Date("2026-07-10T06:00:00Z");
  const a = adviseCrop(rice, forecast([{ rainMm: 12, tempMaxC: 30 }, { rainMm: 10, tempMaxC: 30 }, { rainMm: 8, tempMaxC: 30 }, { tempMaxC: 30 }, { tempMaxC: 30 }, { tempMaxC: 30 }, { tempMaxC: 30 }]), JUL);
  check("the same rain does not block rice", a.suitability === "sow_now", a.reason);
}

{
  const a = adviseCrop(wheat, [], NOV);
  check("no forecast yields no advice, not a guess", a.suitability === "wait" && a.bestDay === null, a.reason);
}

{
  const all = adviseAll(forecast(Array(7).fill({ tempMaxC: 22 })), NOV);
  check("every crop gets advice", all.length === CROP_RULES.length);
  check("sowable crops sort to the top", all[0].suitability === "sow_now", all[0].suitability);
  check(
    "out-of-window crops sort to the bottom",
    all[all.length - 1].suitability === "outside_window",
    all[all.length - 1].suitability,
  );
}

console.log("\nsowing-window wraparound");

check("next window after November is December", nextSowingMonth([11, 12, 1], 11) === 12);
check("next window wraps past the year end", nextSowingMonth([11, 12, 1], 12) === 1);
check("next window from mid-year wraps to the first", nextSowingMonth([11, 12, 1], 6) === 11);
check("onion's January window is reachable from December", nextSowingMonth([11, 12, 1], 12) === 1);

/* ------------------------------------------------------------ irrigation */

console.log("\nirrigation");

{
  const a = adviseIrrigation(forecast([{ rainMm: 6 }, { rainMm: 5 }, { rainMm: 2 }, { rainMm: 40 }]));
  check("13 mm over three days defers irrigation", a.action === "defer", `${a.expectedRainMm} mm`);
  check("rain beyond day three is ignored", a.expectedRainMm === 13, `${a.expectedRainMm}`);
}

{
  const a = adviseIrrigation(forecast([{ rainMm: 2 }, { rainMm: 1 }, { rainMm: 0 }]));
  check("light rain still means irrigate", a.action === "irrigate", `${a.expectedRainMm} mm`);
}

{
  const a = adviseIrrigation([]);
  check("an empty forecast defaults to irrigating, not skipping", a.action === "irrigate");
}

/* -------------------------------------------------------------- earnings */

console.log("\nearnings");

const rows: EarningsRow[] = [
  { batchId: "1", code: "A", crop: "Wheat", quantity: 40, unit: "quintal", farmGatePricePaise: 240_000, status: "registered", harvestedOn: new Date() },
  { batchId: "2", code: "B", crop: "Wheat", quantity: 10, unit: "quintal", farmGatePricePaise: 250_000, status: "sold", harvestedOn: new Date() },
  { batchId: "3", code: "C", crop: "Tomato", quantity: 180, unit: "kg", farmGatePricePaise: 2_200, status: "registered", harvestedOn: new Date() },
  { batchId: "4", code: "D", crop: "Onion", quantity: 50, unit: "kg", farmGatePricePaise: null, status: "registered", harvestedOn: new Date() },
];

{
  const s = summariseEarnings(rows);
  // 40×2400 + 10×2500 + 180×22 = 96000 + 25000 + 3960 = 124960 rupees
  check("registered value is correct", s.registeredPaise === 12_496_000, `${s.registeredPaise}`);
  check("sold value counts only sold batches", s.soldPaise === 2_500_000, `${s.soldPaise}`);
  check("settled is zero until payouts exist", s.settledPaise === 0);
  check("unpriced batches are counted, not silently dropped", s.unpricedCount === 1);
  check("unpriced batches add nothing to any total", s.registeredPaise === 12_496_000);
  check("batch count includes unpriced batches", s.batchCount === 4);
}

{
  const s = summariseEarnings(rows);
  check("crops are grouped", s.byCrop.length === 2, `${s.byCrop.map((c) => c.crop).join(",")}`);
  check("groups sort by value", s.byCrop[0].crop === "Wheat", s.byCrop[0].crop);
  check("quantities add within a crop", s.byCrop[0].quantity === 50, `${s.byCrop[0].quantity}`);
}

{
  // Mixed units within one crop must not silently sum.
  const mixed: EarningsRow[] = [
    { batchId: "1", code: "A", crop: "Tomato", quantity: 100, unit: "kg", farmGatePricePaise: 2_000, status: "registered", harvestedOn: new Date() },
    { batchId: "2", code: "B", crop: "Tomato", quantity: 2, unit: "quintal", farmGatePricePaise: 200_000, status: "registered", harvestedOn: new Date() },
  ];
  const s = summariseEarnings(mixed);
  check("mixed units do not add into one quantity", s.byCrop[0].quantity === 100, `${s.byCrop[0].quantity}`);
  check("value still totals across units", s.byCrop[0].valuePaise === 200_000 + 400_000, `${s.byCrop[0].valuePaise}`);
}

{
  const s = summariseEarnings([]);
  check("an empty farm summarises to zero, not NaN", s.registeredPaise === 0 && s.batchCount === 0);
}

{
  // Fractional quantity must not leak a sub-paise error.
  const frac: EarningsRow[] = [
    { batchId: "1", code: "A", crop: "Wheat", quantity: 1.5, unit: "quintal", farmGatePricePaise: 33_333, status: "registered", harvestedOn: new Date() },
  ];
  const s = summariseEarnings(frac);
  check("fractional quantity yields whole paise", Number.isInteger(s.registeredPaise), `${s.registeredPaise}`);
}

/* --------------------------------------------------------- farmer share */

console.log("\nfarmer share");

check("share is computed correctly", farmerSharePercent(32_00, 55_00) === 58, `${farmerSharePercent(3200, 5500)}`);
check("unknown final price yields null, not 0%", farmerSharePercent(3200, null) === null);
check("unknown farm-gate price yields null", farmerSharePercent(null, 5500) === null);
check("a zero final price yields null, not Infinity", farmerSharePercent(3200, 0) === null);
check("share cannot exceed 100%", farmerSharePercent(6000, 5500) === 100);

/* ---------------------------------------------------------------- report */

console.log(
  `\n${failures.length === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failures.length} failed\n`,
);
if (failures.length) {
  for (const f of failures) console.log(`  · ${f}`);
  process.exit(1);
}
