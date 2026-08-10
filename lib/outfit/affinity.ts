/**
 * Layer 2: per-item affinity (docs/OUTFIT_INTELLIGENCE.md §4).
 *
 * How much this particular person likes this particular garment, from two
 * sources that hand over to each other as evidence accumulates:
 *
 *   prior       — an optional per-item starting point. Currently unfilled; see
 *                 AffinityInput.
 *   choice data — Bradley-Terry utilities from the daily proposal. Slow to
 *                 arrive, but it is what they actually did.
 *
 *     affinity(i) = λ(nᵢ) · learned(i) + (1 − λ(nᵢ)) · stylePrior(i)
 *
 * with λ ramping per item, not globally: a jacket they have chosen between six
 * times should be governed by that, while an untouched one still leans on the
 * prompt. A global λ would let a handful of well-tested items drag every
 * unseen one along with them.
 *
 */

import { utilityToScore, type BradleyTerryFit } from "@/lib/outfit/bradley-terry";

/** Neutral affinity: no prompt, no choices, no opinion. */
export const NEUTRAL_AFFINITY = 0.5;

/**
 * Comparisons before learned utility outweighs the prompt.
 *
 * λ(n) = n / (n + K). At K = 6, one comparison gives the learned term ~14% of
 * the weight and six gives it half. Deliberately slow: early comparisons are
 * noisy, and a recommender that lurches after a single tap feels erratic rather
 * than responsive.
 */
export const LAMBDA_HALF_LIFE = 6;

export function lambdaFor(evidenceCount: number): number {
  if (evidenceCount <= 0) return 0;
  return evidenceCount / (evidenceCount + LAMBDA_HALF_LIFE);
}

export type AffinityInput = {
  /**
   * Optional per-item prior in [0, 1]. Nothing supplies one today: the global
   * style prompt that used to fill it is gone (§9), and what the user knows
   * beyond their closet is now captured as rules in lib/outfit/style-rules.ts.
   * Kept because the blend is written around having one, and a future prior
   * (population-pooled, say) would drop straight in.
   */
  stylePrior?: ReadonlyMap<string, number>;
  fit?: BradleyTerryFit | null;
};

/**
 * Blend the two sources into one affinity per item.
 *
 * Only items with an opinion are returned. An absent entry means "no opinion",
 * which the scorer drops and renormalizes around — much better than a neutral
 * 0.5 that quietly dilutes every other term.
 */
export function buildAffinityMap(input: AffinityInput): Map<string, number> {
  const { stylePrior, fit } = input;
  const out = new Map<string, number>();

  const ids = new Set<string>([...(stylePrior?.keys() ?? []), ...(fit?.theta.keys() ?? [])]);

  for (const itemId of ids) {
    const prior = stylePrior?.get(itemId);
    const utility = fit?.theta.get(itemId);
    const evidence = fit?.evidence.get(itemId) ?? 0;
    const lambda = utility == null ? 0 : lambdaFor(evidence);

    if (prior == null && utility == null) continue;

    // With no prompt, the learned term stands alone against a neutral baseline
    // rather than against nothing — otherwise a single comparison would produce
    // a full-strength opinion on an item nobody has said anything about.
    const base = prior ?? NEUTRAL_AFFINITY;
    const learned = utility == null ? base : utilityToScore(utility);

    out.set(itemId, lambda * learned + (1 - lambda) * base);
  }

  return out;
}

/** Mean affinity across a set, or null when nothing in it has an opinion. */
export function outfitAffinity(
  itemIds: readonly string[],
  affinity: ReadonlyMap<string, number>,
): number | null {
  let total = 0;
  let count = 0;
  for (const id of itemIds) {
    const value = affinity.get(id);
    if (value == null) continue;
    total += value;
    count += 1;
  }
  return count === 0 ? null : total / count;
}
