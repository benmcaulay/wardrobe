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
