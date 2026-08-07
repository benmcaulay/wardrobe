/**
 * Which closet filter controls a user wants on screen.
 *
 * Hiding is a personal display preference, not a feature removal — the filter
 * still works, it just isn't rendered for you. Someone who never sorts by
 * season shouldn't have to look at a Season control forever.
 *
 * Search and sort are deliberately not hideable: search is the primary way
 * into a large closet, and hiding sort would strand the grid in one order with
 * no way to change it.
 */

import type { ActiveFilters } from "@/components/closet-filters";
import type { StylePrefs } from "@/lib/json";

export const CLOSET_FILTER_KEYS = [
  "owner",
  "category",
  "brand",
  "color",
  "season",
  "tag",
] as const;

export type ClosetFilterKey = (typeof CLOSET_FILTER_KEYS)[number];

export const CLOSET_FILTER_LABELS: Record<ClosetFilterKey, { label: string; hint: string }> = {
  owner: { label: "Owner", hint: "Whose wardrobe you're looking at" },
  category: { label: "Category", hint: "Tops, shoes, outerwear…" },
  brand: { label: "Brand", hint: "Filter to one label" },
  color: { label: "Color", hint: "Filter by colour" },
  season: { label: "Season", hint: "Spring, summer, fall, winter" },
  tag: { label: "Tag", hint: "Your own style tags" },
};

export function isClosetFilterKey(value: string): value is ClosetFilterKey {
  return (CLOSET_FILTER_KEYS as readonly string[]).includes(value);
}

/** Drop unknown and duplicate keys so bad stored data can't hide everything. */
export function sanitizeHiddenFilters(list: readonly string[] | undefined): ClosetFilterKey[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<ClosetFilterKey>();
  for (const raw of list) {
    if (typeof raw !== "string") continue;
    const key = raw.trim().toLowerCase();
    if (isClosetFilterKey(key)) seen.add(key);
  }
  return CLOSET_FILTER_KEYS.filter((k) => seen.has(k));
}

export function getHiddenFiltersFromPrefs(prefs: StylePrefs): ClosetFilterKey[] {
  return sanitizeHiddenFilters(prefs.hiddenClosetFilters);
}

export function isFilterVisible(
  key: ClosetFilterKey,
  hidden: readonly ClosetFilterKey[],
): boolean {
  return !hidden.includes(key);
}

/**
 * Blank out any filter the user has hidden.
 *
 * Without this you could filter to Season=summer, hide the Season control, and
 * be left with a silently filtered closet and no visible way to clear it.
 */
export function clearHiddenFilterValues(
  filters: ActiveFilters,
  hidden: readonly ClosetFilterKey[],
): ActiveFilters {
  if (hidden.length === 0) return filters;
  return {
    ...filters,
    owner: isFilterVisible("owner", hidden) ? filters.owner : "",
    categories: isFilterVisible("category", hidden) ? filters.categories : [],
    brand: isFilterVisible("brand", hidden) ? filters.brand : "",
    colors: isFilterVisible("color", hidden) ? filters.colors : [],
    season: isFilterVisible("season", hidden) ? filters.season : "",
    tag: isFilterVisible("tag", hidden) ? filters.tag : "",
  };
}

/** Toggle one key, returning a fresh sanitized list. */
export function toggleHiddenFilter(
  hidden: readonly ClosetFilterKey[],
  key: ClosetFilterKey,
  hide: boolean,
): ClosetFilterKey[] {
  const next = new Set(hidden);
  if (hide) next.add(key);
  else next.delete(key);
  return CLOSET_FILTER_KEYS.filter((k) => next.has(k));
}
