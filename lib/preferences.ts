import type { StylePrefs } from "@/lib/json";

export const STYLE_OPTIONS = [
  "minimal",
  "classic",
  "romantic",
  "streetwear",
  "preppy",
  "vintage",
  "workwear",
  "going-out",
  "cozy",
  "relaxed",
  "tailored",
  "athletic",
] as const;

/**
 * Built-in default style tags (also the default picker when no custom list is saved).
 * Items can still store tags outside this list — the form shows them so they can be cleared.
 */
export const COMMON_STYLE_TAGS = [
  "minimal",
  "classic",
  "casual",
  "romantic",
  "streetwear",
  "vintage",
  "workwear",
  "cozy",
  "tailored",
  "going-out",
] as const;

/** Default tag picker when `styleTagsList` is unset in stylePrefs. */
export const DEFAULT_STYLE_TAG_LIST: string[] = [...COMMON_STYLE_TAGS];

export function normalizeStyleTagName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function dedupeStyleTagsOrdered(labels: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of labels) {
    const key = normalizeStyleTagName(raw);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(raw.trim());
  }
  return out;
}

export function sanitizeStyleTagsList(list: readonly string[]): string[] {
  return dedupeStyleTagsOrdered(list);
}

/** Style tags shown as chips on item forms — user list from prefs or built-in defaults. */
export function getStyleTagsListFromPrefs(prefs: StylePrefs): string[] {
  const fromPrefs = prefs.styleTagsList;
  if (Array.isArray(fromPrefs) && fromPrefs.length > 0) {
    return sanitizeStyleTagsList(fromPrefs);
  }
  return [...DEFAULT_STYLE_TAG_LIST];
}

export const FAVORITE_COLOR_OPTIONS: readonly { hex: string; name: string }[] = [
  { hex: "#111111", name: "black" },
  { hex: "#ffffff", name: "white" },
  { hex: "#8a8a8a", name: "gray" },
  { hex: "#c0392b", name: "red" },
  { hex: "#d97a3b", name: "orange" },
  { hex: "#d9b94a", name: "yellow" },
  { hex: "#4a8c5a", name: "green" },
  { hex: "#4a6fb0", name: "blue" },
  { hex: "#7a4fb0", name: "purple" },
  { hex: "#e8b4c8", name: "pink" },
  { hex: "#7a4f2a", name: "brown" },
  { hex: "#d4b896", name: "beige" },
];

export const SIZE_SLOTS = [
  { key: "top", label: "Top" },
  { key: "bottom", label: "Bottom" },
  { key: "shoe", label: "Shoe" },
] as const;

export type SizeSlotKey = (typeof SIZE_SLOTS)[number]["key"];
