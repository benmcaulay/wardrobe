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

  { kind: "outerwear", match: /(outerwear|outer layer|\bcoat|jacket|parka|puffer|windbreaker|raincoat|anorak|overcoat|trench|blazer|vest|gilet|\bsuit\b)/ },
  { kind: "shoes", match: /(shoe|sneaker|trainer|boot|sandal|heel|loafer|flip.?flop|slide|clog|croc|espadrille|moccasin|footwear)/ },
  { kind: "bottom", match: /(bottom|pant|trouser|jean|denim|short|skirt|legging|chino|jogger|slack|culotte|capri|cargo|trunks|boxer|brief)/ },
  { kind: "dress", match: /(dress|gown|frock|jumpsuit|romper|overall|kimono|robe)/ },
  // `tops?` not `\btop\b`: the plural is a very common category label and the
  // singular-only form silently sent every "tops" item down the generic prompt.
  { kind: "top", match: /(\btops?\b|shirt|tee\b|tees\b|t-shirt|tank|polo|blouse|sweater|hoodie|sweatshirt|jumper|cardigan|knit|fleece|turtleneck|camisole|bodysuit|flannel|button.?up|button.?down|jersey|thermal|base layer)/ },
  { kind: "accessory", match: /(accessor|hat|headwear|cap\b|caps\b|beanie|scarf|scarves|belt|glove|sunglass|jewel|watch|ring\b|necklace|bracelet|earring|bag\b|bags\b|purse|backpack|tote|tie\b|sock|wallet)/ },
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
  /**
   * User-assigned shapes by normalised category name. Consulted before any text
   * inference, because it is an answer rather than a guess.
   */
  categoryShapes?: Record<string, GarmentKind> | null;
}): GarmentKind {
  // Category is the strongest signal — try it alone before letting the name in,
  // so a "Beach Shirt Dress" categorised as "dress" isn't read as a shirt.
  const category = normalizeCategoryName(input.category ?? "");

  // An explicit choice beats inference outright: no regex can tell what shape
  // "workwear" or "favorites" is, and the user already told us.
  const assigned = category ? input.categoryShapes?.[category] : undefined;
  if (assigned) return assigned;

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

/**
 * Pick the closest label from the user's OWN category list for an item whose
 * kind we can infer.
 *
 * The add flow ships every new item with category "None" (see lib/prefill.ts),
 * so choosing a category was always a mandatory two-click detour — and since
 * `requireGhostCategory` refuses an unclassifiable item, it also blocked AI
 * generation on every fresh add. Inferring from the name closes both.
 *
 * Returns null when nothing is inferable, so the caller keeps "None" rather
 * than guessing — a wrong category is worse than an empty one.
 */
/**
 * `GarmentKind` is deliberately coarse — "bottom" covers both shorts and pants,
 * "top" covers shirts and sweaters — so a closet offering several labels of one
 * kind can't be resolved by kind alone. Taking the first match suggested
 * "shorts" for "Levi's 501 Jeans", which is worse than suggesting nothing.
 *
 * Each rule: if the item text matches `when`, prefer a same-kind label matching
 * `prefer`. Ordered most-specific first, like GARMENT_KIND_RULES.
 */
const SAME_KIND_TIEBREAK: { when: RegExp; prefer: RegExp }[] = [
  { when: /short/, prefer: /short/ },
  {
    when: /(pant|jean|denim|trouser|chino|slack|legging|jogger|capri|culotte)/,
    prefer: /(pant|trouser|jean|denim|bottom)/,
  },
  {
    when: /(sweater|hoodie|sweatshirt|cardigan|fleece|knit|jumper|turtleneck)/,
    prefer: /(sweater|hoodie|sweatshirt|cardigan|fleece|knit|jumper)/,
  },
  {
    when: /(jacket|coat|parka|puffer|blazer|vest|windbreaker|anorak)/,
    prefer: /(jacket|coat|outer|blazer|vest)/,
  },
];

export function suggestCategoryFromItem(
  item: { category?: string | null; subcategory?: string | null; name?: string | null },
  options: readonly string[],
): string | null {
  const kind = classifyGarmentKind(item);
  if (kind === "other") return null;

  // Match against the user's own labels by classifying them the same way, so a
  // closet using "sweater/hoodie" resolves without a second synonym table.
  const sameKind = options.filter((o) => classifyGarmentKind({ category: o }) === kind);
  if (sameKind.length === 0) return null;
  if (sameKind.length === 1) return sameKind[0]!;

  const text = normalizeCategoryName(
    `${item.category ?? ""} ${item.subcategory ?? ""} ${item.name ?? ""}`,
  );
  for (const rule of SAME_KIND_TIEBREAK) {
    if (!rule.when.test(text)) continue;
    const hit = sameKind.find((o) => rule.prefer.test(normalizeCategoryName(o)));
    if (hit) return hit;
  }

  // Nothing disambiguates — fall back to the user's own ordering.
  return sameKind[0]!;
}

/**
 * Categories whose shape cannot be inferred from their name, so the ghost
 * pipeline would fall back to the generic "guess the type" prompt (and, with
 * `requireGhostCategory`, refuse to generate at all).
 *
 * Settings surfaces these so the user can answer once per label.
 */
export function categoriesNeedingShape(
  options: readonly string[],
  shapes: Record<string, GarmentKind> | null | undefined,
): string[] {
  return options.filter((o) => {
    const key = normalizeCategoryName(o);
    if (!key || isNoneCategoryStored(key)) return false;
    if (shapes?.[key]) return false;
    return classifyGarmentKind({ category: o }) === "other";
  });
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
