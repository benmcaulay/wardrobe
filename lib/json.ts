/**
 * Helpers for reading/writing the JSON-encoded string columns we use to
 * work around SQLite's lack of a native Json type. Every caller should go
 * through these so the encoding stays uniform.
 */

export type Color = { hex: string; name: string };
export type Season = "spring" | "summer" | "fall" | "winter";

export type StylePrefs = {
  sizes?: Record<string, string>;
  favoriteColors?: string[];
  styles?: string[];
};

export function encode<T>(value: T): string {
  return JSON.stringify(value);
}

export function decode<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export const parseColors = (raw: string | null | undefined): Color[] => decode<Color[]>(raw, []);
export const parseStringArray = (raw: string | null | undefined): string[] => decode<string[]>(raw, []);
export const parseSeasons = (raw: string | null | undefined): Season[] => decode<Season[]>(raw, []);
export const parseStylePrefs = (raw: string | null | undefined): StylePrefs => decode<StylePrefs>(raw, {});
