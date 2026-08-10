/**
 * Narrowing what a training round is *about* (docs/OUTFIT_INTELLIGENCE.md §10).
 *
 * An unfocused round asks "which of these do you prefer?" over the whole
 * closet, which is the right default but a blunt instrument. Focus lets the user
 * say what they're actually training: keep this jacket in every outfit, only
 * show me trousers, only show me black. The comparisons that come back are then
 * about the thing they cared about instead of being diluted across the wardrobe.
 *
 * Constraints are applied by *removing candidates*, never by re-weighting them.
 * A round that merely down-weighted the excluded pieces would still surface them
 * and read as not listening — the same reason avoidance rules are hard
 * exclusions in the scorer.
 */

import { classifyGarmentKind, type GarmentKind } from "@/lib/categories";
import { itemMatchesCategories, itemMatchesColorRule, type OutfitPickItem } from "@/lib/outfit-random";
import type { SlateSlot } from "@/lib/outfit/slate";

export type TrainingMode = "pick" | "rate" | "swipe";

export const TRAINING_MODES: readonly TrainingMode[] = ["pick", "rate", "swipe"];

export const TRAINING_MODE_LABELS: Record<TrainingMode, string> = {
  pick: "Pick your favourite",
  rate: "Like or dislike",
  swipe: "Swipe",
};

export const TRAINING_MODE_HINTS: Record<TrainingMode, string> = {
  pick: "One tap says your pick beat every other outfit on screen — the most informative answer there is.",
  rate: "Rate each outfit in the set on its own. Slower per outfit, but you're not forced to choose a winner.",
  swipe: "One outfit at a time. Swipe right if you'd wear it, left if you wouldn't.",
};

/** The sample-size range the multi-outfit modes offer. */
export const MIN_SAMPLE_SIZE = 2;
export const MAX_SAMPLE_SIZE = 8;
export const DEFAULT_SAMPLE_SIZE = 3;

/**
 * How many outfits a round shows.
 *
 * Swipe is definitionally one at a time, so it ignores the setting rather than
 * silently showing a set the interaction can't express an answer about.
 */
export function sampleSizeFor(mode: TrainingMode, requested: unknown): number {
  if (mode === "swipe") return 1;
  const n = Math.floor(Number(requested));
  if (!Number.isFinite(n)) return DEFAULT_SAMPLE_SIZE;
  return Math.min(MAX_SAMPLE_SIZE, Math.max(MIN_SAMPLE_SIZE, n));
}

export type TrainingFocus = {
  /** Pieces that must appear in every outfit of the round. */
  pinnedItemIds?: readonly string[];
  /** Draw free pieces only from these categories. Empty = no restriction. */
  categories?: readonly string[];
  /** Draw free pieces only in these colours. Empty = no restriction. */
  colorNames?: readonly string[];
};

/** Render order, so a focused round always reads head-to-toe. */
const KIND_ORDER: readonly GarmentKind[] = [
  "accessory",
  "outerwear",
  "top",
  "dress",
  "bottom",
  "shoes",
  "other",
];

/**
 * The outfit shape a category focus asks for.
 *
 * This is the fix for what was a dead end: the filter used to narrow candidates
 * while the round still demanded a top, a bottom *and* shoes, so focusing on
 * "jacket + shoes" emptied two required slots and produced nothing at all. The
 * categories you pick *are* the shape — pick jacket and shoes and you get jacket
 * and shoes, which is the pairing you asked to be trained on.
 *
 * Categories collapse to one slot per garment kind: "shirt" and "sweater/hoodie"
 * are both tops, so choosing both means "a top, from either of those", not two
 * tops layered. Returns null when there is no category focus, and the caller
 * falls back to the default top/bottom/shoes shape.
 */
export function slotsForCategories(categories: readonly string[] | undefined): SlateSlot[] | null {
  if (!categories || categories.length === 0) return null;
  const kinds = new Set<GarmentKind>();
  for (const category of categories) {
    kinds.add(classifyGarmentKind({ category }));
  }
  if (kinds.size === 0) return null;
  return KIND_ORDER.filter((kind) => kinds.has(kind)).map((kind) => ({ kind }));
}

export function focusIsEmpty(focus: TrainingFocus): boolean {
  return (
    (focus.pinnedItemIds?.length ?? 0) === 0 &&
    (focus.categories?.length ?? 0) === 0 &&
    (focus.colorNames?.length ?? 0) === 0
  );
}

/**
 * Which items the round must not draw.
 *
 * Pinned pieces are never excluded even when they fall outside the category or
 * colour filters — pinning is the more specific instruction, and a filter that
 * removed the very piece you asked to train on would be self-defeating.
 */
export function focusExclusions(
  // Deliberately wider than OutfitPickItem: the caller has scorable items, whose
  // colours are optional. Requiring them here forced a cast at the one call site
  // that matters, which is a worse trade than normalising a missing list to [].
  items: readonly FocusCandidate[],
  focus: TrainingFocus,
): Set<string> {
  const pinned = new Set(focus.pinnedItemIds ?? []);
  const categories = focus.categories ?? [];
  const colorNames = focus.colorNames ?? [];
  const excluded = new Set<string>();

  for (const candidate of items) {
    if (pinned.has(candidate.id)) continue;
    const item: OutfitPickItem = {
      id: candidate.id,
      category: candidate.category,
      colors: candidate.colors ?? [],
    };
    if (categories.length > 0 && !itemMatchesCategories(item, categories)) {
      excluded.add(item.id);
      continue;
    }
    if (colorNames.length > 0 && !colorNames.some((name) => itemMatchesColorRule(item, name))) {
      excluded.add(item.id);
    }
  }
  return excluded;
}

type FocusCandidate = {
  id: string;
  category: string;
  colors?: OutfitPickItem["colors"];
};
