import { parseColors, parseSeasons } from "@/lib/json";
import { compareClosetGroupOrder, closetGroupKey } from "@/lib/closet-group-order";
import { SEASONS } from "@/lib/types";

export type ClosetSortKey =
  | "newest"
  | "oldest"
  | "price_asc"
  | "price_desc"
  | "category_asc"
  | "category_desc"
  | "color_asc"
  | "color_desc"
  | "season_asc"
  | "season_desc";

const VALID: ReadonlySet<ClosetSortKey> = new Set([
  "newest",
  "oldest",
  "price_asc",
  "price_desc",
  "category_asc",
  "category_desc",
  "color_asc",
  "color_desc",
  "season_asc",
  "season_desc",
]);

export function readClosetSort(raw: string | undefined): ClosetSortKey {
  const s = (raw ?? "").trim();
  if (s && VALID.has(s as ClosetSortKey)) return s as ClosetSortKey;
  return "newest";
}

/**
 * The sort UI presents a base field plus a direction arrow (down = forward /
 * default, up = reversed). These helpers translate between that model and the
 * persisted `ClosetSortKey`.
 */
export type ClosetSortField = "recent" | "price" | "category" | "color" | "season";

export const SORT_FIELD_OPTIONS: { value: ClosetSortField; label: string }[] = [
  { value: "recent", label: "Recently added" },
  { value: "price", label: "Price" },
  { value: "category", label: "Category" },
  { value: "color", label: "Color" },
  { value: "season", label: "Season" },
];

export function sortKeyFromField(field: ClosetSortField, reversed: boolean): ClosetSortKey {
  switch (field) {
    case "recent":
      return reversed ? "oldest" : "newest";
    case "price":
      return reversed ? "price_desc" : "price_asc";
    case "category":
      return reversed ? "category_desc" : "category_asc";
    case "color":
      return reversed ? "color_desc" : "color_asc";
    case "season":
      return reversed ? "season_desc" : "season_asc";
  }
}

export function fieldFromSortKey(key: ClosetSortKey): { field: ClosetSortField; reversed: boolean } {
  switch (key) {
    case "newest":
      return { field: "recent", reversed: false };
    case "oldest":
      return { field: "recent", reversed: true };
    case "price_asc":
      return { field: "price", reversed: false };
    case "price_desc":
      return { field: "price", reversed: true };
    case "category_asc":
      return { field: "category", reversed: false };
    case "category_desc":
      return { field: "category", reversed: true };
    case "color_asc":
      return { field: "color", reversed: false };
    case "color_desc":
      return { field: "color", reversed: true };
    case "season_asc":
      return { field: "season", reversed: false };
    case "season_desc":
      return { field: "season", reversed: true };
  }
}

export type SortableItem = {
  id: string;
  createdAt: Date;
  priceCents: number | null;
  category: string;
  colors: string;
  season: string;
};

/** Optional user-defined orderings (names in preferred order) for category/color sorts. */
export type SortOrders = {
  categoryOrder?: readonly string[];
  colorOrder?: readonly string[];
  closetGroupOrders?: Record<string, readonly string[]>;
};

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

function buildIndexMap(order?: readonly string[]): Map<string, number> | undefined {
  if (!order || order.length === 0) return undefined;
  const m = new Map<string, number>();
  order.forEach((name, i) => {
    const key = normalizeKey(name);
    if (key && !m.has(key)) m.set(key, i);
  });
  return m.size ? m : undefined;
}

function firstColorKey(colorsJson: string): string {
  const c = parseColors(colorsJson);
  return normalizeKey(c[0]?.name ?? "");
}

function categoryKey(category: string): string {
  return normalizeKey(category);
}

function minSeasonIndex(seasonJson: string): number {
  const arr = parseSeasons(seasonJson);
  if (arr.length === 0) return 99;
  let m = 99;
  for (const s of arr) {
    const i = SEASONS.indexOf(s);
    if (i >= 0 && i < m) m = i;
  }
  return m;
}

function comparePrice(a: number | null, b: number | null, desc: boolean): number {
  const aMissing = a === null;
  const bMissing = b === null;
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  return desc ? b - a : a - b;
}

/**
 * Ascending comparison of a token. When a custom order map is supplied, items
 * are ordered by their index in that list (unknown tokens sort last), with an
 * alphabetic tie-break; otherwise it falls back to plain alphabetic order.
 * Empty tokens always sort last.
 */
function compareToken(ka: string, kb: string, map?: Map<string, number>): number {
  if (map) {
    const ia = ka ? (map.get(ka) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
    const ib = kb ? (map.get(kb) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
    if (ia !== ib) return ia - ib;
  }
  const sa = ka || "\uffff";
  const sb = kb || "\uffff";
  return sa.localeCompare(sb, undefined, { sensitivity: "base" });
}

/** Stable sort: primary key from `sort`, then implicit tie-break, then newest first. */
export function sortWardrobeItems<T extends SortableItem>(
  items: T[],
  sort: ClosetSortKey,
  orders?: SortOrders,
): T[] {
  if (sort === "newest") {
    return [...items].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
  if (sort === "oldest") {
    return [...items].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  const catMap = buildIndexMap(orders?.categoryOrder);
  const colMap = buildIndexMap(orders?.colorOrder);

  return [...items].sort((a, b) => {
    let cmp = 0;
    // Implicit secondary sort applied within equal primary values. Color and
    // category cross-tie-break each other so grouped items stay organized.
    let secondary = 0;
    switch (sort) {
      case "price_asc":
      case "price_desc":
        cmp = comparePrice(a.priceCents, b.priceCents, sort === "price_desc");
        break;
      case "category_asc":
      case "category_desc": {
        cmp = compareToken(categoryKey(a.category), categoryKey(b.category), catMap);
        if (sort === "category_desc") cmp = -cmp;
        secondary = compareToken(firstColorKey(a.colors), firstColorKey(b.colors), colMap);
        break;
      }
      case "color_asc":
      case "color_desc": {
        cmp = compareToken(firstColorKey(a.colors), firstColorKey(b.colors), colMap);
        if (sort === "color_desc") cmp = -cmp;
        secondary = compareToken(categoryKey(a.category), categoryKey(b.category), catMap);
        break;
      }
      case "season_asc":
      case "season_desc": {
        cmp = minSeasonIndex(a.season) - minSeasonIndex(b.season);
        if (sort === "season_desc") cmp = -cmp;
        break;
      }
      default:
        cmp = 0;
    }
    if (cmp !== 0) return cmp;
    if (secondary !== 0) return secondary;
    if (
      categoryKey(a.category) === categoryKey(b.category) &&
      firstColorKey(a.colors) === firstColorKey(b.colors)
    ) {
      const groupCmp = compareClosetGroupOrder(
        a.id,
        b.id,
        closetGroupKey(a.category, a.colors),
        orders?.closetGroupOrders,
      );
      if (groupCmp !== 0) return groupCmp;
    }
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
}
