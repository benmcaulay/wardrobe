/**
 * Place lookup for SmartPakker.
 *
 * Provider: Open-Meteo's geocoding API (free, no key) — the same service
 * `weather.ts` already pulls forecasts from, so a resolved place and its
 * forecast come from one source and can't disagree about where "Seoul" is.
 *
 * This used to live inside weather.ts as a private `geocode()` that returned a
 * single best guess. The trip page now needs the *candidates* — a destination
 * is a choice the user should make once, explicitly, rather than a string we
 * re-guess on every climate refresh — so the search is its own module and the
 * weather lookup consumes stored coordinates when it has them.
 *
 * Follows the USE_REAL_* + stub convention: with the provider off, search
 * still answers from a small built-in list so the picker is usable offline.
 */

import { type Place } from "@/lib/places";

export { placeContext, placeLabel, type Place } from "@/lib/places";

const GEOCODE_BASE = "https://geocoding-api.open-meteo.com/v1/search";

/** Don't let a slow provider hold a keystroke-driven server action open. */
const REQUEST_TIMEOUT_MS = 6_000;

/** How many candidates to ask the provider for before we re-rank and trim. */
const FETCH_COUNT = 20;

/** How many to hand back to the dropdown. More than this is a scroll, not a choice. */
export const MAX_PLACE_RESULTS = 8;

export function geocodingEnabled(): boolean {
  return process.env.USE_REAL_WEATHER === "true";
}

type GeocodeHit = {
  id?: number;
  name?: string;
  latitude?: number;
  longitude?: number;
  country?: string;
  country_code?: string;
  admin1?: string;
  timezone?: string;
  population?: number;
  feature_code?: string;
};

function toPlace(hit: GeocodeHit): Place | null {
  if (typeof hit.name !== "string" || !hit.name) return null;
  if (!Number.isFinite(hit.latitude) || !Number.isFinite(hit.longitude)) return null;
  const code = typeof hit.country_code === "string" ? hit.country_code.toUpperCase() : null;
  return {
    id: String(hit.id ?? `${hit.latitude},${hit.longitude}`),
    name: hit.name,
    admin1: hit.admin1 || null,
    country: hit.country || null,
    countryCode: code && /^[A-Z]{2}$/.test(code) ? code : null,
    latitude: hit.latitude as number,
    longitude: hit.longitude as number,
    timezone: hit.timezone || null,
    population: Number.isFinite(hit.population) ? (hit.population as number) : null,
  };
}

/**
 * Rank candidates for a dropdown.
 *
 * The provider orders by name similarity alone, which puts Bāli in West Bengal
 * (pop. 297k) above Bali, Indonesia (pop. 4.2m) — the bug weather.ts already
 * worked around by taking the most populous of five. A list needs more care
 * than a single pick, so we sort on three things in order:
 *
 *   1. An exact name match, so typing "Seoul" in full can't be outranked by
 *      some larger city that merely contains it.
 *   2. Being an actual populated place (`feature_code` PPL*) rather than a
 *      region, park, or airport that happens to share the name.
 *   3. Population, which is the best available proxy for "the one they meant".
 *
 * Population is compared on a log scale so a 4.2m city decisively beats a
 * 297k one while two similar cities stay in similarity order.
 */
function rank(places: Place[], hits: GeocodeHit[], query: string): Place[] {
  const needle = query.trim().toLowerCase();
  const featureByIndex = hits.map((h) => h.feature_code ?? "");

  return places
    .map((place, index) => {
      const exact = place.name.toLowerCase() === needle ? 1 : 0;
      const populated = featureByIndex[index].startsWith("PPL") ? 1 : 0;
      const size = Math.log10((place.population ?? 0) + 10);
      return { place, index, score: exact * 100 + populated * 10 + size };
    })
    // Ties fall back to the provider's own ordering, which is a reasonable
    // similarity ranking and keeps results stable between keystrokes.
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.place);
}

/**
 * A handful of well-known cities, for when the provider is switched off.
 *
 * Not a geocoder — just enough that the picker, the map, and the trip flow can
 * be exercised in a dev environment with USE_REAL_WEATHER unset. Coordinates
 * are real, so the map pin lands where it should.
 */
const STUB_PLACES: Place[] = (
  [
    ["Seoul", "Seoul", "South Korea", "KR", 37.5665, 126.978, "Asia/Seoul", 9776000],
    ["Tokyo", "Tokyo", "Japan", "JP", 35.6895, 139.6917, "Asia/Tokyo", 13960000],
    ["Lisbon", "Lisbon", "Portugal", "PT", 38.7167, -9.1333, "Europe/Lisbon", 517802],
    ["London", "England", "United Kingdom", "GB", 51.5085, -0.1257, "Europe/London", 8961989],
    ["Paris", "Île-de-France", "France", "FR", 48.8534, 2.3488, "Europe/Paris", 2138551],
    ["New York", "New York", "United States", "US", 40.7143, -74.006, "America/New_York", 8175133],
    ["Reykjavík", "Capital Region", "Iceland", "IS", 64.1355, -21.8954, "Atlantic/Reykjavik", 118918],
    ["Sydney", "New South Wales", "Australia", "AU", -33.8679, 151.2073, "Australia/Sydney", 4840600],
    ["Cape Town", "Western Cape", "South Africa", "ZA", -33.9258, 18.4232, "Africa/Johannesburg", 3433441],
    ["Mexico City", "Mexico City", "Mexico", "MX", 19.4326, -99.1332, "America/Mexico_City", 12294193],
  ] as const
).map(([name, admin1, country, countryCode, latitude, longitude, timezone, population]) => ({
  id: `stub-${countryCode}-${name}`,
  name,
  admin1,
  country,
  countryCode,
  latitude,
  longitude,
  timezone,
  population,
}));

function searchStub(query: string): Place[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return STUB_PLACES.filter(
    (p) =>
      p.name.toLowerCase().includes(needle) ||
      (p.country ?? "").toLowerCase().includes(needle),
  ).slice(0, MAX_PLACE_RESULTS);
}

/**
 * Search for a place by name. Never throws: a provider failure is an empty
 * list, because a dropdown that shows nothing is recoverable and an error
 * thrown out of a keystroke handler is not.
 */
export async function searchPlaces(query: string, limit = MAX_PLACE_RESULTS): Promise<Place[]> {
  const trimmed = query.trim();
  // One or two letters matches half the planet and tells us nothing.
  if (trimmed.length < 2) return [];
  if (!geocodingEnabled()) return searchStub(trimmed).slice(0, limit);

  const url = new URL(GEOCODE_BASE);
  url.searchParams.set("name", trimmed);
  url.searchParams.set("count", String(FETCH_COUNT));
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");

  try {
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      // Place coordinates don't move; a day of caching makes repeat keystrokes
      // and a later climate lookup free.
      next: { revalidate: 60 * 60 * 24 },
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { results?: GeocodeHit[] };
    const hits = body.results ?? [];
    const places = hits.map(toPlace);
    // Rank against the hits they came from, so feature_code lines up by index.
    const paired = places
      .map((place, i) => ({ place, hit: hits[i] }))
      .filter((entry): entry is { place: Place; hit: GeocodeHit } => entry.place != null);
    return rank(
      paired.map((e) => e.place),
      paired.map((e) => e.hit),
      trimmed,
    ).slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * The single best match for a free-text place name — what the weather lookup
 * falls back to for a trip whose destination was never picked from the list.
 */
export async function resolvePlace(query: string): Promise<Place | null> {
  const results = await searchPlaces(query, 1);
  return results[0] ?? null;
}
