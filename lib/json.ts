/**
 * Helpers for reading/writing the JSON-encoded string columns we use to
 * work around SQLite's lack of a native Json type. Every caller should go
 * through these so the encoding stays uniform.
 */

export type Color = { hex: string; name: string };
export type Season = "spring" | "summer" | "fall" | "winter";

/**
 * A wardrobe owner (e.g. "Me", "Her"). Items reference owners by the stable
 * `id`, not the display `name`, so renaming an owner never orphans items.
 * `linkedUserId` is null until the owner is migrated to a real login account —
 * it's the anchor that keeps a future single-account → multi-account split
 * mechanical rather than a rewrite.
 */
export type Owner = { id: string; name: string; linkedUserId?: string | null };

/** Shapes a user can assign to a category. Mirrors GarmentKind minus "other". */
export type GarmentKindChoice = "top" | "bottom" | "dress" | "outerwear" | "shoes" | "accessory";

export type StylePrefs = {
  sizes?: Record<string, string>;
  favoriteColors?: string[];
  styles?: string[];
  /** Ordered wardrobe category picker list (merged with defaults server-side only when absent). */
  categoriesList?: string[];
  /**
   * Explicit garment shape per category label, keyed by normalised name.
   *
   * The classifier infers shape from the label text, which cannot work for
   * occasion-style names — "workwear", "favorites", "y2k" say nothing about
   * what the garment IS, and "swim" is ambiguous between trunks and a bikini
   * top. This is the user's answer for those, and it wins over inference.
   */
  categoryShapes?: Record<string, GarmentKindChoice>;
  /** Ordered style-tag chips for item add/edit (defaults when absent). */
  styleTagsList?: string[];
  /** Ordered wardrobe color palette (swatch + name); defaults to built-ins when absent. */
  colorsList?: Color[];
  /** Ordered wardrobe owner roster; defaults to the built-in Me/Her seed when absent. */
  owners?: Owner[];
  /** @deprecated — read for migration only; omit on save */
  customCategories?: string[];
  /** @deprecated */
  categoryOrder?: string[];
  /** @deprecated */
  hiddenCategories?: string[];
  /**
   * Closet filter controls the user has chosen to hide (see
   * lib/closet-filter-visibility.ts). Absent means "show everything" — the
   * feature stays available for everyone else, it's just off your own screen.
   */
  hiddenClosetFilters?: string[];
  /** Sort the closet opens with — remembers whatever you last chose. */
  defaultClosetSort?: string;
  /**
   * Display unit for temperatures ("c" | "f"). Presentation only — trip climate
   * is always stored in Celsius. See lib/temperature.ts.
   */
  temperatureUnit?: string;
  /**
   * Where the user usually gets dressed, as a place name for Open-Meteo
   * geocoding ("San Diego"). Powers the weather context on the daily outfit
   * proposal.
   *
   * Stored rather than read from the browser because next.config.mjs denies
   * geolocation at the Permissions-Policy header, and a typed city is a much
   * smaller ask than reversing that for a nicety. Absent is fine: the climate
   * term returns neutral and the other Layer 1 terms decide.
   */
  homeLocation?: string;
  /** Manual item order within category + primary-color groups (group key → item ids). */
  closetGroupOrders?: Record<string, string[]>;
  /** Default canvas placement per outfit slot category rule (signature → layout). */
  outfitSlotDefaults?: Record<string, { x: number; y: number; scale: number }>;
  /** Outfit layer order — category signatures, frontmost first (drag to reorder the stack). */
  outfitLayerOrder?: string[];
  /** Vertical placement bands — each entry is a layer (top→bottom) of category names. */
  outfitVisualLayers?: string[][];
  /** Remembered position + size per piece per placed-together combination. */
  outfitComboLayouts?: Record<string, { x?: number; y?: number; scale?: number }>;
  /** Locked left→right order per same-layer combination (setKey → categories). */
  outfitLayerArrangements?: Record<string, string[]>;
  /** When true, restore the saved category rules on startup. */
  outfitAutoPopulateRules?: boolean;
  /** Category rules to restore on startup when auto-populate is on. */
  outfitStartupRules?: { categories: string[]; count: number }[];
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
