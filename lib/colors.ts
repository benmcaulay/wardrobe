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
