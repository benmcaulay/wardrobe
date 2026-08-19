/**
 * What a place is, and how to write it down.
 *
 * Split out from `lib/services/geocode.ts` so the client can import the type
 * and the formatters without dragging the provider along — that module reads
 * `process.env` and holds a stub city list, neither of which belongs in a
 * bundle just because a dropdown wants to render a label.
 *
 * Pure and dependency-free, so `__tests__/places.test.ts` can pin the label
 * rules that stop "Seoul, Seoul, South Korea" reaching the UI.
 */

export type Place = {
  /** Provider id, stable enough to use as a React key. */
  id: string;
  /** Bare place name: "Seoul". */
  name: string;
  /** First-level division: "Seoul", "California", "Bavaria". May be absent. */
  admin1: string | null;
  country: string | null;
  /** ISO 3166-1 alpha-2, uppercased. Highlights the country on the trip map. */
  countryCode: string | null;
  latitude: number;
  longitude: number;
  /** IANA zone, e.g. "Asia/Seoul". */
  timezone: string | null;
  population: number | null;
};

type Named = Pick<Place, "name" | "admin1" | "country">;

/**
 * Everything except the name: "Seoul, South Korea" minus "Seoul".
 *
 * Drops admin1 when it merely repeats the name — a city that is its own
 * province would otherwise read "Seoul, Seoul, South Korea" — but keeps it
 * everywhere it disambiguates, which is the entire reason the picker exists.
 * There are more than thirty Springfields in the United States and the state
 * is the only thing telling them apart.
 */
export function placeContext(place: Named): string {
  return [place.admin1 && place.admin1 !== place.name ? place.admin1 : null, place.country]
    .filter(Boolean)
    .join(", ");
}

/** The full label stored on the trip and shown on the map plate. */
export function placeLabel(place: Named): string {
  const context = placeContext(place);
  return context ? `${place.name}, ${context}` : place.name;
}

/**
 * The country's flag, as regional indicator symbols.
 *
 * Scanning a list of ambiguous city names is much faster with a flag beside
 * each, and this costs no icon work and no bytes. Platforms without flag
 * glyphs (Windows, mostly) render the two letters instead — which is still
 * the country code, so the fallback degrades into something useful rather
 * than into tofu.
 */
export function flagEmoji(countryCode: string | null | undefined): string {
  if (!countryCode || !/^[A-Za-z]{2}$/.test(countryCode)) return "";
  const base = 0x1f1e6 - "A".charCodeAt(0);
  return [...countryCode.toUpperCase()].map((c) => String.fromCodePoint(base + c.charCodeAt(0))).join("");
}

/**
 * Local time at the destination, e.g. "4:12 AM".
 *
 * Returns null rather than throwing on an unknown zone: `timeZone` is stored
 * from whatever the provider said, and an Intl failure must not take the trip
 * page down over a clock.
 */
export function localTimeAt(timezone: string | null | undefined, now: Date): string | null {
  if (!timezone) return null;
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: timezone,
    }).format(now);
  } catch {
    return null;
  }
}
