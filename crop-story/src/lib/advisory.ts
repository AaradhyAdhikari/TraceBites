/**
 * Sowing and irrigation advisory.
 *
 * This is a RULE ENGINE over published agronomy, not a model, and the UI says so.
 * The thresholds below come from ICAR package-of-practices guidance for the
 * north-Indian plains: sowing windows, temperature bands for germination and
 * tuber/bulb development, and rainfall deferral for irrigation.
 *
 * Being explicit about which parts are agronomy and which are machine learning
 * is a credibility gain, not a loss. The prototype printed "confidence: 92%"
 * beside a hardcoded array; one question about how that number was produced
 * ended the conversation. A rule with a citable source survives the question.
 *
 * Pure: takes a forecast and a date, returns advice. No I/O, fully testable.
 */

export interface DailyForecast {
  /** ISO date, YYYY-MM-DD. */
  date: string;
  tempMaxC: number;
  tempMinC: number;
  /** Millimetres of rain expected that day. */
  rainMm: number;
}

export type Suitability = "sow_now" | "wait" | "outside_window" | "unsuitable";

export interface CropRule {
  cropCode: string;
  name: string;
  season: string;
  /** Inclusive month numbers (1–12) in which this crop is normally sown. */
  sowingMonths: number[];
  /** Air temperature band for reliable establishment. */
  sowMinC: number;
  sowMaxC: number;
  /** Heavy rain in the days after sowing that causes seed rot or washout. */
  maxRainAfterSowingMm: number;
  daysToHarvest: [number, number];
  /** Litres per hectare per day at peak, as a rough planning figure. */
  waterNeed: "low" | "medium" | "high";
  source: string;
}

/**
 * North-Indian plains (Punjab, Haryana, western UP). A pilot in another
 * agro-climatic zone needs its own table — do not silently reuse this one.
 */
export const CROP_RULES: CropRule[] = [
  {
    cropCode: "WH",
    name: "Wheat",
    season: "Rabi",
    sowingMonths: [10, 11, 12],
    sowMinC: 18,
    sowMaxC: 25,
    maxRainAfterSowingMm: 25,
    daysToHarvest: [120, 150],
    waterNeed: "medium",
    source: "ICAR package of practices, Rabi cereals",
  },
  {
    cropCode: "RI",
    name: "Rice",
    season: "Kharif",
    sowingMonths: [6, 7],
    sowMinC: 25,
    sowMaxC: 35,
    // Paddy is transplanted into standing water; rain is a help, not a risk.
    maxRainAfterSowingMm: 500,
    daysToHarvest: [90, 120],
    waterNeed: "high",
    source: "ICAR package of practices, Kharif cereals",
  },
  {
    cropCode: "PO",
    name: "Potato",
    season: "Rabi",
    sowingMonths: [10, 11],
    // Tuber initiation fails above ~30°C; night temperature is the binding limit.
    sowMinC: 15,
    sowMaxC: 30,
    maxRainAfterSowingMm: 20,
    daysToHarvest: [80, 110],
    waterNeed: "medium",
    source: "ICAR potato production guidance",
  },
  {
    cropCode: "ON",
    name: "Onion",
    season: "Rabi",
    sowingMonths: [11, 12, 1],
    sowMinC: 13,
    sowMaxC: 27,
    maxRainAfterSowingMm: 15,
    daysToHarvest: [90, 120],
    waterNeed: "low",
    source: "ICAR onion and garlic guidance",
  },
  {
    cropCode: "TO",
    name: "Tomato",
    season: "Rabi / Kharif",
    sowingMonths: [6, 7, 9, 10],
    sowMinC: 18,
    sowMaxC: 30,
    maxRainAfterSowingMm: 30,
    daysToHarvest: [60, 85],
    waterNeed: "high",
    source: "ICAR vegetable production guidance",
  },
  {
    cropCode: "SP",
    name: "Spinach",
    season: "Rabi",
    sowingMonths: [9, 10, 11, 12],
    sowMinC: 10,
    sowMaxC: 27,
    maxRainAfterSowingMm: 20,
    daysToHarvest: [30, 45],
    waterNeed: "medium",
    source: "ICAR leafy vegetable guidance",
  },
];

export interface CropAdvice {
  cropCode: string;
  name: string;
  suitability: Suitability;
  /** Plain-language reason, written for the farmer, not the developer. */
  reason: string;
  /** Present only when suitability is sow_now or wait. */
  bestDay: string | null;
  daysToHarvest: [number, number];
  source: string;
}

/** Mean of the daily max over the window — what establishment actually tracks. */
function meanMax(days: DailyForecast[]): number {
  if (!days.length) return NaN;
  return days.reduce((s, d) => s + d.tempMaxC, 0) / days.length;
}

function totalRain(days: DailyForecast[]): number {
  return days.reduce((s, d) => s + d.rainMm, 0);
}

/**
 * Advises on one crop against a forecast.
 *
 * `today` is injected rather than read from the clock so the rules are testable
 * and so a server in UTC does not disagree with a farmer in IST about the month.
 */
export function adviseCrop(rule: CropRule, forecast: DailyForecast[], today: Date): CropAdvice {
  const month = today.getMonth() + 1;
  const base = {
    cropCode: rule.cropCode,
    name: rule.name,
    daysToHarvest: rule.daysToHarvest,
    source: rule.source,
  };

  if (!rule.sowingMonths.includes(month)) {
    const next = nextSowingMonth(rule.sowingMonths, month);
    return {
      ...base,
      suitability: "outside_window",
      reason: `${rule.name} is normally sown in ${monthNames(rule.sowingMonths)}. The next window opens in ${MONTHS[next - 1]}.`,
      bestDay: null,
    };
  }

  if (forecast.length === 0) {
    return {
      ...base,
      suitability: "wait",
      reason: "No forecast available right now, so no sowing advice can be given.",
      bestDay: null,
    };
  }

  const window = forecast.slice(0, 7);
  const avg = meanMax(window);
  const rain = totalRain(window.slice(0, 3));

  if (avg > rule.sowMaxC + 5) {
    return {
      ...base,
      suitability: "unsuitable",
      reason: `Daytime temperatures average ${Math.round(avg)}°C this week, well above the ${rule.sowMaxC}°C that ${rule.name.toLowerCase()} establishes in. Sowing now risks poor germination.`,
      bestDay: null,
    };
  }

  if (rain > rule.maxRainAfterSowingMm) {
    return {
      ...base,
      suitability: "wait",
      reason: `${Math.round(rain)} mm of rain is expected in the next three days — more than ${rule.name.toLowerCase()} seed tolerates just after sowing. Wait for the spell to pass.`,
      bestDay: null,
    };
  }

  // Pick the first day inside the temperature band and not rained on.
  const best = window.find(
    (d) => d.tempMaxC >= rule.sowMinC && d.tempMaxC <= rule.sowMaxC && d.rainMm < 5,
  );

  if (!best) {
    return {
      ...base,
      suitability: "wait",
      reason: `No day this week falls in the ${rule.sowMinC}–${rule.sowMaxC}°C band ${rule.name.toLowerCase()} needs. Check again in a few days.`,
      bestDay: null,
    };
  }

  return {
    ...base,
    suitability: "sow_now",
    reason: `Conditions suit ${rule.name.toLowerCase()}: daytime temperatures around ${Math.round(avg)}°C and little rain. Harvest in roughly ${rule.daysToHarvest[0]}–${rule.daysToHarvest[1]} days.`,
    bestDay: best.date,
  };
}

export function adviseAll(forecast: DailyForecast[], today: Date): CropAdvice[] {
  const order: Record<Suitability, number> = {
    sow_now: 0,
    wait: 1,
    unsuitable: 2,
    outside_window: 3,
  };
  return CROP_RULES.map((r) => adviseCrop(r, forecast, today)).sort(
    (a, b) => order[a.suitability] - order[b.suitability],
  );
}

/* ------------------------------------------------------------- irrigation */

export interface IrrigationAdvice {
  action: "irrigate" | "defer";
  reason: string;
  expectedRainMm: number;
}

/**
 * Whether to irrigate in the next three days.
 *
 * 10 mm is the rough threshold at which rainfall substitutes for one light
 * irrigation on a medium-textured soil. Deferring saves a pumping run, which on
 * diesel is real money.
 */
export function adviseIrrigation(forecast: DailyForecast[]): IrrigationAdvice {
  const rain = totalRain(forecast.slice(0, 3));
  if (rain >= 10) {
    return {
      action: "defer",
      reason: `About ${Math.round(rain)} mm of rain is expected over the next three days — enough to stand in for one light irrigation. Hold off and save a pumping run.`,
      expectedRainMm: rain,
    };
  }
  return {
    action: "irrigate",
    reason: `Only ${Math.round(rain)} mm of rain expected in the next three days. Irrigate as normal.`,
    expectedRainMm: rain,
  };
}

/* ----------------------------------------------------------------- months */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function monthNames(months: number[]): string {
  const names = months.map((m) => MONTHS[m - 1]);
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Next sowing month at or after `from`, wrapping across the year boundary. */
export function nextSowingMonth(months: number[], from: number): number {
  const sorted = [...months].sort((a, b) => a - b);
  return sorted.find((m) => m > from) ?? sorted[0];
}
