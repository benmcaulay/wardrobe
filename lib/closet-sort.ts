import { parseColors, parseSeasons } from "@/lib/json";
import { SEASONS } from "@/lib/types";

export type ClosetSortKey =
  | "newest"
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

export const CLOSET_SORT_OPTIONS: { value: ClosetSortKey; label: string }[] = [
  { value: "newest", label: "Recently added" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
  { value: "category_asc", label: "Category: A to Z" },
  { value: "category_desc", label: "Category: Z to A" },
  { value: "color_asc", label: "Color: A to Z" },
  { value: "color_desc", label: "Color: Z to A" },
  { value: "season_asc", label: "Season: spring first" },
  { value: "season_desc", label: "Season: winter first" },
];

type SortableItem = {
  createdAt: Date;
  priceCents: number | null;
  category: string;
  colors: string;
  season: string;
};

function firstColorSortToken(colorsJson: string): string {
  const c = parseColors(colorsJson);
  const name = c[0]?.name?.trim().toLowerCase() ?? "";
  return name || "\uffff";
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

function categoryKey(category: string): string {
  return category.trim().toLowerCase() || "\uffff";
}

/** Stable sort: primary key from `sort`, then newest first. */
export function sortWardrobeItems<T extends SortableItem>(items: T[], sort: ClosetSortKey): T[] {
  if (sort === "newest") return [...items].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return [...items].sort((a, b) => {
    let cmp = 0;
    switch (sort) {
      case "price_asc":
      case "price_desc":
        cmp = comparePrice(a.priceCents, b.priceCents, sort === "price_desc");
        break;
      case "category_asc":
      case "category_desc": {
        cmp = categoryKey(a.category).localeCompare(categoryKey(b.category), undefined, {
          sensitivity: "base",
        });
        if (sort === "category_desc") cmp = -cmp;
        break;
      }
      case "color_asc":
      case "color_desc": {
        cmp = firstColorSortToken(a.colors).localeCompare(firstColorSortToken(b.colors), undefined, {
          sensitivity: "base",
        });
        if (sort === "color_desc") cmp = -cmp;
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
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
}
