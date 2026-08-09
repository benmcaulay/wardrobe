/**
 * Destination climate lookup for SmartPakker.
 *
 * Provider: Open-Meteo (free, no API key). Geocoding resolves a place name to
 * lat/lon, then we pull real numbers from two endpoints:
 *
 *   • Forecast  — an actual forecast, available from 92 days back to 16 days out.
 *   • Archive   — ERA5 reanalysis. Used two ways: for a trip already in the past
 *                 it gives the observed weather for those very dates; for a trip
 *                 beyond the forecast horizon it gives the average of the same
 *                 calendar window over the last few years.
 *
 * A trip that straddles the horizon (starts in 14 days, runs for a week) gets
 * both, averaged over the days each one covers.
 *
 * Everything here is measured. If neither endpoint answers we say we don't know
 * rather than modelling something up — see `hasKnownClimate`. Follows the
 * USE_REAL_* + stub convention from serpapi-client.ts.
 */

const GEOCODE_BASE = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_BASE = "https://api.open-meteo.com/v1/forecast";
const ARCHIVE_BASE = "https://archive-api.open-meteo.com/v1/archive";

/** The forecast endpoint's window, in days either side of today. */
const FORECAST_HORIZON_DAYS = 16;
const FORECAST_PAST_DAYS = 92;
/** How many past years to average when a trip is beyond the horizon. */
const NORMALS_YEARS = 5;
/** Daily rainfall at or above this counts the day as wet. */
const WET_DAY_MM = 1;
/** Don't let a slow provider hold a server action open. */
const REQUEST_TIMEOUT_MS = 8_000;

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
   *   "unknown"     — nobody could tell us. Neutral placeholder numbers.
   *                   Never present them as a forecast.
   *   "climatology" — real observations, but not a forecast for these dates:
   *                   either the same window averaged over past years, or (for
   *                   a trip already gone) what actually happened.
   *   "forecast"    — an actual forecast covering every day of the trip.
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

/* ------------------------------------------------------------ UTC days --- */

const DAY_MS = 86_400_000;

/** Trips are whole days; normalise to UTC midnight so arithmetic is exact. */
function utcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

function inclusiveDays(start: Date, end: Date): number {
  const ms = utcDay(end).getTime() - utcDay(start).getTime();
  return Math.max(1, Math.round(ms / DAY_MS) + 1);
}

function isoDate(d: Date): string {
  return utcDay(d).toISOString().slice(0, 10);
}

/** Same calendar window, `years` years earlier. Feb 29 lands on Mar 1. */
function shiftYears(d: Date, years: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear() - years, d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Neutral stand-in used when no provider could tell us anything. Deliberately
 * bland: a temperate spring day, the same for every destination.
 *
 * There used to be a `pseudoLatitude()` here that hashed the destination string
 * into a latitude, and a cosine model that turned that latitude into a
 * temperature. It produced confident, specific, and completely fabricated
 * numbers — Ireland in June came out as "Hot, 28°C" — which then drove the
 * entire packing plan. A wrong answer delivered with the same authority as a
 * real forecast is worse than no answer, so we now say we don't know and ask.
 * See `hasKnownClimate`.
 */
const UNKNOWN_CLIMATE = { avgHighC: 18, avgLowC: 10, rainChance: 0.3 } as const;

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

/* ------------------------------------------------------------ fetching --- */

async function getJson(url: URL, revalidate: number): Promise<unknown | null> {
  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    next: { revalidate },
  });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

type GeocodeHit = {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  admin1?: string;
  population?: number;
};

/**
 * Resolve a place name to coordinates.
 *
 * We ask for several candidates and take the most populous rather than the
 * provider's first hit, because its ranking is name-similarity first: "Bali"
 * comes back as Bāli in West Bengal (pop. 297k) ahead of Bali, Indonesia
 * (pop. 4.2m), and a beach holiday would have been packed for inland India.
 * Where the first hit is already the famous one — Paris, Sydney — it is also
 * the largest, so this changes nothing.
 */
async function geocode(query: string): Promise<GeocodeHit | null> {
  const url = new URL(GEOCODE_BASE);
  url.searchParams.set("name", query);
  url.searchParams.set("count", "5");
  // Place coordinates don't move; a day of caching saves a round trip per plan.
  const body = (await getJson(url, 60 * 60 * 24)) as { results?: GeocodeHit[] } | null;
  const hits = (body?.results ?? []).filter(
    (h) => Number.isFinite(h.latitude) && Number.isFinite(h.longitude),
  );
  if (hits.length === 0) return null;
  // Stable: only overtake the incumbent on a strictly larger population.
  return hits.reduce((best, h) => ((h.population ?? 0) > (best.population ?? 0) ? h : best));
}

/** "Springfield, Missouri, United States" — enough to spot a wrong pick. */
function placeLabel(hit: GeocodeHit): string {
  return [hit.name, hit.admin1 !== hit.name ? hit.admin1 : null, hit.country]
    .filter(Boolean)
    .join(", ");
}

/**
 * A stretch of days, averaged. `days` is the weight when we combine a forecast
 * segment with a historical one.
 */
type Window = { days: number; avgHighC: number; avgLowC: number; rainChance: number };

type DailyBlock = {
  temperature_2m_max?: (number | null)[];
  temperature_2m_min?: (number | null)[];
  precipitation_probability_mean?: (number | null)[];
  precipitation_sum?: (number | null)[];
};

const numbers = (xs: (number | null)[] | undefined): number[] =>
  (xs ?? []).filter((n): n is number => n != null && Number.isFinite(n));

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Fold a daily block into a window. `rain` differs by endpoint — the forecast
 * reports a probability per day, the archive reports millimetres — so each
 * caller passes its own reading of "how likely was rain today", 0..1 per day.
 */
function toWindow(daily: DailyBlock | undefined, rainPerDay: number[]): Window | null {
  const highs = numbers(daily?.temperature_2m_max);
  if (highs.length === 0) return null;
  const lows = numbers(daily?.temperature_2m_min);
  const avgHighC = mean(highs);
  return {
    days: highs.length,
    avgHighC,
    avgLowC: lows.length ? mean(lows) : avgHighC - 8,
    rainChance: rainPerDay.length ? mean(rainPerDay) : 0.2,
  };
}

/** Actual forecast. Caller must keep [start, end] inside the provider window. */
async function fetchForecast(
  lat: number,
  lon: number,
  start: Date,
  end: Date,
): Promise<Window | null> {
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

  const body = (await getJson(url, 60 * 60)) as { daily?: DailyBlock } | null;
  const rain = numbers(body?.daily?.precipitation_probability_mean).map((p) => p / 100);
  return toWindow(body?.daily, rain);
}

/** Observed weather for a past window, straight from the reanalysis archive. */
async function fetchArchive(
  lat: number,
  lon: number,
  start: Date,
  end: Date,
): Promise<Window | null> {
  const url = new URL(ARCHIVE_BASE);
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,precipitation_sum");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("start_date", isoDate(start));
  url.searchParams.set("end_date", isoDate(end));

  // The past doesn't change — cache hard.
  const body = (await getJson(url, 60 * 60 * 24 * 30)) as { daily?: DailyBlock } | null;
  const rain = numbers(body?.daily?.precipitation_sum).map((mm) => (mm >= WET_DAY_MM ? 1 : 0));
  return toWindow(body?.daily, rain);
}

/** Combine windows, weighting each by the number of days it covers. */
function mergeWindows(windows: Window[], days: number): Window | null {
  const parts = windows.filter((w) => w.days > 0);
  if (parts.length === 0) return null;
  const weight = parts.reduce((a, w) => a + w.days, 0);
  const weighted = (pick: (w: Window) => number) =>
    parts.reduce((a, w) => a + pick(w) * w.days, 0) / weight;
  return {
    days,
    avgHighC: weighted((w) => w.avgHighC),
    avgLowC: weighted((w) => w.avgLowC),
    rainChance: weighted((w) => w.rainChance),
  };
}

/**
 * What these dates have typically looked like: the same calendar window over
 * each of the last `NORMALS_YEARS` years, averaged. Real observations, just not
 * for the year in question — the honest answer for a trip booked months out.
 *
 * Years are fetched in parallel and any that fail are simply left out; one
 * good year still beats no answer.
 */
async function fetchNormals(
  lat: number,
  lon: number,
  start: Date,
  end: Date,
): Promise<Window | null> {
  const years = Array.from({ length: NORMALS_YEARS }, (_, i) => i + 1);
  const settled = await Promise.all(
    years.map((y) =>
      fetchArchive(lat, lon, shiftYears(start, y), shiftYears(end, y)).catch(() => null),
    ),
  );
  return mergeWindows(
    settled.filter((w): w is Window => w != null),
    inclusiveDays(start, end),
  );
}

/**
 * Historical cover for a segment: observations if it has already happened,
 * otherwise the multi-year average for the same dates.
 */
async function fetchHistory(
  lat: number,
  lon: number,
  start: Date,
  end: Date,
  today: Date,
): Promise<Window | null> {
  if (end.getTime() < today.getTime()) {
    const observed = await fetchArchive(lat, lon, start, end).catch(() => null);
    if (observed) return observed;
  }
  return fetchNormals(lat, lon, start, end);
}

/* ------------------------------------------------------------- summary --- */

/**
 * Summarise the climate for a destination across the trip dates. Never throws:
 * anything we can't measure comes back as `source: "unknown"`.
 */
export async function getClimateSummary(input: {
  destination: string;
  start: Date;
  end: Date;
}): Promise<ClimateSummary> {
  const destination = input.destination.trim();
  const days = inclusiveDays(input.start, input.end);
  // No provider (or nowhere to look up) means no coordinates, and without
  // coordinates there is nothing honest to say about the weather.
  if (!weatherEnabled() || !destination) {
    return unknownSummary(destination || "Unknown", input.start, input.end);
  }

  try {
    const hit = await geocode(destination);
    if (!hit) {
      // Couldn't resolve the place — don't guess a climate for it.
      return unknownSummary(destination, input.start, input.end);
    }
    const label = placeLabel(hit);
    const { latitude, longitude } = hit;

    const today = utcDay(new Date());
    const tripStart = utcDay(input.start);
    const tripEnd = utcDay(input.end);

    // Clip the trip to the slice the forecast endpoint will actually serve;
    // asking for a day outside it fails the whole request.
    const fStart = new Date(
      Math.max(tripStart.getTime(), addDays(today, -FORECAST_PAST_DAYS).getTime()),
    );
    const fEnd = new Date(
      Math.min(tripEnd.getTime(), addDays(today, FORECAST_HORIZON_DAYS).getTime()),
    );
    const forecastable = fStart.getTime() <= fEnd.getTime();

    // Whatever the forecast can't reach — before it or after it — falls to history.
    const gaps: [Date, Date][] = forecastable
      ? [
          ...(tripStart < fStart ? ([[tripStart, addDays(fStart, -1)]] as [Date, Date][]) : []),
          ...(tripEnd > fEnd ? ([[addDays(fEnd, 1), tripEnd]] as [Date, Date][]) : []),
        ]
      : [[tripStart, tripEnd]];

    const [forecast, ...history] = await Promise.all([
      forecastable
        ? fetchForecast(latitude, longitude, fStart, fEnd).catch(() => null)
        : Promise.resolve(null),
      ...gaps.map(([s, e]) => fetchHistory(latitude, longitude, s, e, today)),
    ]);

    // The forecast endpoint was our cover for those days and it didn't answer.
    // The archive still knows what these dates usually look like — a five-year
    // average beats shrugging at a trip that leaves next week.
    const repair =
      forecastable && !forecast
        ? await fetchHistory(latitude, longitude, fStart, fEnd, today)
        : null;

    const merged = mergeWindows(
      [forecast, repair, ...history].filter((w): w is Window => w != null),
      days,
    );
    if (!merged) {
      // Geocoded fine, but no endpoint would give us numbers.
      return unknownSummary(label, input.start, input.end);
    }

    const avgHighC = Math.round(merged.avgHighC);
    return {
      destination: label,
      latitude,
      longitude,
      avgHighC,
      avgLowC: Math.round(merged.avgLowC),
      band: bandForHigh(avgHighC),
      rainChance: Math.round(Math.min(1, Math.max(0, merged.rainChance)) * 100) / 100,
      days,
      // Only claim "forecast" when it covered every single day and there are
      // still days left to forecast — the endpoint also serves the recent past,
      // and calling a finished trip's weather a forecast would be nonsense.
      source:
        forecast && forecast.days >= days && tripEnd.getTime() >= today.getTime()
          ? "forecast"
          : "climatology",
    };
  } catch {
    // Network or provider failure. Nothing measured, so: unknown.
    return unknownSummary(destination, input.start, input.end);
  }
}
