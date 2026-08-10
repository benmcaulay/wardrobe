/**
 * Uncertainty over per-item affinity (docs/OUTFIT_INTELLIGENCE.md §4, Layer 3).
 *
 * Layer 2 produces a point estimate: how much we think the user likes a
 * garment. This adds how much we *don't know*, which turns out to be the more
 * useful number — because of one structural coincidence the whole design leans
 * on:
 *
 *     high posterior variance  ⟺  little evidence  ⟺  rarely worn
 *
 * So the exploration bonus in a Thompson draw and the "you never wear this"
 * signal are the same quantity. Surfacing uncertainty *is* surfacing neglected
 * clothes. There is no separate utilization feature to build, and building one
 * would double-count.
 *
 * ── An approximation, stated as one ─────────────────────────────────────────
 *
 * A proper Laplace posterior around the Bradley-Terry MAP would need the Hessian
 * of the log-likelihood at the fit. This uses the standard conjugate shortcut
 * instead — precision accumulates linearly with evidence, σ = 1/√τ — which gets
 * the ordering and the decay rate right and the absolute calibration only
 * roughly. For choosing which of a few hundred garments to surface, ordering is
 * what matters; nothing downstream reads σ as a real credible interval.
 */

/**
 * Standard deviation for an item nothing is known about.
 *
 * Affinity lives in [0, 1], so 0.25 means a ±1σ draw spans about half the
 * scale — enough for an unknown item to genuinely compete with a known-good
 * one, which is the point, without swamping the mean entirely.
 */
export const PRIOR_STDEV = 0.25;

/**
 * Observations at which uncertainty falls by √2.
 *
 * Kept as its own parameter rather than falling out of σ₀. The conjugate form
 * τ = 1/σ₀² + n ties the two together, and at σ₀ = 0.25 that implies a prior
 * worth *sixteen* observations — so a garment worn fifty times would still read
 * as barely-known, and the explore slot would keep "discovering" the user's
 * favourite jeans. σ₀ sets how wide a draw is; this sets how fast evidence
 * shrinks it. They are unrelated questions and conflating them was a bug.
 */
export const EVIDENCE_HALF_LIFE = 4;

/**
 * How much a single confident wear tightens belief, relative to a comparison.
 *
 * Below 1 because a wear is weaker evidence about *preference* than a choice
 * is: putting something on says you were willing, while picking it over two
 * alternatives says you preferred it. Wears still count, because an item worn
 * fifty times is not one we are uncertain about.
 */
export const WEAR_PRECISION_WEIGHT = 0.6;

export type EvidenceCounts = {
  /** Contrastive comparisons the item took part in. */
  comparisons?: number;
  /** Confidence-weighted wears (WardrobeItem.effectiveWears). */
  wears?: number;
};

/** Posterior standard deviation for one item. */
export function stdevFor(evidence: EvidenceCounts): number {
  const comparisons = Math.max(0, evidence.comparisons ?? 0);
  const wears = Math.max(0, evidence.wears ?? 0);
  const observations = comparisons + WEAR_PRECISION_WEIGHT * wears;
  return PRIOR_STDEV / Math.sqrt(1 + observations / EVIDENCE_HALF_LIFE);
}

export type AffinityPosterior = {
  /** Point estimate in [0, 1]; absent means no opinion. */
  mean: ReadonlyMap<string, number>;
  /** Uncertainty per item. Items absent here take PRIOR_STDEV. */
  stdev: ReadonlyMap<string, number>;
};

export function buildPosterior(
  mean: ReadonlyMap<string, number>,
  evidence: ReadonlyMap<string, EvidenceCounts>,
): AffinityPosterior {
  const stdev = new Map<string, number>();
  // Union, not just the keys of `mean`: an item with no affinity opinion at all
  // is the *most* uncertain thing in the closet, and dropping it here would
  // quietly exclude exactly the garments exploration exists to find.
  const ids = new Set<string>([...mean.keys(), ...evidence.keys()]);
  for (const id of ids) stdev.set(id, stdevFor(evidence.get(id) ?? {}));
  return { mean, stdev };
}

/** Box-Muller, so a uniform rng can drive a Gaussian draw. */
export function gaussian(rng: () => number): number {
  // Guard the log against exactly 0, which would return -Infinity.
  const u = Math.max(rng(), Number.EPSILON);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * One Thompson draw: sample a plausible affinity per item from its posterior.
 *
 * Sampling once per *slate* rather than once per candidate comparison keeps the
 * draw coherent — an item that came up optimistic stays optimistic while the
 * outfit is assembled around it, which is what makes the resulting look a
 * genuine bet on that piece rather than noise scattered across slots.
 */
export function thompsonDraw(
  posterior: AffinityPosterior,
  ids: Iterable<string>,
  rng: () => number,
  neutral = 0.5,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const id of ids) {
    const mean = posterior.mean.get(id) ?? neutral;
    const stdev = posterior.stdev.get(id) ?? PRIOR_STDEV;
    // Clamp: affinity is a [0, 1] quantity and the Gaussian is only an
    // approximation to it, so the tails have to be cut somewhere.
    out.set(id, Math.min(1, Math.max(0, mean + stdev * gaussian(rng))));
  }
  return out;
}

/**
 * How under-explored an item is, 0..1 — the same number the Thompson bonus
 * comes from, exposed directly so the dormancy work in §6 reads it rather than
 * deriving a second, subtly different notion of "neglected".
 */
export function noveltyScore(evidence: EvidenceCounts): number {
  return stdevFor(evidence) / PRIOR_STDEV;
}
