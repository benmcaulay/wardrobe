/**
 * Destination climate lookup for SmartPakker.
 *
 * Real provider: Open-Meteo (free, no API key). Geocoding resolves a place name
 * to lat/lon; the forecast API covers ~16 days out. For trips beyond that
 * horizon (or when USE_REAL_WEATHER is off) we fall back to a deterministic
 * latitude/month climatology model so every trip still gets a destination-aware
 * estimate. Follows the USE_REAL_* + stub convention from serpapi-client.ts.
 */

const GEOCODE_BASE = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_BASE = "https://api.open-meteo.com/v1/forecast";
const FORECAST_HORIZON_DAYS = 16;

export type ClimateBand = "hot" | "warm" | "mild" | "cool" | "cold";

export const CLIMATE_BAND_LABELS: Record<ClimateBand, string> = {
  hot: "Hot",
  warm: "Warm",
  mild: "Mild",
  cool: "Cool",
  cold: "Cold",
};

export type ClimateSummary = {
  /** Resolved place label, e.g. "Lisbon, Portugal" (or the raw query in stub). */
  destination: string;
  latitude: number | null;
  longitude: number | null;
  avgHighC: number;
  avgLowC: number;
  band: ClimateBand;
  /** Mean daily chance of rain, 0..1. */
  rainChance: number;
  /** Number of (inclusive) days in the trip. */
  days: number;
  /**
   * Where the numbers came from, worst to best:
   *   "unknown"     — we have no latitude, so these are a neutral placeholder.
   *                   Never present them as a forecast.
   *   "climatology" — real geocoded latitude + seasonal model. Out-of-horizon.
   *   "forecast"    — an actual forecast for these dates.
   *   "manual"      — the user told us; beats everything.
   */
  source: "forecast" | "climatology" | "unknown" | "manual";
};

export function weatherEnabled(): boolean {
  return process.env.USE_REAL_WEATHER === "true";
}

export function bandForHigh(avgHighC: number): ClimateBand {
  if (avgHighC >= 28) return "hot";
  if (avgHighC >= 22) return "warm";
  if (avgHighC >= 15) return "mild";
  if (avgHighC >= 8) return "cool";
  return "cold";
}

function inclusiveDays(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  return Math.max(1, Math.round(ms / 86_400_000) + 1);
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Neutral stand-in used when we have no latitude to reason from. Deliberately
 * bland: a temperate spring day, the same for every destination.
 *
 * There used to be a `pseudoLatitude()` here that hashed the destination string
 * into a latitude so the offline path could be "destination-aware". It produced
 * confident, specific, and completely fabricated numbers — Ireland in June came
 * out as "Hot, 28°C" — which then drove the entire packing plan. A wrong answer
 * delivered with the same authority as a real forecast is worse than no answer,
 * so we now say we don't know and ask. See `hasKnownClimate`.
 */
const UNKNOWN_CLIMATE = { avgHighC: 18, avgLowC: 10, rainChance: 0.3 } as const;

/**
 * Deterministic climatology: rough average daytime high from latitude + month.
 * Northern hemisphere peaks in July, southern in January.
 */
function climatologyHigh(latitude: number, month: number): number {
  const absLat = Math.abs(latitude);
  const annualMean = 30 - absLat * 0.45;
  const amplitude = Math.min(22, absLat * 0.4);
  const peakMonth = latitude >= 0 ? 7 : 1;
  const phase = ((month - peakMonth) / 12) * 2 * Math.PI;
  return annualMean + amplitude * Math.cos(phase);
}

/**
 * Seasonal estimate from a *real* latitude. Only reachable once geocoding has
 * resolved the destination — there is deliberately no fallback latitude.
 */
function climatologySummary(
  destination: string,
  latitude: number,
  longitude: number | null,
  start: Date,
  end: Date,
): ClimateSummary {
  const month = start.getUTCMonth() + 1;
  const avgHighC = Math.round(climatologyHigh(latitude, month));
  const avgLowC = Math.round(avgHighC - 8);
  // Wetter near the equator and in cooler bands; deterministic per place.
  const rainSeed = (Math.abs(Math.round(latitude)) % 5) / 10; // 0..0.4
  const rainChance = Math.min(0.7, 0.2 + rainSeed);
  return {
    destination,
    latitude,
    longitude,
    avgHighC,
    avgLowC,
    band: bandForHigh(avgHighC),
    rainChance: Math.round(rainChance * 100) / 100,
    days: inclusiveDays(start, end),
    source: "climatology",
  };
}

/**
 * "We don't know." Carries neutral numbers so the planner still has a band to
 * work from, but `source: "unknown"` tells the UI not to present them as a
 * forecast — it should ask the user instead (`hasKnownClimate`).
 */
function unknownSummary(destination: string, start: Date, end: Date): ClimateSummary {
  return {
    destination,
    latitude: null,
    longitude: null,
    avgHighC: UNKNOWN_CLIMATE.avgHighC,
    avgLowC: UNKNOWN_CLIMATE.avgLowC,
    band: bandForHigh(UNKNOWN_CLIMATE.avgHighC),
    rainChance: UNKNOWN_CLIMATE.rainChance,
    days: inclusiveDays(start, end),
    source: "unknown",
  };
}

/**
 * Whether the numbers in a summary describe the actual destination, or are
 * just the neutral placeholder. UI must not render temperatures when false.
 */
export function hasKnownClimate(summary: Pick<ClimateSummary, "source">): boolean {
  return summary.source !== "unknown";
}

/** A climate the user typed in themselves. Always wins over anything we infer. */
export function manualClimateSummary(input: {
  destination: string;
  avgHighC: number;
  avgLowC?: number | null;
  rainChance?: number | null;
  start: Date;
  end: Date;
}): ClimateSummary {
  const avgHighC = Math.round(input.avgHighC);
  const avgLowC =
    input.avgLowC != null && Number.isFinite(input.avgLowC)
      ? Math.round(input.avgLowC)
      : avgHighC - 8;
  const rain =
    input.rainChance != null && Number.isFinite(input.rainChance)
      ? Math.min(1, Math.max(0, input.rainChance))
      : 0.2;
  return {
    destination: input.destination,
    latitude: null,
    longitude: null,
    avgHighC,
    avgLowC,
    band: bandForHigh(avgHighC),
    rainChance: Math.round(rain * 100) / 100,
    days: inclusiveDays(input.start, input.end),
    source: "manual",
  };
}

type GeocodeHit = { name: string; latitude: number; longitude: number; country?: string };

async function geocode(query: string): Promise<GeocodeHit | null> {
  const url = new URL(GEOCODE_BASE);
  url.searchParams.set("name", query);
  url.searchParams.set("count", "1");
  const res = await fetch(url.toString(), { next: { revalidate: 0 } });
  if (!res.ok) return null;
  const body = (await res.json().catch(() => ({}))) as {
    results?: GeocodeHit[];
  };
  const hit = body.results?.[0];
  if (!hit) return null;
  return hit;
}

async function fetchForecast(
  lat: number,
  lon: number,
  start: Date,
  end: Date,
): Promise<{ avgHighC: number; avgLowC: number; rainChance: number } | null> {
  const url = new URL(FORECAST_BASE);
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set(
    "daily",
    "temperature_2m_max,temperature_2m_min,precipitation_probability_mean",
  );
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("start_date", isoDate(start));
  url.searchParams.set("end_date", isoDate(end));

  const res = await fetch(url.toString(), { next: { revalidate: 0 } });
  if (!res.ok) return null;
  const body = (await res.json().catch(() => ({}))) as {
    daily?: {
      temperature_2m_max?: (number | null)[];
      temperature_2m_min?: (number | null)[];
      precipitation_probability_mean?: (number | null)[];
    };
  };
  const highs = (body.daily?.temperature_2m_max ?? []).filter((n): n is number => n != null);
  const lows = (body.daily?.temperature_2m_min ?? []).filter((n): n is number => n != null);
  const rain = (body.daily?.precipitation_probability_mean ?? []).filter(
    (n): n is number => n != null,
  );
  if (highs.length === 0) return null;
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return {
    avgHighC: Math.round(avg(highs)),
    avgLowC: lows.length ? Math.round(avg(lows)) : Math.round(avg(highs) - 8),
    rainChance: rain.length ? Math.round((avg(rain) / 100) * 100) / 100 : 0.2,
  };
}

/**
 * Summarise the climate for a destination across the trip dates. Never throws:
 * any failure (provider off, geocode miss, out-of-horizon) degrades to the
 * deterministic climatology model.
 */
export async function getClimateSummary(input: {
  destination: string;
  start: Date;
  end: Date;
}): Promise<ClimateSummary> {
  const destination = input.destination.trim();
  // No provider (or nowhere to look up) means no latitude, and without a
  // latitude there is nothing honest to say about the weather.
  if (!weatherEnabled() || !destination) {
    return unknownSummary(destination || "Unknown", input.start, input.end);
  }

  try {
    const hit = await geocode(destination);
    if (!hit) {
      // Couldn't resolve the place — don't guess a climate for it.
      return unknownSummary(destination, input.start, input.end);
    }
    const label = hit.country ? `${hit.name}, ${hit.country}` : hit.name;

    const daysUntilStart = Math.round((input.start.getTime() - Date.now()) / 86_400_000);
    const withinHorizon = daysUntilStart <= FORECAST_HORIZON_DAYS && input.end.getTime() >= Date.now();
    if (withinHorizon) {
      const forecast = await fetchForecast(hit.latitude, hit.longitude, input.start, input.end);
      if (forecast) {
        return {
          destination: label,
          latitude: hit.latitude,
          longitude: hit.longitude,
          avgHighC: forecast.avgHighC,
          avgLowC: forecast.avgLowC,
          band: bandForHigh(forecast.avgHighC),
          rainChance: forecast.rainChance,
          days: inclusiveDays(input.start, input.end),
          source: "forecast",
        };
      }
    }
    return climatologySummary(label, hit.latitude, hit.longitude, input.start, input.end);
  } catch {
    // Network or provider failure. We had no chance to resolve a latitude, so
    // this is "unknown", not a climatology estimate.
    return unknownSummary(destination, input.start, input.end);
  }
}
