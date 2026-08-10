/**
 * Bradley-Terry preference learning (docs/OUTFIT_INTELLIGENCE.md §4, Layer 2).
 *
 * Turns the choice log into a latent utility per garment. Every daily-proposal
 * interaction is a comparison under identical context — "these three, not those
 * six" — and comparisons are far more sample-efficient than ratings: they need
 * no shared scale between users, no calibration, and no absolute judgement from
 * someone who just wanted to get dressed.
 *
 * Sets rather than single items, because that is what the product produces. An
 * outfit's utility is the mean of its pieces', so
 *
 *     P(A ≻ B) = σ( mean(θ_A) − mean(θ_B) )
 *
 * The mean (not the sum) matters: a sum would make a four-piece outfit beat a
 * three-piece one on length alone.
 *
 * Fitted by gradient ascent on the L2-regularized log-likelihood. A closet is a
 * few hundred parameters and a few dozen comparisons, so this converges in
 * milliseconds and runs client-side. The regularizer is doing real work — with
 * this little data, an unregularized fit sends any item that appears in a single
 * winning outfit to infinity.
 */

export type Comparison = {
  /** Items in the chosen set. */
  winners: string[];
  /** Items in the sets that were passed over. */
  losers: string[];
  /** Down-weights weaker evidence; see PREFERENCE_SIGNAL_WEIGHT. */
  weight?: number;
};

/**
 * Reserved pseudo-item representing "neutral".
 *
 * A swipe is a unary judgement, and Bradley-Terry only consumes comparisons.
 * Pairing each judgement against a fixed anchor — liked ≻ anchor, anchor ≻
 * passed — turns one into the other without inventing a comparison between two
 * unrelated outfits the user never saw together.
 */
export const NEUTRAL_ANCHOR = "__neutral__";

export type BradleyTerryOptions = {
  /** L2 pull toward zero. Higher = more conservative on thin data. */
  regularization?: number;
  iterations?: number;
  learningRate?: number;
  /**
   * Centre the solution on this item instead of on the mean. Pass
   * NEUTRAL_ANCHOR when the data includes unary judgements, so θ = 0 keeps
   * meaning "neutral" rather than "average of whatever was rated".
   */
  anchorId?: string;
};

/**
 * Strong by recommender standards, and deliberately so: with a handful of
 * comparisons the honest posterior is "barely moved from the prior", and this
 * is the parameter that enforces it.
 */
export const DEFAULT_REGULARIZATION = 0.5;
const DEFAULT_ITERATIONS = 300;
const DEFAULT_LEARNING_RATE = 0.35;

function sigmoid(x: number): number {
  // Branch to avoid exp() overflow at large |x|, which would produce NaN
  // utilities that silently poison every downstream score.
  if (x >= 0) return 1 / (1 + Math.exp(-x));
  const e = Math.exp(x);
  return e / (1 + e);
}

function meanUtility(items: readonly string[], theta: Map<string, number>): number {
  if (items.length === 0) return 0;
  let total = 0;
  for (const item of items) total += theta.get(item) ?? 0;
  return total / items.length;
}

export type BradleyTerryFit = {
  /** Latent utility per item, centred near zero. */
  theta: Map<string, number>;
  /** How many comparisons each item took part in — drives the λ ramp. */
  evidence: Map<string, number>;
};

export function fitBradleyTerry(
  comparisons: readonly Comparison[],
  options: BradleyTerryOptions = {},
): BradleyTerryFit {
  const regularization = options.regularization ?? DEFAULT_REGULARIZATION;
  const iterations = options.iterations ?? DEFAULT_ITERATIONS;
  const learningRate = options.learningRate ?? DEFAULT_LEARNING_RATE;

  const theta = new Map<string, number>();
  const evidence = new Map<string, number>();

  const usable = comparisons.filter((c) => c.winners.length > 0 && c.losers.length > 0);
  for (const comparison of usable) {
    for (const item of [...comparison.winners, ...comparison.losers]) {
      if (!theta.has(item)) theta.set(item, 0);
      evidence.set(item, (evidence.get(item) ?? 0) + 1);
    }
  }
  if (usable.length === 0) return { theta, evidence };

  for (let step = 0; step < iterations; step += 1) {
    const gradient = new Map<string, number>();

    for (const comparison of usable) {
      const weight = comparison.weight ?? 1;
      const diff = meanUtility(comparison.winners, theta) - meanUtility(comparison.losers, theta);
      // d/dθ of log σ(diff), distributed over each set's members. Dividing by
      // set size mirrors the mean in the forward pass — without it the gradient
      // and the model would disagree and the fit would not converge to the
      // likelihood it claims to maximize.
      const residual = weight * (1 - sigmoid(diff));

      for (const item of comparison.winners) {
        gradient.set(item, (gradient.get(item) ?? 0) + residual / comparison.winners.length);
      }
      for (const item of comparison.losers) {
        gradient.set(item, (gradient.get(item) ?? 0) - residual / comparison.losers.length);
      }
    }

    for (const [item, value] of theta) {
      // Proximal step: take the likelihood gradient explicitly, then apply the
      // L2 pull as a shrinkage divide.
      //
      // The obvious form — θ += lr·(grad − reg·θ) — is only stable while
      // lr·reg < 1. Past that the shrinkage overshoots zero and the fit
      // oscillates outward, so *raising* the regularizer produced *larger*
      // utilities: exactly backwards, and silent. This form is stable for any
      // non-negative regularization.
      const ascended = value + learningRate * (gradient.get(item) ?? 0);
      theta.set(item, ascended / (1 + learningRate * regularization));
    }
  }

  // Centre the solution. Bradley-Terry is invariant to a constant shift, so an
  // uncentred fit drifts and makes the squash below depend on that drift.
  //
  // With unary judgements present, centre on the anchor rather than the mean:
  // otherwise a session of mostly-likes shifts the whole scale and "liked"
  // stops meaning above-neutral.
  const anchor = options.anchorId != null ? theta.get(options.anchorId) : undefined;
  const values = [...theta.values()];
  if (anchor != null) {
    for (const [item, value] of theta) theta.set(item, value - anchor);
  } else if (values.length > 0) {
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    for (const [item, value] of theta) theta.set(item, value - mean);
  }

  return { theta, evidence };
}

/**
 * Squash a utility into [0, 1] for blending with the other Layer 1 terms.
 *
 * The scale is intentionally gentle — a utility of ±1 maps to roughly 0.62/0.38,
 * not 0.9/0.1. Personalization is a residual on a prior that already works, and
 * a few taps should nudge a ranking, not overturn it.
 */
export const UTILITY_SCALE = 0.5;

export function utilityToScore(utility: number): number {
  return sigmoid(utility * UTILITY_SCALE);
}
