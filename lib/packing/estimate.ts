/**
 * Heuristic mass + (packed) volume estimates for wardrobe items (SmartPakker).
 *
 * Deterministic, no AI — same philosophy as lib/sale-listing.ts. The estimate
 * starts from a base figure per category, refines it with subcategory/name
 * keywords, then applies a material multiplier. When an item carries explicit
 * `weightGrams` / `volumeLiters` (a manual or future-AI override stored on the
 * row) those win. This keeps the column nullable: null = "derive from here".
 *
 * Pure module (no Node built-ins) so it can run on the client too.
 */

import { normalizeCategoryName } from "@/lib/categories";

export type PackingEstimate = {
  weightGrams: number;
  /** Approximate packed volume in litres. */
  volumeLiters: number;
  /** Where the numbers came from: a stored override or the heuristic table. */
  source: "override" | "heuristic";
};

/** Minimal shape needed to estimate an item (works on client + server). */
export type EstimableItem = {
  category: string;
  subcategory?: string | null;
  material?: string | null;
  name?: string | null;
  weightGrams?: number | null;
  volumeLiters?: number | null;
};

type BaseEstimate = { weightGrams: number; volumeLiters: number };

// Base per canonical category. Unknown categories fall back to GENERIC.
const CATEGORY_BASE: Record<string, BaseEstimate> = {
  top: { weightGrams: 200, volumeLiters: 1.2 },
  bottom: { weightGrams: 400, volumeLiters: 1.8 },
  dress: { weightGrams: 350, volumeLiters: 1.8 },
  outerwear: { weightGrams: 800, volumeLiters: 4.5 },
  shoes: { weightGrams: 850, volumeLiters: 3.5 },
  accessory: { weightGrams: 120, volumeLiters: 0.5 },
};

const GENERIC: BaseEstimate = { weightGrams: 250, volumeLiters: 1.5 };

// Subcategory / name keyword refinements. First match wins, checked against the
// lowercased "subcategory + name" text. Overrides the category base entirely.
const KEYWORD_BASE: { match: string[]; base: BaseEstimate }[] = [
  { match: ["puffer", "down jacket", "parka", "winter coat"], base: { weightGrams: 1100, volumeLiters: 6.5 } },
  { match: ["coat", "trench"], base: { weightGrams: 1200, volumeLiters: 6 } },
  { match: ["blazer", "jacket"], base: { weightGrams: 700, volumeLiters: 3.5 } },
  { match: ["sweater", "knit", "cardigan", "hoodie", "sweatshirt", "fleece"], base: { weightGrams: 450, volumeLiters: 2.8 } },
  { match: ["jeans", "denim"], base: { weightGrams: 600, volumeLiters: 2.2 } },
  { match: ["trousers", "pants", "chinos", "slacks"], base: { weightGrams: 420, volumeLiters: 1.9 } },
  { match: ["shorts"], base: { weightGrams: 220, volumeLiters: 0.9 } },
  { match: ["skirt"], base: { weightGrams: 280, volumeLiters: 1.3 } },
  { match: ["t-shirt", "tee", "tank", "top"], base: { weightGrams: 160, volumeLiters: 0.9 } },
  { match: ["shirt", "blouse"], base: { weightGrams: 220, volumeLiters: 1.2 } },
  { match: ["boots", "boot"], base: { weightGrams: 1200, volumeLiters: 5 } },
  { match: ["sneaker", "trainer", "running"], base: { weightGrams: 800, volumeLiters: 3.6 } },
  { match: ["sandal", "flip", "slide"], base: { weightGrams: 350, volumeLiters: 1.4 } },
  { match: ["heel", "flat", "loafer"], base: { weightGrams: 600, volumeLiters: 2.6 } },
  { match: ["hat", "cap", "beanie"], base: { weightGrams: 110, volumeLiters: 0.2 } },
  { match: ["scarf"], base: { weightGrams: 150, volumeLiters: 0.9 } },
  { match: ["belt"], base: { weightGrams: 200, volumeLiters: 0.4 } },
  { match: ["bag", "purse", "backpack"], base: { weightGrams: 500, volumeLiters: 3 } },
  { match: ["sunglasses", "jewelry", "jewellery", "watch", "ring", "necklace"], base: { weightGrams: 60, volumeLiters: 0.2 } },
  { match: ["swim", "bikini", "trunks"], base: { weightGrams: 120, volumeLiters: 0.5 } },
];

// Material multipliers on { weight, volume }. First match wins.
const MATERIAL_MODIFIER: { match: string[]; weight: number; volume: number }[] = [
  { match: ["down", "puffer"], weight: 0.9, volume: 1.5 },
  { match: ["denim"], weight: 1.4, volume: 1.2 },
  { match: ["leather", "suede"], weight: 1.5, volume: 1.2 },
  { match: ["wool", "tweed"], weight: 1.3, volume: 1.4 },
  { match: ["cashmere"], weight: 1.1, volume: 1.3 },
  { match: ["fleece"], weight: 0.9, volume: 1.4 },
  { match: ["cotton"], weight: 1, volume: 1 },
  { match: ["linen"], weight: 0.85, volume: 0.9 },
  { match: ["silk", "satin"], weight: 0.6, volume: 0.5 },
  { match: ["polyester", "nylon", "synthetic", "spandex", "elastane"], weight: 0.85, volume: 0.85 },
];

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function baseFor(item: EstimableItem): BaseEstimate {
  const text = `${item.subcategory ?? ""} ${item.name ?? ""}`.toLowerCase();
  for (const rule of KEYWORD_BASE) {
    if (rule.match.some((m) => text.includes(m))) return rule.base;
  }
  const cat = normalizeCategoryName(item.category ?? "");
  return CATEGORY_BASE[cat] ?? GENERIC;
}

function materialModifier(material: string | null | undefined): { weight: number; volume: number } {
  const text = (material ?? "").toLowerCase();
  if (!text) return { weight: 1, volume: 1 };
  for (const rule of MATERIAL_MODIFIER) {
    if (rule.match.some((m) => text.includes(m))) return { weight: rule.weight, volume: rule.volume };
  }
  return { weight: 1, volume: 1 };
}

/**
 * Estimate packed weight + volume for an item. A stored override on either
 * field is used verbatim; missing fields fall back to the heuristic.
 */
export function estimateItemPacking(item: EstimableItem): PackingEstimate {
  const base = baseFor(item);
  const mod = materialModifier(item.material);
  const heuristicWeight = Math.max(20, Math.round(base.weightGrams * mod.weight));
  const heuristicVolume = Math.max(0.1, round1(base.volumeLiters * mod.volume));

  const hasWeightOverride = item.weightGrams != null && item.weightGrams >= 0;
  const hasVolumeOverride = item.volumeLiters != null && item.volumeLiters >= 0;

  return {
    weightGrams: hasWeightOverride ? Math.round(item.weightGrams!) : heuristicWeight,
    volumeLiters: hasVolumeOverride ? round1(item.volumeLiters!) : heuristicVolume,
    source: hasWeightOverride && hasVolumeOverride ? "override" : "heuristic",
  };
}

export function formatWeight(grams: number): string {
  if (grams >= 1000) return `${(grams / 1000).toFixed(grams % 1000 === 0 ? 0 : 1)} kg`;
  return `${Math.round(grams)} g`;
}

export function formatVolume(liters: number): string {
  return `${round1(liters)} L`;
}
