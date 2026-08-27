/**
 * Choosing which of several candidate images to import as a garment reference.
 *
 * Pure and separate from the downloading so the rule can be tested exactly. The
 * rule exists because ordering cannot be trusted: a merchant page's og:image is
 * *usually* a full-resolution hero — Farfetch serves 1000x1334 where the search
 * thumbnail is 596x596 — but it is sometimes the site logo. Journeys returns a
 * 146x62 wordmark, and preferring the merchant image by position would have
 * swapped a good 600px product photo for a logo.
 *
 * This matters more than it sounds: the reference is what the catalog render
 * copies identity from, so its resolution sets the ceiling on output detail.
 */

/** Smallest edge a candidate must have to count as a product photo. */
export const MIN_IMPORT_EDGE_PX = 200;

/** Widest/tallest a product photo plausibly is; past this it is a banner. */
export const MAX_IMPORT_ASPECT = 2;

export type ImageDims = { width: number; height: number };

export function isUsableImportImage(dims: ImageDims): boolean {
  const { width, height } = dims;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return false;
  if (width <= 0 || height <= 0) return false;
  const shortest = Math.min(width, height);
  if (shortest < MIN_IMPORT_EDGE_PX) return false;
  return Math.max(width, height) / shortest <= MAX_IMPORT_ASPECT;
}

/**
 * Index of the best candidate, or -1 when none qualifies.
 *
 * Ranked by shortest edge rather than total pixels: a 2000x400 strip has more
 * pixels than a 700x700 product shot and is worse in every way that matters
 * here. Ties keep the earlier candidate, so the merchant page wins over the
 * thumbnail at equal size — it is the more likely to be the real product image.
 */
export function chooseBestImportImage(candidates: readonly ImageDims[]): number {
  let bestIndex = -1;
  let bestShortest = -1;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!;
    if (!isUsableImportImage(c)) continue;
    const shortest = Math.min(c.width, c.height);
    if (shortest > bestShortest) {
      bestShortest = shortest;
      bestIndex = i;
    }
  }
  return bestIndex;
}
