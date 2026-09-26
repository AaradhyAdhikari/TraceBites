/**
 * Weather.
 *
 * Open-Meteo: free, no API key, no quota, and it does not require registering
 * the farmer's coordinates with a commercial provider. IMD remains the
 * authority for official warnings and is the Phase 5 addition.
 *
 * NOTE: the response mapping below has NOT been exercised against the live API —
 * the machine this was written on could not reach api.open-meteo.com. The shape
 * follows Open-Meteo's documented `daily` block. Verify it on first run; if the
 * arrays come back under different keys, only `toDailyForecast` needs changing.
 */

import type { DailyForecast } from "./advisory";

const ENDPOINT = "https://api.open-meteo.com/v1/forecast";

interface OpenMeteoDaily {
  time: string[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
  precipitation_sum: number[];
}

export interface WeatherResult {
  forecast: DailyForecast[];
  /** Null when the provider could not be reached. The UI must say so. */
  error: string | null;
}

function toDailyForecast(daily: OpenMeteoDaily): DailyForecast[] {
  return daily.time.map((date, i) => ({
    date,
    tempMaxC: daily.temperature_2m_max[i],
    tempMinC: daily.temperature_2m_min[i],
    rainMm: daily.precipitation_sum[i] ?? 0,
  }));
}

/**
 * Seven-day forecast for a field.
 *
 * Never throws. A farmer opening the advisory page on a bad connection should
 * see "forecast unavailable", not a crashed route — and the advisory engine
 * already returns "no advice" rather than guessing when the forecast is empty.
 */
export async function getForecast(lat: number, lng: number): Promise<WeatherResult> {
  const url =
    `${ENDPOINT}?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum` +
    `&timezone=Asia%2FKolkata&forecast_days=7`;

  try {
    const res = await fetch(url, {
      // One hour is well inside the cadence at which a 7-day forecast changes,
      // and it keeps a village of farmers from each triggering their own call.
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      return { forecast: [], error: `Weather service returned ${res.status}` };
    }

    const json = (await res.json()) as { daily?: OpenMeteoDaily };
    if (!json.daily?.time?.length) {
      return { forecast: [], error: "Weather service returned no forecast" };
    }

    return { forecast: toDailyForecast(json.daily), error: null };
  } catch (err) {
    const reason =
      err instanceof Error && err.name === "TimeoutError"
        ? "Weather service timed out"
        : "Could not reach the weather service";
    return { forecast: [], error: reason };
  }
}
