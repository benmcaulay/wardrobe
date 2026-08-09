import type { StylePrefs } from "@/lib/json";

export const DEFAULT_CATEGORIES = [
  "top",
  "bottom",
  "dress",
  "outerwear",
  "shoes",
  "accessory",
] as const;

/** Default category for new items and after a wardrobe category is removed. */
export const NONE_CATEGORY = "None";

export function normalizeCategoryName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * What kind of garment something is, independent of what the user called it.
 *
 * `DEFAULT_CATEGORIES` are only a *starting suggestion* — categories are
 * user-editable, and real closets end up with "shirt", "sweater/hoodie",
 * "jacket", "pants". Anything that reasons about garment kind therefore cannot
 * compare against the canonical names directly; `normalizeCategoryName` just
 * lowercases and trims, it does not resolve synonyms.
 *
 * SmartPakker learned this the hard way: its bucket lookup compared normalized
 * names to the canonical set, so on a closet using natural names 82% of items
 * fell into "other" (whose packing target is 0) and the planner returned a bag
 * with no clothes in it. This function is the shared fix.
 *
 * Note `outfitRegion` in lib/outfit-slot-defaults.ts is a deliberately
 * *different* taxonomy — it answers "where on the body does this render", so it
 * merges tops with outerwear and treats hats as their own region. Don't
 * consolidate them without checking both callers.
 */
export type GarmentKind =
  | "top"
  | "bottom"
  | "dress"
  | "outerwear"
  | "shoes"
  | "accessory"
  | "other";

/**
 * Ordered most-specific first — the first rule that matches wins, which is what
 * keeps the awkward overlaps right: "dress shirt" is a top not a dress,
 * "sweatpants" is a bottom not a sweater, "bootcut jeans" is a bottom not a
 * boot. Add new rules in the position their specificity demands, not the end.
 */
const GARMENT_KIND_RULES: { kind: GarmentKind; match: RegExp }[] = [
  // Compound terms that would otherwise be captured by a broader rule below.
  { kind: "top", match: /\b(dress shirt|dress top)\b/ },
  { kind: "bottom", match: /\b(dress pant|dress trouser|sweatpant|track pant|bootcut|boot cut)/ },

  { kind: "outerwear", match: /(outerwear|outer layer|\bcoat|jacket|parka|puffer|windbreaker|raincoat|anorak|overcoat|trench|blazer|vest|gilet)/ },
  { kind: "shoes", match: /(shoe|sneaker|trainer|boot|sandal|heel|loafer|flip.?flop|slide|clog|croc|espadrille|moccasin|footwear)/ },
  { kind: "bottom", match: /(bottom|pant|trouser|jean|denim|short|skirt|legging|chino|jogger|slack|culotte|capri)/ },
  { kind: "dress", match: /(dress|gown|frock|jumpsuit|romper|overall)/ },
  { kind: "top", match: /(\btop\b|shirt|tee|t-shirt|tank|polo|blouse|sweater|hoodie|sweatshirt|jumper|cardigan|knit|fleece|turtleneck|camisole|bodysuit)/ },
  { kind: "accessory", match: /(accessor|hat|cap\b|beanie|scarf|belt|glove|sunglass|jewel|watch|ring\b|necklace|bracelet|earring|bag\b|purse|backpack|tote|tie\b|sock|wallet)/ },
];

/**
 * Classify a garment by category, falling back to its subcategory and name.
 * Widening the text is what rescues items whose category is vague ("other",
 * "None") but whose name is obvious ("Wool Overcoat").
 */
export function classifyGarmentKind(input: {
  category?: string | null;
  subcategory?: string | null;
  name?: string | null;
}): GarmentKind {
  // Category is the strongest signal — try it alone before letting the name in,
  // so a "Beach Shirt Dress" categorised as "dress" isn't read as a shirt.
  const category = normalizeCategoryName(input.category ?? "");
  if (category && !isNoneCategoryStored(category)) {
    for (const rule of GARMENT_KIND_RULES) {
      if (rule.match.test(category)) return rule.kind;
    }
  }

  const detail = normalizeCategoryName(`${input.subcategory ?? ""} ${input.name ?? ""}`);
  if (detail) {
    for (const rule of GARMENT_KIND_RULES) {
      if (rule.match.test(detail)) return rule.kind;
    }
  }

  return "other";
}

function dedupeOrdered(labels: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of labels) {
    const key = normalizeCategoryName(raw);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(raw.trim());
  }
  return out;
}

/** Migrate old stylePrefs.category fields into single ordered list */
function migrateLegacyCategoriesList(prefs: StylePrefs): string[] | null {
  if (
    !prefs.customCategories?.length &&
    !prefs.categoryOrder?.length &&
    !prefs.hiddenCategories?.length
  ) {
    return null;
  }
  const hidden = new Set((prefs.hiddenCategories ?? []).map(normalizeCategoryName).filter(Boolean));
  const normalizedCustom = (prefs.customCategories ?? []).map(normalizeCategoryName).filter(Boolean);
  const combined = [...DEFAULT_CATEGORIES, ...normalizedCustom].filter(
    (name) => !hidden.has(normalizeCategoryName(name)),
  );
  const unique = [...new Set(combined)];
  const ordered = (prefs.categoryOrder ?? [])
    .map(normalizeCategoryName)
    .filter((name) => unique.includes(name));
  const remainder = unique.filter((name) => !ordered.includes(name));
  return [...ordered, ...remainder];
}

/** Single source for closet/add/edit/category filters */
export function getCategoriesListFromPrefs(prefs: StylePrefs): string[] {
  const fromNew = prefs.categoriesList;
  if (Array.isArray(fromNew) && fromNew.length > 0) {
    return sanitizeCategoryList(fromNew);
  }
  const legacy = migrateLegacyCategoriesList(prefs);
  if (legacy && legacy.length > 0) return legacy;
  return [...DEFAULT_CATEGORIES];
}

export function sanitizeCategoryList(list: readonly string[]): string[] {
  return dedupeOrdered(list);
}

/** @deprecated use getCategoriesListFromPrefs — same behavior */
export const getOrderedCategories = getCategoriesListFromPrefs;

/**
 * Resolve persisted category against allowed picker labels + empty/no category.
 * Unknown labels are kept verbatim so items don't break before list updates.
 */
export function canonicalCategoryChoice(
  raw: string | undefined | null,
  options: string[],
): string {
  const t = normalizeCategoryName(raw ?? "");
  if (!t || t === normalizeCategoryName(NONE_CATEGORY)) return NONE_CATEGORY;
  const source = options.length > 0 ? options : [...DEFAULT_CATEGORIES];
  const hit = source.find((o) => normalizeCategoryName(o) === t);
  if (hit) return hit.trim();
  return raw!.trim();
}

/** Empty DB value or explicit None bucket (legacy `""` supported). */
export function isNoneCategoryStored(value: string | undefined | null): boolean {
  const t = normalizeCategoryName(value ?? "");
  return !t || t === normalizeCategoryName(NONE_CATEGORY);
}
