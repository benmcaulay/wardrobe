/**
 * The type-aware bilinear compatibility term (docs/OUTFIT_INTELLIGENCE.md §4).
 *
 *     s(i, j) = xᵢᵀ W₍cᵢ,cⱼ₎ xⱼ,   W = UVᵀ,  U, V ∈ ℝ^(512×16)
 *
 * The idea it encodes — from Vasileva et al., ECCV 2018 — is that compatibility
 * and *similarity* are different metrics. A shared embedding space with a
 * separate projection per category pair keeps them apart. Without it, "goes
 * with" collapses into "looks like", and the recommender returns monochrome
 * outfits of near-identical items. That is the canonical failure mode of naive
 * embedding recommenders, and it is why this term exists rather than a plain
 * cosine between garment vectors.
 *
 * ── Not yet trained ─────────────────────────────────────────────────────────
 *
 * W has to be fitted offline on Polyvore (~68k outfits) and shipped as frozen
 * weights. That training run has not happened, so `loadBilinearWeights` returns
 * null and `bilinearCompatibility` reports "no opinion" rather than a number.
 *
 * The term is wired in now, inert, on purpose: lib/outfit/compatibility.ts
 * renormalizes its weights around whichever terms actually have an opinion, so
 * dropping trained weights in later changes the blend without touching a single
 * call site. What it must never do is guess — a cosine stand-in would look like
 * it was working while quietly optimising for the exact failure the real term
 * prevents.
 */

import { cosineSimilarity } from "@/lib/wear/embedding";

/** Low-rank factors for one ordered category pair. */
export type BilinearFactor = { u: Float32Array; v: Float32Array; rank: number };

export type BilinearWeights = {
  dims: number;
  rank: number;
  /** Keyed by `${categoryA}|${categoryB}`, categories sorted so the pair is unordered. */
  pairs: Map<string, BilinearFactor>;
};

let cached: BilinearWeights | null = null;

export function pairKey(categoryA: string, categoryB: string): string {
  const a = categoryA.trim().toLowerCase();
  const b = categoryB.trim().toLowerCase();
  return a <= b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Install trained weights. Called once at startup when the Polyvore run has
 * produced an artefact; until then nothing calls it and the term stays inert.
 */
export function setBilinearWeights(weights: BilinearWeights | null): void {
  cached = weights;
}

export function loadBilinearWeights(): BilinearWeights | null {
  return cached;
}

export function hasBilinearWeights(): boolean {
  return cached != null;
}

/**
 * Compatibility of two embedded garments under the type-aware metric.
 * Returns null when no weights are loaded, or none cover this category pair —
 * "no opinion", which the blend handles by redistributing weight, not by
 * substituting a default that would look like a real score.
 */
export function bilinearCompatibility(
  categoryA: string,
  vectorA: Float32Array | undefined,
  categoryB: string,
  vectorB: Float32Array | undefined,
): number | null {
  const weights = cached;
  if (!weights || !vectorA || !vectorB) return null;

  const factor = weights.pairs.get(pairKey(categoryA, categoryB));
  if (!factor) return null;

  // s = (Uᵀxᵢ) · (Vᵀxⱼ), the rank-r factorization evaluated without ever
  // materializing the 512×512 W.
  const projA = project(vectorA, factor.u, factor.rank);
  const projB = project(vectorB, factor.v, factor.rank);
  const raw = cosineSimilarity(projA, projB);

  // Cosine is [-1, 1]; the blend works in [0, 1].
  return (raw + 1) / 2;
}

function project(vector: Float32Array, factor: Float32Array, rank: number): Float32Array {
  const dims = vector.length;
  const out = new Float32Array(rank);
  for (let r = 0; r < rank; r += 1) {
    let sum = 0;
    const offset = r * dims;
    for (let i = 0; i < dims; i += 1) sum += vector[i] * factor[offset + i];
    out[r] = sum;
  }
  return out;
}
