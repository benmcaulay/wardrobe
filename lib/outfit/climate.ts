/**
 * Climate fit for a look (docs/OUTFIT_INTELLIGENCE.md §4, Layer 1).
 *
 * Reuses `garmentWarmth` and `DESIRED_WARMTH` from lib/packing/plan.ts rather
 * than restating them. They are tuned against the same closet and a second copy
 * would drift the moment either was adjusted.
 *
 * The packing scorer works per item — "is this a good thing to bring". Here the
 * question is per outfit — "would wearing exactly these things today be
 * comfortable" — which is not the same computation. A look is judged on the
 * warmth it delivers *together*, and one heavy coat legitimately carries a
 * light outfit through a cold day in a way no per-item average captures.
 */

import { classifyGarmentKind } from "@/lib/categories";
import { DESIRED_WARMTH, garmentWarmth, type PackableItem } from "@/lib/packing/plan";
import type { ClimateBand } from "@/lib/services/weather";

export type ClimateScorableItem = PackableItem;

/**
 * Warmth a whole look delivers.
 *
 * The strongest layer dominates, with the rest contributing a fraction. Wearing
 * a parka over a tee is warm — an average over the pieces would call it mild
 * and put you in it at -5°C. Outerwear is what a body actually feels first.
 */
export const SUPPORTING_LAYER_WEIGHT = 0.35;

export function outfitWarmth(items: readonly ClimateScorableItem[]): number {
  if (items.length === 0) return 0;

  const warmths = items
    // Accessories are noise here: a scarf is genuinely warm, but a belt scoring
    // on the same scale would pull a look's warmth around for no reason.
    .filter((item) => classifyGarmentKind(item) !== "accessory")
    .map(garmentWarmth);
  if (warmths.length === 0) return 0;

  const strongest = Math.max(...warmths);
  const rest = warmths.reduce((sum, w) => sum + w, 0) - strongest;
  return strongest + SUPPORTING_LAYER_WEIGHT * (rest / Math.max(1, warmths.length - 1));
}

/**
 * How far a look's warmth can miss the target before it stops being sensible.
 *
 * Asymmetric, because the two failures are not equally bad: being under-dressed
 * for cold is miserable and occasionally unsafe, while being over-dressed for
 * mild weather means carrying a jacket. Missing cold costs roughly twice as
 * much per unit as missing warm.
 */
export const TOO_COLD_TOLERANCE = 0.9;
export const TOO_WARM_TOLERANCE = 1.8;

/**
 * Climate suitability of a look, 0..1.
 *
 * Gaussian falloff rather than a linear ramp to zero. `garmentWarmth` spans
 * 0..3 and `DESIRED_WARMTH` reaches 2.6, so a linear ramp with any usable
 * tolerance saturates: in cold weather a tee-and-shorts look and a
 * slightly-too-light look both floor at exactly 0, the term stops
 * discriminating between them, and it does so precisely when dressing for the
 * weather matters most. A decay that never quite reaches zero keeps every
 * candidate ordered no matter how far out the whole closet is.
 */
export function climateFit(
  items: readonly ClimateScorableItem[],
  band: ClimateBand | null | undefined,
): number {
  // No forecast is not a reason to penalise anything — return neutral so the
  // other Layer 1 terms decide, rather than flattening every candidate equally.
  if (!band) return 0.75;
  if (items.length === 0) return 0.75;

  const target = DESIRED_WARMTH[band];
  const miss = outfitWarmth(items) - target;
  const tolerance = miss < 0 ? TOO_COLD_TOLERANCE : TOO_WARM_TOLERANCE;
  const z = miss / tolerance;

  return Math.exp(-0.5 * z * z);
}
