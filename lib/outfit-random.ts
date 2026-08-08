import { normalizeCategoryName, isNoneCategoryStored } from "@/lib/categories";
import { normalizeColorName } from "@/lib/colors";
import type { Color } from "@/lib/json";

export type OutfitPickItem = {
  id: string;
  category: string;
  colors: Color[];
};

export type CategoryRule = {
  /** OR list — item matches if its category equals any entry (exact, case-insensitive). */
  categories: string[];
  count: number;
};

export type ColorRule = {
  colorName: string;
  count: number;
};

/** Clean persisted category rules (for restoring the selection on startup). */
export function sanitizeCategoryRules(raw: unknown): CategoryRule[] {
  if (!Array.isArray(raw)) return [];
  const out: CategoryRule[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const rawCats = (r as { categories?: unknown }).categories;
    const cats = Array.isArray(rawCats)
      ? [
          ...new Set(
            rawCats
              .filter((c): c is string => typeof c === "string" && c.trim().length > 0)
              .map((c) => c.trim()),
          ),
        ]
      : [];
    if (cats.length === 0) continue;
    const rawCount = (r as { count?: unknown }).count;
    const count =
      typeof rawCount === "number" && Number.isFinite(rawCount)
        ? Math.max(1, Math.min(9, Math.floor(rawCount)))
        : 1;
    out.push({ categories: cats, count });
  }
  return out;
}

export type OutfitSlotInput = {
  id: string;
  categories: string[];
  lockedItemId?: string;
};

export function categoryListSignature(categories: readonly string[]): string {
  return [...categories]
    .map((c) => normalizeCategoryName(c))
    .filter(Boolean)
    .sort()
    .join("\0");
}

export function formatCategoryList(categories: readonly string[]): string {
  return categories.map((c) => c.trim()).filter(Boolean).join(" / ");
}

/** Exact category match against an OR list — no aliasing or grouping. */
export function itemMatchesCategories(item: OutfitPickItem, categories: readonly string[]): boolean {
  if (isNoneCategoryStored(item.category)) return false;
  if (categories.length === 0) return false;
  const itemKey = normalizeCategoryName(item.category);
  return categories.some((c) => normalizeCategoryName(c) === itemKey);
}

/** Expand rules into one slot descriptor per required piece. */
export function expandCategoryRules(
  rules: CategoryRule[],
): { categories: string[]; key: string }[] {
  const out: { categories: string[]; key: string }[] = [];
  for (const rule of rules) {
    const cats = rule.categories.map((c) => c.trim()).filter(Boolean);
    if (cats.length === 0) continue;
    const n = Math.max(0, Math.floor(rule.count));
    const sig = categoryListSignature(cats);
    for (let i = 0; i < n; i++) {
      out.push({ categories: [...cats], key: `${sig}:${i}` });
    }
  }
  return out;
}

/** Primary (star) color — the same one used for closet sorting. */
export function itemPrimaryColorName(item: OutfitPickItem): string | null {
  const name = item.colors[0]?.name?.trim();
  return name || null;
}

export function itemMatchesColorRule(item: OutfitPickItem, colorName: string): boolean {
  const key = normalizeColorName(colorName);
  if (!key) return false;
  const primary = itemPrimaryColorName(item);
  if (!primary) return false;
  return normalizeColorName(primary) === key;
}

function countPrimaryColors(items: OutfitPickItem[], colorName: string): number {
  let n = 0;
  for (const item of items) {
    if (itemMatchesColorRule(item, colorName)) n += 1;
  }
  return n;
}

function satisfiesColorRules(items: OutfitPickItem[], rules: ColorRule[]): boolean {
  for (const rule of rules) {
    const need = Math.max(0, Math.floor(rule.count));
    if (need === 0) continue;
    if (countPrimaryColors(items, rule.colorName) < need) return false;
  }
  return true;
}

function colorRulesStillPossible(
  picked: OutfitPickItem[],
  openSlotCount: number,
  pool: OutfitPickItem[],
  used: Set<string>,
  rules: ColorRule[],
): boolean {
  for (const rule of rules) {
    const need = Math.max(0, Math.floor(rule.count));
    if (need === 0) continue;
    const have = countPrimaryColors(picked, rule.colorName);
    if (have > need) return false;
    const remaining = need - have;
    if (remaining === 0) continue;
    const available = pool.filter(
      (i) => !used.has(i.id) && itemMatchesColorRule(i, rule.colorName),
    ).length;
    if (available + have < need) return false;
    if (remaining > openSlotCount) return false;
  }
  return true;
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export function pickRandomOutfit(
  items: OutfitPickItem[],
  slots: OutfitSlotInput[],
  colorRules: ColorRule[],
): Map<string, string> | null {
  if (slots.length === 0) return null;

  const pool = items.filter((i) => !isNoneCategoryStored(i.category));
  if (pool.length === 0) return null;

  const assignment = new Map<string, string>();
  const used = new Set<string>();
  const open: OutfitSlotInput[] = [];

  for (const slot of slots) {
    if (slot.lockedItemId) {
      const item = pool.find((i) => i.id === slot.lockedItemId);
      if (!item || !itemMatchesCategories(item, slot.categories)) return null;
      used.add(item.id);
      assignment.set(slot.id, item.id);
    } else {
      open.push(slot);
    }
  }

  const lockedItems = [...assignment.values()]
    .map((id) => pool.find((i) => i.id === id))
    .filter((i): i is OutfitPickItem => !!i);

  if (!satisfiesColorRules(lockedItems, colorRules) && open.length === 0) {
    return null;
  }

  const orderedOpen = shuffle(open);

  function backtrack(index: number): boolean {
    const picked = [...assignment.values()]
      .map((id) => pool.find((i) => i.id === id))
      .filter((i): i is OutfitPickItem => !!i);
    const openLeft = orderedOpen.length - index;

    if (index >= orderedOpen.length) {
      return satisfiesColorRules(picked, colorRules);
    }

    if (!colorRulesStillPossible(picked, openLeft, pool, used, colorRules)) {
      return false;
    }

    const slot = orderedOpen[index]!;
    const candidates = shuffle(
      pool.filter((i) => !used.has(i.id) && itemMatchesCategories(i, slot.categories)),
    );

    for (const pick of candidates) {
      used.add(pick.id);
      assignment.set(slot.id, pick.id);
      if (backtrack(index + 1)) return true;
      used.delete(pick.id);
      assignment.delete(slot.id);
    }
    return false;
  }

  return backtrack(0) ? assignment : null;
}

export function slotsMatchRules(
  placedSlots: { categories: string[] }[],
  rules: CategoryRule[],
): boolean {
  const required = expandCategoryRules(rules);
  const placedCounts = new Map<string, number>();
  for (const slot of placedSlots) {
    const key = categoryListSignature(slot.categories);
    if (!key) continue;
    placedCounts.set(key, (placedCounts.get(key) ?? 0) + 1);
  }
  const requiredCounts = new Map<string, number>();
  for (const req of required) {
    const key = categoryListSignature(req.categories);
    requiredCounts.set(key, (requiredCounts.get(key) ?? 0) + 1);
  }
  if (placedCounts.size !== requiredCounts.size) return false;
  for (const [key, count] of requiredCounts) {
    if ((placedCounts.get(key) ?? 0) !== count) return false;
  }
  return true;
}

export type OutfitFillIssue =
  | { kind: "no_rules" }
  | { kind: "missing_category"; category: string; need: number; have: number }
  | { kind: "missing_color"; colorName: string; need: number; have: number }
  | { kind: "slots_mismatch"; extra?: string[]; missing?: string[] }
  | { kind: "empty_closet" }
  | { kind: "no_combo" };

export function diagnoseOutfitFill(
  items: OutfitPickItem[],
  slots: OutfitSlotInput[],
  rules: CategoryRule[],
  colorRules: ColorRule[],
): OutfitFillIssue | null {
  const pool = items.filter((i) => !isNoneCategoryStored(i.category));
  if (pool.length === 0) return { kind: "empty_closet" };

  const activeRules = rules.filter((r) => r.count > 0 && r.categories.some((c) => c.trim()));
  if (activeRules.length === 0) return { kind: "no_rules" };

  if (!slotsMatchRules(slots, rules)) {
    const required = expandCategoryRules(rules);
    const reqCounts = new Map<string, number>();
    const reqLabels = new Map<string, string>();
    for (const r of required) {
      const sig = categoryListSignature(r.categories);
      reqCounts.set(sig, (reqCounts.get(sig) ?? 0) + 1);
      reqLabels.set(sig, formatCategoryList(r.categories));
    }
    const slotCounts = new Map<string, number>();
    for (const s of slots) {
      const sig = categoryListSignature(s.categories);
      if (!sig) continue;
      slotCounts.set(sig, (slotCounts.get(sig) ?? 0) + 1);
    }
    const missing: string[] = [];
    const extra: string[] = [];
    for (const [sig, need] of reqCounts) {
      const have = slotCounts.get(sig) ?? 0;
      const label = reqLabels.get(sig) ?? sig;
      if (have < need) missing.push(`${label} (${need - have} more)`);
    }
    for (const [sig, have] of slotCounts) {
      const need = reqCounts.get(sig) ?? 0;
      const label = reqLabels.get(sig) ?? sig;
      if (have > need) extra.push(`${label} (${have - need} extra)`);
      if (need === 0) extra.push(label);
    }
    return { kind: "slots_mismatch", missing, extra };
  }

  for (const rule of activeRules) {
    const label = formatCategoryList(rule.categories);
    const count = Math.max(0, Math.floor(rule.count));
    const available = pool.filter((i) => itemMatchesCategories(i, rule.categories)).length;
    if (available < count) {
      return { kind: "missing_category", category: label, need: count, have: available };
    }
  }

  for (const rule of colorRules) {
    const need = Math.max(0, Math.floor(rule.count));
    if (need === 0) continue;
    const withColor = pool.filter((i) => itemMatchesColorRule(i, rule.colorName)).length;
    if (withColor < need) {
      return { kind: "missing_color", colorName: rule.colorName, need, have: withColor };
    }
  }

  if (pickRandomOutfit(pool, slots, colorRules) === null) {
    return { kind: "no_combo" };
  }

  return null;
}

export const DEFAULT_CATEGORY_RULES: CategoryRule[] = [];
