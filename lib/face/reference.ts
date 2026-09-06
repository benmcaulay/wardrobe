/**
 * Reference-set matching for Mode B (docs/CAMERA_ROLL_PERSON_ISOLATION.md §5, Phase 4).
 *
 * The user hand-picks a few photos of just themselves; we embed those, keep a
 * centroid in memory for the length of one scan, score every candidate face
 * against it, and throw all of it away. Nothing here is ever persisted.
 *
 * Two design points worth not losing:
 *
 * **Ephemerality is the architecture, not a nicety.** The enrolled-gallery
 * design this replaces died on key management — the mitigation everyone
 * recommends is envelope-encrypting the gallery under a passphrase, and this
 * app authenticates with magic links and has no passphrase to derive a key
 * from. Building the set per-scan removes the thing that needed protecting. It
 * is also the *Zellmer v. Meta* fact pattern: face vectors that are "simply
 * numbers", deleted immediately after matching, never retained.
 *
 * **Two enrolled people give a measured threshold instead of a guessed one.**
 * With both halves of the household enrolled, the decision boundary is the
 * midpoint between two centroids rather than a constant someone picked. This
 * repo has already been burned by the alternative: `lib/wear/photo-match.ts`
 * records that unrelated garments sit at cosine 0.432 and 1% of unrelated pairs
 * exceed 0.841, so "an intuition-picked threshold would have matched
 * everything". The same trap applies to faces, and DeepFace's own tuned table
 * puts SFace at 0.593 — close enough to plausible-looking numbers to be
 * dangerous.
 */

import { cosine, l2Normalize } from "./geometry";

/** SFace embedding width. */
export const FACE_EMBEDDING_DIM = 128;

/**
 * Fallback decision threshold, used only when there is exactly one enrolled
 * person and no negative class to calibrate against.
 *
 * DeepFace's tuned value for SFace cosine similarity. Treated as a floor to
 * fail safe, never as a tuned constant — see `calibrateThreshold`.
 */
export const SFACE_COSINE_FALLBACK = 0.593;

/**
 * Never accept a match below this, whatever calibration suggests.
 *
 * Two people who look alike can put their centroid midpoint anywhere; without a
 * floor, a household of siblings would calibrate itself into accepting
 * everyone. Over-splitting is recoverable with a tap in review, over-merging
 * silently files her clothes in his closet.
 */
export const MIN_ACCEPTABLE_THRESHOLD = 0.4;

export type ReferenceSet = {
  ownerId: string;
  /** L2-normalised mean of the enrolled face embeddings. */
  centroid: Float32Array;
  /** How many faces went into it — low counts are worth surfacing. */
  sampleCount: number;
};

/**
 * Mean of L2-normalised embeddings, renormalised.
 *
 * Averaging normalised vectors and renormalising approximates the spherical
 * mean, which is what cosine scoring wants. Averaging raw embeddings would let
 * a single high-norm crop dominate the set.
 */
export function buildCentroid(embeddings: readonly Float32Array[]): Float32Array | null {
  if (embeddings.length === 0) return null;
  const dim = embeddings[0]!.length;
  const acc = new Float32Array(dim);
  for (const raw of embeddings) {
    const v = l2Normalize(Float32Array.from(raw));
    for (let i = 0; i < dim; i++) acc[i]! += v[i]!;
  }
  for (let i = 0; i < dim; i++) acc[i]! /= embeddings.length;
  return l2Normalize(acc);
}

export function buildReferenceSet(
  ownerId: string,
  embeddings: readonly Float32Array[],
): ReferenceSet | null {
  const centroid = buildCentroid(embeddings);
  if (!centroid) return null;
  return { ownerId, centroid, sampleCount: embeddings.length };
}

/**
 * Decision threshold for a roster of reference sets.
 *
 * One person: no negative class exists, so fall back to the published constant.
 * Two or more: put the boundary midway between the closest pair of centroids,
 * which is the whole benefit of a two-person household — the hard negative is
 * the other person, exactly as the research says it must be. Clamped so a
 * lookalike pair cannot calibrate the gate into uselessness.
 */
export function calibrateThreshold(sets: readonly ReferenceSet[]): number {
  if (sets.length < 2) return SFACE_COSINE_FALLBACK;

  let closest = -1;
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const sim = cosine(sets[i]!.centroid, sets[j]!.centroid);
      if (sim > closest) closest = sim;
    }
  }
  // Midway between "indistinguishable" (the closest pair) and "identical".
  const midpoint = (closest + 1) / 2;
  return Math.max(MIN_ACCEPTABLE_THRESHOLD, Math.min(midpoint, SFACE_COSINE_FALLBACK));
}

export type FaceVerdict = {
  ownerId: string | null;
  similarity: number;
  /** Gap to the runner-up owner. Small means the two people scored alike. */
  margin: number;
};

/**
 * Attribute one face to at most one enrolled owner.
 *
 * Returns `ownerId: null` for a face that clears nobody's bar — the partner's
 * friend, a stranger in the background, a model inside a screenshotted shopping
 * page. All four rejection classes fail the same test, which is the point.
 */
export function attributeFace(
  embedding: Float32Array,
  sets: readonly ReferenceSet[],
  threshold: number,
): FaceVerdict {
  if (sets.length === 0) return { ownerId: null, similarity: 0, margin: 0 };

  const scored = sets
    .map((s) => ({ ownerId: s.ownerId, similarity: cosine(embedding, s.centroid) }))
    .sort((a, b) => b.similarity - a.similarity);

  const best = scored[0]!;
  const margin = best.similarity - (scored[1]?.similarity ?? 0);
  if (best.similarity < threshold) return { ownerId: null, similarity: best.similarity, margin };
  return { ownerId: best.ownerId, similarity: best.similarity, margin };
}

/**
 * Attribute a whole photo from the faces found in it.
 *
 * The largest matching face wins rather than the highest-scoring one: in a
 * group shot the person whose clothes are catalogueable is the one in the
 * foreground, and a tiny background face that happens to score well is exactly
 * the wrong subject to file garments against.
 */
export function attributePhoto(
  faces: readonly { area: number; verdict: FaceVerdict }[],
): FaceVerdict | null {
  const matched = faces.filter((f) => f.verdict.ownerId !== null);
  if (matched.length === 0) return null;
  return matched.reduce((best, f) => (f.area > best.area ? f : best)).verdict;
}
