/**
 * Lens 3 — marginal value (docs/OUTFIT_INTELLIGENCE.md §6).
 *
 * Remove one garment; how much worse does the closet get? The answer is the
 * counterfactual contribution of that item to the space of outfits the user can
 * actually build.
 *
 * ── Why this exists, and why it is never shown ──────────────────────────────
 *
 * Cost-per-wear says sell the black blazer worn six times a year. Marginal
 * value says it is one of the most important things in the closet, because
 * twelve outfits stop working without it. Both are looking at the same garment;
 * only one of them is measuring the thing that matters.
 *
 * So this is a *suppression input* to the dormancy lens, not a number anyone
 * sees. It is the mechanism that prevents the one suggestion that would destroy
 * trust — telling someone to reconsider the piece their wardrobe is built on.
 *
 * ── The approximation ───────────────────────────────────────────────────────
 *
 * A true leave-one-out over every feasible outfit is combinatorial, and the
 * precision would be wasted: the output feeds a single threshold, not a ranking
 * anyone reads. So it is computed in closed form from the two properties that
 * actually make a garment hard to lose — how few things can replace it in its
 * slot, and how widely it combines. That is enough to separate "the only pair
 * of shoes" and "the black knit everything works with" from the rest, which is
 * all the dormancy lens needs to know.
 */

import { classifyGarmentKind, type GarmentKind } from "@/lib/categories";
import { colorVersatility } from "@/lib/packing/palette";
import type { ScorableItem } from "@/lib/outfit/compatibility";

export type MarginalValueInput = {
  items: readonly ScorableItem[];
  /** Slots a complete outfit needs. Defaults to top/bottom/shoes. */
  kinds?: readonly GarmentKind[];
};

const DEFAULT_KINDS: readonly GarmentKind[] = ["top", "bottom", "shoes"];

/**
 * Marginal value per item, 0..1.
 *
 * Two things make an item load-bearing, and both are captured:
 *
 *   scarcity — it is one of very few things that can fill its slot at all
 *   bridging — it pairs well with unusually many items in the other slots
 *
 * A closet with one pair of shoes gives those shoes a value near 1 whatever
 * they look like, which is correct: losing them costs every outfit.
 */
export function computeMarginalValue(input: MarginalValueInput): Map<string, number> {
  const kinds = input.kinds ?? DEFAULT_KINDS;
  const byKind = new Map<GarmentKind, ScorableItem[]>();
  for (const item of input.items) {
    const kind = classifyGarmentKind(item);
    if (!kinds.includes(kind)) continue;
    const bucket = byKind.get(kind);
    if (bucket) bucket.push(item);
    else byKind.set(kind, [item]);
  }

  const out = new Map<string, number>();

  for (const kind of kinds) {
    const peers = byKind.get(kind) ?? [];
    if (peers.length === 0) continue;

    // Scarcity: the only thing that fills a slot is irreplaceable; one of forty
    // is not. Reciprocal rather than linear because the difference between one
    // and two options is enormous and between thirty and thirty-one is nothing.
    const scarcity = 1 / peers.length;

    for (const item of peers) {
      // Bridging: how easily this piece combines with anything at all.
      //
      // The obvious version — mean pairwise harmony against the rest of the
      // closet — is wrong, and backwards. `pairHarmony` scores accent-with-
      // neutral (0.95) *above* neutral-with-neutral (0.88), because a pop of
      // colour against a plain background is the better-looking pair. Averaged
      // over a mostly-neutral closet that hands the neon tee a higher bridging
      // score than the black knit, which is the opposite of load-bearing.
      //
      // `colorVersatility` measures the thing actually meant here — a neutral
      // combines with everything, an accent with a handful — and is already
      // calibrated against this closet's colour vocabulary.
      const bridging = colorVersatility(item.colors);

      // Scarcity dominates: a garment can be replaceable-but-versatile without
      // being load-bearing, whereas being the only option always is.
      out.set(item.id, Math.min(1, 0.7 * scarcity + 0.45 * bridging));
    }
  }

  return out;
}
