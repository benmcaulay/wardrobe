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
  /** Ordered wardrobe category picker list (merged with defaults server-side only when absent). */
  categoriesList?: string[];
  /** Ordered style-tag chips for item add/edit (defaults when absent). */
  styleTagsList?: string[];
  /** Ordered wardrobe color palette (swatch + name); defaults to built-ins when absent. */
  colorsList?: Color[];
  /** @deprecated — read for migration only; omit on save */
  customCategories?: string[];
  /** @deprecated */
  categoryOrder?: string[];
  /** @deprecated */
  hiddenCategories?: string[];
  /** Manual item order within category + primary-color groups (group key → item ids). */
  closetGroupOrders?: Record<string, string[]>;
  /** Default canvas placement per outfit slot category rule (signature → layout). */
  outfitSlotDefaults?: Record<string, { x: number; y: number; scale: number }>;
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
