import { isNoneCategoryStored, NONE_CATEGORY } from "@/lib/categories";
import type { ActiveFilters } from "@/components/closet-filters";
import { parseMultiFilterParam } from "@/lib/closet-filter-params";
import { parseColors, parseStringArray } from "@/lib/json";
import { normalizeStyleTagName } from "@/lib/preferences";
import { SHARED_OWNER_FILTER } from "@/lib/owners";
import {
  readClosetSort,
  sortWardrobeItems,
  type SortableItem,
  type SortOrders,
} from "@/lib/closet-sort";

/** URL param for “uncategorized” filter (empty string in DB). */
export const FILTER_CATEGORY_NONE = "__none__";

export type ClosetFilterableItem = {
  id: string;
  name: string;
  brand: string | null;
  category: string;
  subcategory: string | null;
  pattern: string | null;
  material: string | null;
  styleTags: string;
  notes: string | null;
  season: string;
  colors: string;
  /** JSON string[] of owner ids, already resolved so it's never empty. */
  owners: string;
  isWishlist: boolean;
  createdAt: Date;
};

export function readFiltersFromSearchParams(params: {
  q?: string;
  category?: string;
  brand?: string;
  color?: string;
  season?: string;
  tag?: string;
  owner?: string;
  sort?: string;
}): ActiveFilters {
  return {
    q: (params.q ?? "").trim(),
    categories: parseMultiFilterParam(params.category),
    brand: params.brand ?? "",
    colors: parseMultiFilterParam(params.color),
    season: params.season ?? "",
    tag: params.tag ?? "",
    owner: params.owner ?? "",
    sort: readClosetSort(params.sort),
  };
}

export function readFiltersFromQueryString(qs: string): ActiveFilters {
  const p = new URLSearchParams(qs);
  return readFiltersFromSearchParams({
    q: p.get("q") ?? undefined,
    category: p.get("category") ?? undefined,
    brand: p.get("brand") ?? undefined,
    color: p.get("color") ?? undefined,
    season: p.get("season") ?? undefined,
    tag: p.get("tag") ?? undefined,
    owner: p.get("owner") ?? undefined,
    sort: p.get("sort") ?? undefined,
  });
}

function itemHasStyleTag(styleTagsJson: string, tag: string): boolean {
  const want = normalizeStyleTagName(tag);
  if (!want) return true;
  return parseStringArray(styleTagsJson).some((t) => normalizeStyleTagName(t) === want);
}

function itemMatchesTextQuery(item: ClosetFilterableItem, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    item.name,
    item.brand ?? "",
    item.category,
    item.subcategory ?? "",
    item.pattern ?? "",
    item.material ?? "",
    item.notes ?? "",
    ...parseStringArray(item.styleTags),
    ...parseStringArray(item.season),
    ...parseColors(item.colors).map((c) => c.name),
  ]
    .join("\n")
    .toLowerCase();
  return haystack.includes(needle);
}

function itemMatchesCategoryFilter(item: ClosetFilterableItem, categories: string[]): boolean {
  if (categories.length === 0) return true;
  const cat = item.category.trim();
  return categories.some((c) => {
    if (c === FILTER_CATEGORY_NONE) return isNoneCategoryStored(cat);
    return c === cat;
  });
}

function itemMatchesColorFilter(item: ClosetFilterableItem, colors: string[]): boolean {
  if (colors.length === 0) return true;
  const names = parseColors(item.colors).map((c) => c.name.trim().toLowerCase());
  return colors.some((c) => names.includes(c.trim().toLowerCase()));
}

function itemMatchesSeasonFilter(item: ClosetFilterableItem, season: string): boolean {
  if (!season) return true;
  const want = season.trim().toLowerCase();
  return parseStringArray(item.season).some((s) => s.trim().toLowerCase() === want);
}

/**
 * Owner filter. "" = everyone; SHARED = 2+ owners; otherwise items whose owner
 * set includes that owner id — so a person's view also surfaces shared items.
 */
function itemMatchesOwnerFilter(item: ClosetFilterableItem, owner: string): boolean {
  if (!owner) return true;
  const ids = parseStringArray(item.owners);
  if (owner === SHARED_OWNER_FILTER) return ids.length >= 2;
  return ids.includes(owner);
}

/** Client-side mirror of server closet filters (instant, no navigation). */
/**
 * Generic over the caller's row, not fixed to `ClosetFilterableItem`.
 *
 * Filtering reads a known set of fields and cares about nothing else, so it
 * should hand back exactly what it was given. Pinning the return type to
 * `ClosetFilterableItem` erased whatever else the caller's rows carried —
 * which is why the closet grid couldn't read `imagePath` off its own items
 * after filtering them.
 */
export function filterClosetItems<T extends ClosetFilterableItem>(
  items: readonly T[],
  filters: ActiveFilters,
): T[] {
  return items.filter((item) => {
    if (filters.brand && item.brand !== filters.brand) return false;
    if (!itemMatchesCategoryFilter(item, filters.categories)) return false;
    if (!itemMatchesColorFilter(item, filters.colors)) return false;
    if (!itemMatchesSeasonFilter(item, filters.season)) return false;
    if (!itemMatchesOwnerFilter(item, filters.owner)) return false;
    if (filters.tag && !itemHasStyleTag(item.styleTags, filters.tag)) return false;
    if (!itemMatchesTextQuery(item, filters.q)) return false;
    return true;
  });
}

/**
 * Filter then sort. The constraint is the intersection of what each half needs:
 * filtering wants the filterable fields, sorting additionally wants a price and
 * a created-at to order by.
 */
export function filterSortClosetItems<T extends ClosetFilterableItem & SortableItem>(
  items: readonly T[],
  filters: ActiveFilters,
  sortOrders: SortOrders,
): T[] {
  const filtered = filterClosetItems(items, filters);
  return sortWardrobeItems(filtered, filters.sort, sortOrders);
}
