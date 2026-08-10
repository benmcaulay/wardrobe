/**
 * Matching camera-roll crops against the closet (docs/OUTFIT_INTELLIGENCE.md §7).
 *
 * ── What the measurements say ───────────────────────────────────────────────
 *
 * Everything here is tuned to numbers from `pnpm calibrate:wear-match` and
 * `pnpm benchmark:wear-retrieval` on a real 180-item wardrobe, MobileCLIP-S2
 * fp16. Re-run both after any encoder change; these constants are meaningless
 * against a different embedding space.
 *
 *   median similarity between DISTINCT items   0.432
 *   p99 between distinct items                 0.841
 *   mean nearest-neighbour per item            0.816
 *   top-1 retrieval, studio→studio             69.9%
 *   top-5 retrieval, studio→studio             85.3%
 *
 * Three consequences drive the design:
 *
 * 1. **Absolute cosine means nothing.** Unrelated garments sit at 0.43 and 1%
 *    of unrelated pairs exceed 0.84. A threshold chosen by intuition would
 *    match everything.
 * 2. **Top-1 is not reliable enough to assert.** 69.9% on the *easy* task
 *    (studio render vs studio photo) is an upper bound; a worn, creased,
 *    partly-occluded garment in household light will do worse. Naming a single
 *    item would be wrong roughly a third of the time at best.
 * 3. **Some items are genuinely indistinguishable.** The closest confusions are
 *    two pairs of light-wash baggy jeans at 0.96 and two pairs of the same
 *    shorts in different colours at 0.95. No matcher fixes that, because the
 *    photos really do look the same.
 *
 * So this returns a **ranked shortlist, not a verdict**, and the confidence it
 * assigns is deliberately capped well below certainty. The user's confirmation
 * (§7) is what turns a shortlist into a fact — which is the design the wear log
 * was built for: inference is allowed to be aggressive precisely because
 * nothing it produces is ever stated as true.
 */

import { cosineSimilarity } from "@/lib/wear/embedding";
import { PHOTO_CONFIDENCE_CEILING, PHOTO_CONFIDENCE_FLOOR } from "@/lib/wear/signals";

/** Median similarity between two items the user owns but that are unrelated. */
export const BACKGROUND_SIMILARITY = 0.432;

/**
 * A crop must beat this to be considered at all. Set at the p99 of
 * distinct-item pairs: below it, a score is indistinguishable from two
 * unrelated things in this wardrobe happening to look alike.
 */
export const MATCH_FLOOR = 0.841;

/** Nothing is ever proposed with more confidence than this. */
export const MAX_MATCH_CONFIDENCE = PHOTO_CONFIDENCE_CEILING;

/** How many candidates to offer per detected garment. */
export const SHORTLIST_SIZE = 5;

export type ClosetVector = { itemId: string; vector: Float32Array };

export type MatchCandidate = {
  itemId: string;
  similarity: number;
  /** Gap to the next-best *different* item. Large = an unambiguous match. */
  margin: number;
  confidence: number;
};

/**
 * Map a similarity and its margin onto the confidence band the wear log accepts.
 *
 * Two terms, multiplied:
 *
 *   strength — how far above MATCH_FLOOR the score sits, as a fraction of the
 *              remaining headroom to 1.0.
 *   clarity  — how much it beats the runner-up. A 0.95 match is worth little if
 *              a different garment also scores 0.94; that is the near-duplicate
 *              case, and it is exactly when a confident guess would be wrong.
 *
 * The product is scaled into [FLOOR, CEILING] rather than [0, 1], so no
 * inference can ever reach the confidence of an explicit log.
 */
export function matchConfidence(similarity: number, margin: number): number {
  if (similarity < MATCH_FLOOR) return 0;

  const strength = Math.min(1, (similarity - MATCH_FLOOR) / (1 - MATCH_FLOOR));
  // 0.05 is a meaningful gap here: the mean correct-vs-best-wrong margin in the
  // retrieval benchmark was 0.056, so a gap at that scale is about as decisive
  // as this encoder gets.
  const clarity = Math.min(1, margin / 0.05);

  const combined = strength * (0.35 + 0.65 * clarity);
  return (
    PHOTO_CONFIDENCE_FLOOR + combined * (MAX_MATCH_CONFIDENCE - PHOTO_CONFIDENCE_FLOOR)
  );
}

/**
 * Best closet candidates for one crop.
 *
 * `maxSimilarityPerItem` is taken across every crop of a photo before this is
 * called — a garment appears in one region, so the best crop is the evidence
 * and averaging over crops that mostly contain wall would bury it.
 */
export function rankCandidates(
  cropVector: Float32Array,
  closet: readonly ClosetVector[],
  shortlist: number = SHORTLIST_SIZE,
): MatchCandidate[] {
  if (closet.length === 0) return [];

  const scored = closet
    .map((entry) => ({ itemId: entry.itemId, similarity: cosineSimilarity(cropVector, entry.vector) }))
    .sort((a, b) => b.similarity - a.similarity);

  const top = scored.slice(0, Math.max(1, shortlist));
  return top
    .map((entry, index) => {
      // Every candidate's margin is measured against the best *other* item, so
      // the runner-up's margin is negative and its confidence collapses — which
      // is correct: it is the alternative, not a second independent finding.
      const rival = index === 0 ? scored[1]?.similarity ?? 0 : scored[0].similarity;
      const margin = entry.similarity - rival;
      return {
        itemId: entry.itemId,
        similarity: entry.similarity,
        margin,
        confidence: matchConfidence(entry.similarity, margin),
      };
    })
    .filter((candidate) => candidate.similarity >= MATCH_FLOOR);
}

export type PhotoMatch = {
  /** Best candidate, and the alternatives the user can pick instead. */
  best: MatchCandidate;
  alternatives: MatchCandidate[];
};

/**
 * Collapse every crop of one photo into per-garment findings.
 *
 * Takes the max similarity per closet item across all crops, then keeps the
 * distinct garments that clear the floor. Deduplicated by item, because the
 * same jacket showing up in four overlapping crops is one wear, not four.
 */
export function matchPhoto(
  cropVectors: readonly Float32Array[],
  closet: readonly ClosetVector[],
  shortlist: number = SHORTLIST_SIZE,
): PhotoMatch[] {
  if (cropVectors.length === 0 || closet.length === 0) return [];

  const best = new Map<string, number>();
  for (const crop of cropVectors) {
    for (const entry of closet) {
      const score = cosineSimilarity(crop, entry.vector);
      const current = best.get(entry.itemId);
      if (current == null || score > current) best.set(entry.itemId, score);
    }
  }

  const ranked = [...best.entries()]
    .map(([itemId, similarity]) => ({ itemId, similarity }))
    .sort((a, b) => b.similarity - a.similarity)
    .filter((entry) => entry.similarity >= MATCH_FLOOR);

  if (ranked.length === 0) return [];

  const runnerUp = ranked[1]?.similarity ?? BACKGROUND_SIMILARITY;
  const leader = ranked[0];

  return [
    {
      best: {
        itemId: leader.itemId,
        similarity: leader.similarity,
        margin: leader.similarity - runnerUp,
        confidence: matchConfidence(leader.similarity, leader.similarity - runnerUp),
      },
      alternatives: ranked.slice(1, shortlist).map((entry) => ({
        itemId: entry.itemId,
        similarity: entry.similarity,
        margin: entry.similarity - leader.similarity,
        confidence: matchConfidence(entry.similarity, entry.similarity - leader.similarity),
      })),
    },
  ];
}

/**
 * Overlapping crop windows for one image, as fractions of its dimensions.
 *
 * No garment detector is staged, so localization is brute force: a few scales
 * of overlapping windows, embed each, keep the best score per closet item. It
 * is the honest option — a detector would be another model and another 20 MB,
 * and the confirmation step already absorbs the imprecision.
 *
 * The full frame is included because a flat-lay or mirror selfie often *is* the
 * garment, and centre-weighted windows because that is where a person stands.
 */
export type CropWindow = { x: number; y: number; w: number; h: number };

export function cropWindows(): CropWindow[] {
  const windows: CropWindow[] = [{ x: 0, y: 0, w: 1, h: 1 }];

  // Vertical thirds with overlap — roughly torso / hips / feet on a standing
  // figure, which is how garments actually stack in a photo of a person.
  for (const y of [0, 0.22, 0.44, 0.6]) {
    windows.push({ x: 0.1, y, w: 0.8, h: 0.4 });
  }
  // Centre square at two scales, for close-ups and flat-lays.
  windows.push({ x: 0.2, y: 0.2, w: 0.6, h: 0.6 });
  windows.push({ x: 0.3, y: 0.1, w: 0.4, h: 0.55 });

  return windows;
}
