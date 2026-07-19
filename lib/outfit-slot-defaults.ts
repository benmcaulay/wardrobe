import { normalizeCategoryName } from "@/lib/categories";
import { categoryListSignature } from "@/lib/outfit-random";

export type OutfitSlotDefault = {
  x: number;
  y: number;
  scale: number;
};

export type OutfitSlotDefaults = Record<string, OutfitSlotDefault>;

const FRAME_WIDTH = 560;
const FRAME_HEIGHT = 960;

/** Stable key for a slot's category rule (OR list). */
export function outfitSlotDefaultKey(categories: readonly string[]): string {
  return categoryListSignature(categories);
}

/** Built-in placement when the user has not saved a default yet. */
export function builtinSlotLayout(
  categories: readonly string[],
  index: number,
  frameWidth = FRAME_WIDTH,
  frameHeight = FRAME_HEIGHT,
): OutfitSlotDefault {
  const c = (categories[0] ?? "").trim().toLowerCase();
  let x = frameWidth / 2;
  let y = frameHeight / 2;
  if (c.includes("hat") || c.includes("cap")) y = frameHeight * 0.12;
  else if (c.includes("top") || c.includes("shirt")) y = frameHeight * 0.28;
  else if (c.includes("outer") || c.includes("jacket")) y = frameHeight * 0.26;
  else if (c.includes("dress")) y = frameHeight * 0.38;
  else if (c.includes("bottom") || c.includes("pant") || c.includes("short")) y = frameHeight * 0.42;
  else if (c.includes("shoe") || c.includes("boot")) y = frameHeight * 0.78;
  x += index * 36;
  return { x, y, scale: 1 };
}

export function resolveSlotLayout(
  categories: readonly string[],
  index: number,
  defaults: OutfitSlotDefaults,
  frameWidth = FRAME_WIDTH,
  frameHeight = FRAME_HEIGHT,
): OutfitSlotDefault {
  const key = outfitSlotDefaultKey(categories);
  const saved = key ? defaults[key] : undefined;
  if (saved) {
    return {
      x: saved.x + index * 36,
      y: saved.y,
      scale: saved.scale,
    };
  }
  return builtinSlotLayout(categories, index, frameWidth, frameHeight);
}

export function sanitizeOutfitSlotDefaults(raw: unknown): OutfitSlotDefaults {
  if (!raw || typeof raw !== "object") return {};
  const out: OutfitSlotDefaults = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!key || typeof value !== "object" || value == null) continue;
    const v = value as Record<string, unknown>;
    const x = typeof v.x === "number" && Number.isFinite(v.x) ? v.x : null;
    const y = typeof v.y === "number" && Number.isFinite(v.y) ? v.y : null;
    const scale = typeof v.scale === "number" && Number.isFinite(v.scale) ? v.scale : null;
    if (x == null || y == null || scale == null) continue;
    out[key] = {
      x: Math.min(FRAME_WIDTH, Math.max(0, x)),
      y: Math.min(FRAME_HEIGHT, Math.max(0, y)),
      scale: Math.min(2.2, Math.max(0.5, scale)),
    };
  }
  return out;
}

/** Human label for a slot's categories (first category when single). */
export function slotCategoryLabel(categories: readonly string[]): string {
  const trimmed = categories.map((c) => c.trim()).filter(Boolean);
  if (trimmed.length === 0) return "Slot";
  if (trimmed.length === 1) return trimmed[0]!;
  return trimmed.join(" / ");
}

export function itemMatchesSlotCategories(
  itemCategory: string,
  slotCategories: readonly string[],
): boolean {
  if (slotCategories.length === 0) return false;
  const itemKey = normalizeCategoryName(itemCategory);
  return slotCategories.some((c) => normalizeCategoryName(c) === itemKey);
}
