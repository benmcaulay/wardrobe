import type { Color, StylePrefs } from "@/lib/json";
import { FAVORITE_COLOR_OPTIONS } from "@/lib/preferences";

export function normalizeColorName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Returns a canonical `#rrggbb` string, or "" when the input isn't a valid hex color. */
export function normalizeHex(value: string): string {
  const v = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v)) {
    return "#" + [...v.slice(1)].map((c) => c + c).join("");
  }
  return "";
}

function dedupeColorsOrdered(list: readonly Color[]): Color[] {
  const seen = new Set<string>();
  const out: Color[] = [];
  for (const raw of list) {
    const name = normalizeColorName(raw?.name ?? "");
    if (!name || seen.has(name)) continue;
    const hex = normalizeHex(raw?.hex ?? "") || "#888888";
    seen.add(name);
    out.push({ hex, name });
  }
  return out;
}

export function sanitizeColorList(list: readonly Color[]): Color[] {
  return dedupeColorsOrdered(list);
}

/** Built-in default palette (also the picker when no custom list is saved). */
export const DEFAULT_COLORS: Color[] = FAVORITE_COLOR_OPTIONS.map((c) => ({ ...c }));

/** Single source for the color palette shown in item forms, settings, and filters. */
export function getColorsListFromPrefs(prefs: StylePrefs): Color[] {
  const fromPrefs = prefs.colorsList;
  if (Array.isArray(fromPrefs) && fromPrefs.length > 0) {
    return sanitizeColorList(fromPrefs);
  }
  return DEFAULT_COLORS.map((c) => ({ ...c }));
}

/**
 * ── Favourites ──────────────────────────────────────────────────────────────
 *
 * A favourite is a *name* from the palette above, not a colour of its own, so
 * these helpers all match by normalised name — the same way the palette itself
 * dedupes. Storing the name rather than the hex means re-picking a shade keeps
 * the favourite; the old exact-string `includes` check quietly lost the mark
 * when a name differed by case or spacing.
 */

/** Favourite names from prefs, deduped and limited to colours that still exist. */
export function getFavoriteColorNames(prefs: StylePrefs): string[] {
  const palette = new Set(getColorsListFromPrefs(prefs).map((c) => normalizeColorName(c.name)));
  return sanitizeFavoriteColorNames(prefs.favoriteColors).filter((name) =>
    palette.has(normalizeColorName(name)),
  );
}

/** Deduped, blank-free, order preserved. */
export function sanitizeFavoriteColorNames(names: readonly string[] | undefined | null): string[] {
  if (!Array.isArray(names)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const key = normalizeColorName(raw ?? "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

export function isFavoriteColor(favorites: readonly string[], name: string): boolean {
  const key = normalizeColorName(name);
  if (!key) return false;
  return favorites.some((f) => normalizeColorName(f) === key);
}

/** Add or drop a favourite, keeping the rest in order. */
export function toggleFavoriteColor(favorites: readonly string[], name: string): string[] {
  const key = normalizeColorName(name);
  if (!key) return sanitizeFavoriteColorNames(favorites);
  const clean = sanitizeFavoriteColorNames(favorites);
  return isFavoriteColor(clean, key) ? clean.filter((f) => f !== key) : [...clean, key];
}
