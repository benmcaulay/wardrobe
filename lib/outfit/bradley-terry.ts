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
  /**
   * Item id → centred feature vector (lib/outfit/features.ts). Present turns
   * this into a *contextual* Bradley-Terry model: strength becomes
   * θᵢ = αᵢ + wᵀxᵢ, with `w` shared across every comparison.
   *
   * Absent reproduces the identity model exactly, which is what makes the two
   * comparable in an offline evaluation.
   */
  features?: ReadonlyMap<string, Float64Array>;
  /**
   * L2 pull on the shared coefficients. Separate from `regularization` because
   * the two parameter sets carry completely different amounts of evidence: every
   * comparison informs all of `w`, while αᵢ is informed only by the comparisons
   * item i appeared in. One shared penalty would have to be wrong for one of
   * them.
   */
  featureRegularization?: number;
};

/**
 * Strong by recommender standards, and deliberately so: with a handful of
 * comparisons the honest posterior is "barely moved from the prior", and this
 * is the parameter that enforces it.
 */
export const DEFAULT_REGULARIZATION = 0.5;
/**
 * Weaker than the per-item penalty, because `w` is the part that is allowed to
 * learn. Every comparison informs all sixteen coefficients, so the evidence per
 * parameter is roughly n/d rather than the handful of appearances backing an
 * individual αᵢ — over-shrinking it would reintroduce the memorization this
 * model exists to remove, by pushing the explanation back onto the intercepts.
 */
export const DEFAULT_FEATURE_REGULARIZATION = 0.1;
const DEFAULT_ITERATIONS = 300;
const DEFAULT_LEARNING_RATE = 0.35;

function sigmoid(x: number): number {
  // Branch to avoid exp() overflow at large |x|, which would produce NaN
  // utilities that silently poison every downstream score.
  if (x >= 0) return 1 / (1 + Math.exp(-x));
  const e = Math.exp(x);
  return e / (1 + e);
}

export type BradleyTerryFit = {
  /** Latent utility per item, centred near zero. */
  theta: Map<string, number>;
  /** How many comparisons each item took part in — drives the λ ramp. */
  evidence: Map<string, number>;
  /** Fitted shared coefficients, empty for the identity model. */
  weights: number[];
  /**
   * The shared model's evidence, expressed in units of per-item comparisons, so
   * the λ ramp in lib/outfit/affinity.ts can read it on the same scale as
   * `evidence`.
   *
   * Set to comparisons / dimensions. The reasoning: n observations are spent
   * fitting d coefficients, so each carries about n/d observations' worth of
   * support. It has the two properties that matter — more comparisons buys more
   * trust, more features spreads the same evidence thinner — and it goes to zero
   * with no data instead of asserting confidence from a constant. It is an
   * order-of-magnitude argument, not a derivation, which is why the harness
   * measures its effect rather than assuming it.
   */
  featureCredit: number;
};

export function fitBradleyTerry(
  comparisons: readonly Comparison[],
  options: BradleyTerryOptions = {},
): BradleyTerryFit {
  const regularization = options.regularization ?? DEFAULT_REGULARIZATION;
  const featureRegularization =
    options.featureRegularization ?? DEFAULT_FEATURE_REGULARIZATION;
  const iterations = options.iterations ?? DEFAULT_ITERATIONS;
  const learningRate = options.learningRate ?? DEFAULT_LEARNING_RATE;

  const features = options.features;
  const dims = features ? firstVectorLength(features) : 0;
  const contextual = dims > 0;

  // αᵢ, the per-item intercept. Named `theta` in the identity model because
  // there it *is* the utility; here it is one of two terms.
  const alpha = new Map<string, number>();
  const evidence = new Map<string, number>();
  const w = new Float64Array(dims);

  const usable = comparisons.filter((c) => c.winners.length > 0 && c.losers.length > 0);
  for (const comparison of usable) {
    for (const item of [...comparison.winners, ...comparison.losers]) {
      if (!alpha.has(item)) alpha.set(item, 0);
      evidence.set(item, (evidence.get(item) ?? 0) + 1);
    }
  }
  if (usable.length === 0) {
    return { theta: alpha, evidence, weights: [], featureCredit: 0 };
  }

  // Mean feature vector per side, precomputed once: it does not change between
  // gradient steps, and recomputing it 300 times per comparison was the whole
  // cost of the contextual term.
  const sides = contextual
    ? usable.map((comparison) => ({
        winners: meanFeatures(comparison.winners, features!, dims),
        losers: meanFeatures(comparison.losers, features!, dims),
        contrastive: isFeatureContrast(comparison, features!),
      }))
    : null;

  const utilityOf = (item: string): number => {
    const base = alpha.get(item) ?? 0;
    if (!contextual) return base;
    const vector = features!.get(item);
    if (!vector) return base;
    let dot = 0;
    for (let k = 0; k < dims; k += 1) dot += w[k] * vector[k];
    return base + dot;
  };

  for (let step = 0; step < iterations; step += 1) {
    const gradient = new Map<string, number>();
    const gradientW = contextual ? new Float64Array(dims) : null;

    for (let c = 0; c < usable.length; c += 1) {
      const comparison = usable[c];
      const weight = comparison.weight ?? 1;
      const diff =
        meanUtilityWith(comparison.winners, utilityOf) -
        meanUtilityWith(comparison.losers, utilityOf);
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

      // d/dw is the same residual against the difference of the two sides' mean
      // feature vectors — one accumulation per comparison rather than per item,
      // because every member of a side shares the coefficient.
      if (gradientW && sides && sides[c].contrastive) {
        const side = sides[c];
        for (let k = 0; k < dims; k += 1) {
          gradientW[k] += residual * (side.winners[k] - side.losers[k]);
        }
      }
    }

    for (const [item, value] of alpha) {
      // Proximal step: take the likelihood gradient explicitly, then apply the
      // L2 pull as a shrinkage divide.
      //
      // The obvious form — θ += lr·(grad − reg·θ) — is only stable while
      // lr·reg < 1. Past that the shrinkage overshoots zero and the fit
      // oscillates outward, so *raising* the regularizer produced *larger*
      // utilities: exactly backwards, and silent. This form is stable for any
      // non-negative regularization.
      const ascended = value + learningRate * (gradient.get(item) ?? 0);
      alpha.set(item, ascended / (1 + learningRate * regularization));
    }

    if (gradientW) {
      for (let k = 0; k < dims; k += 1) {
        const ascended = w[k] + learningRate * gradientW[k];
        w[k] = ascended / (1 + learningRate * featureRegularization);
      }
    }
  }

  // Resolve utilities. The contextual model has an opinion about every item it
  // has features for, including the ones nobody has ever compared — that is the
  // cold-start property the whole change is for, and the λ ramp in
  // lib/outfit/affinity.ts is what keeps it modest.
  const theta = new Map<string, number>();
  for (const item of alpha.keys()) theta.set(item, utilityOf(item));
  if (contextual) {
    for (const item of features!.keys()) {
      if (!theta.has(item)) theta.set(item, utilityOf(item));
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

  return {
    theta,
    evidence,
    weights: contextual ? Array.from(w) : [],
    // Counted over the comparisons that actually informed `w`, not every usable
    // row: the unary ones are excluded from that gradient, so crediting them here
    // would claim evidence the coefficients never saw.
    featureCredit: sides ? sides.filter((side) => side.contrastive).length / dims : 0,
  };
}

function firstVectorLength(features: ReadonlyMap<string, Float64Array>): number {
  for (const vector of features.values()) return vector.length;
  return 0;
}

function withFeatures(
  items: readonly string[],
  features: ReadonlyMap<string, Float64Array>,
): number {
  let count = 0;
  for (const item of items) if (features.has(item)) count += 1;
  return count;
}

/**
 * Whether a comparison can teach the shared coefficients anything.
 *
 * Two sides that both carry features always can: the shared structure cancels out
 * of the difference and only the contrast survives.
 *
 * A judgement against `NEUTRAL_ANCHOR` is the interesting case, because the anchor
 * has no features and the "difference" is just the other side's own vector. Since
 * features are centred on the closet mean, that reads as "how this differs from
 * the average garment" — which is a real contrast when the other side *is* one
 * garment, and a trap when it is an outfit.
 *
 * The trap: a top-plus-bottom-plus-shoes look is not a random draw from a closet
 * that is 40% hats, so its feature mean is systematically offset from zero for
 * reasons that have nothing to do with taste. Every outfit rating pushed `w` in
 * that same direction — the largest coefficients came out as neutralShare (+1.81)
 * and kindTop (−1.63) — and like/pass AUC fell to 0.674, below the 0.708 of using
 * no affinity at all.
 *
 * A single garment has no such offset, which is exactly what makes `train_item`
 * (the garment-swipe mode) the cleanest feature evidence in the log: one item
 * against the closet average, with nothing else in the frame to confound it.
 *
 * Multi-item anchor rows still train the intercepts, so the level they carry is
 * not thrown away — it lands on the anchor's own parameter, where it belongs.
 */
function isFeatureContrast(
  comparison: Comparison,
  features: ReadonlyMap<string, Float64Array>,
): boolean {
  const winners = withFeatures(comparison.winners, features);
  const losers = withFeatures(comparison.losers, features);
  if (winners > 0 && losers > 0) return true;
  // Exactly one garment on the featured side, nothing on the other.
  if (winners === 1 && comparison.winners.length === 1 && losers === 0) return true;
  if (losers === 1 && comparison.losers.length === 1 && winners === 0) return true;
  return false;
}

function meanFeatures(
  items: readonly string[],
  features: ReadonlyMap<string, Float64Array>,
  dims: number,
): Float64Array {
  const out = new Float64Array(dims);
  if (items.length === 0) return out;
  for (const item of items) {
    const vector = features.get(item);
    // An item with no features — NEUTRAL_ANCHOR is the one that matters —
    // contributes a zero vector. Because features are centred on the closet
    // mean, zero reads as "an average garment", which is exactly what the anchor
    // is meant to be.
    if (!vector) continue;
    for (let k = 0; k < dims; k += 1) out[k] += vector[k];
  }
  // Divided by the *set size*, not by how many members had features. The forward
  // pass averages utilities over the whole set, so anything else would make the
  // gradient disagree with the model it claims to differentiate — the same trap
  // the per-item gradient above is careful about.
  for (let k = 0; k < dims; k += 1) out[k] /= items.length;
  return out;
}

function meanUtilityWith(items: readonly string[], utilityOf: (item: string) => number): number {
  if (items.length === 0) return 0;
  let total = 0;
  for (const item of items) total += utilityOf(item);
  return total / items.length;
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
