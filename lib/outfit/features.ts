/**
 * Per-item feature vectors for the contextual preference model
 * (docs/OUTFIT_INTELLIGENCE.md §4, Layer 2).
 *
 * ── Why these exist ─────────────────────────────────────────────────────────
 *
 * The identity Bradley-Terry model has one free parameter per garment. On the
 * measured closet that is 183 parameters against 59 comparisons touching 76
 * items, so it cannot generalize — it can only memorize, and `pnpm eval:ranker`
 * measured exactly that: 86.8% in-sample against 53.8% leave-one-out, with 107
 * items unable to hold an opinion at all.
 *
 * A contextual model makes strength a function of what a garment *is*:
 *
 *     θᵢ = αᵢ + wᵀxᵢ
 *
 * `w` is shared across every comparison, so one choice teaches the model about
 * every similar garment, and an item nobody has ever compared still gets a
 * strength. That is the whole point; see lib/outfit/bradley-terry.ts.
 *
 * ── Why hex and not colour names ────────────────────────────────────────────
 *
 * Items carry both a hex and a name per colour. The names are a closed 15-word
 * vocabulary in practice but they are produced by importers and by hand, so they
 * are the less reliable half of the pair — and they cannot express *how* two
 * colours relate. The hex supports real perceptual geometry, which
 * lib/outfit/color-harmony.ts already leans on for the same reason.
 *
 * Everything here is derived from fields with 100% coverage on the real closet
 * (colour, category, name). Nothing reads `season`, `styleTags`, `material` or
 * wear history — those are 0–7% populated, and a feature that is absent for
 * fourteen items in fifteen contributes noise with a coefficient attached.
 */

import type { Color } from "@/lib/json";
import { hexToLCh, isPerceptuallyNeutral } from "@/lib/outfit/color-harmony";
import { isBoldPattern, type ScorableItem } from "@/lib/outfit/compatibility";
import { FORMALITY_MAX, itemFormality } from "@/lib/outfit/formality";

/**
 * Ordered, because a feature vector is positional and the order is part of the
 * contract between this module and a fitted `w`. Appending is safe; reordering
 * invalidates every stored coefficient.
 */
export const FEATURE_NAMES = [
  "lightness",
  "chroma",
  "hueCos",
  "hueSin",
  "neutralShare",
  "colorCount",
  "formality",
  "hasPattern",
  "boldPattern",
] as const;

export const FEATURE_DIMS = FEATURE_NAMES.length;

/** Chroma is unbounded in principle; sRGB rarely exceeds this in LCh. */
const CHROMA_SCALE = 100;
/** Beyond three colours the count stops being informative about the garment. */
const COLOR_COUNT_SCALE = 3;

/**
 * Raw (uncentred) features for one item, every dimension in [-1, 1].
 *
 * Comparable scales matter: `w` takes a single shared L2 penalty, so a dimension
 * measured in the hundreds would be penalized far less per unit of influence
 * than one measured in fractions, and the regularizer would silently express a
 * preference nobody chose.
 */
export function itemFeatures(item: ScorableItem): Float64Array {
  const out = new Float64Array(FEATURE_DIMS);
  const colors: Color[] = item.colors ?? [];

  let lightnessTotal = 0;
  let chromaTotal = 0;
  let hueCosTotal = 0;
  let hueSinTotal = 0;
  let neutralCount = 0;
  let chromaticCount = 0;
  let parsed = 0;

  for (const color of colors) {
    const lch = hexToLCh(color.hex);
    if (!lch) continue;
    parsed += 1;
    lightnessTotal += lch.l;
    chromaTotal += lch.c;
    if (isPerceptuallyNeutral(lch)) {
      neutralCount += 1;
      continue;
    }
    // Hue is circular, so it cannot be averaged as a number — 350° and 10° are
    // adjacent and would average to 180°, the opposite hue. Sine and cosine
    // carry it correctly, and they also let the model express "warm" or "cool"
    // as a direction rather than as a wrapped scalar.
    //
    // Neutrals are excluded outright: at low chroma the hue angle is numerically
    // unstable, so including it would feed the model noise weighted as evidence.
    chromaticCount += 1;
    const radians = (lch.h * Math.PI) / 180;
    hueCosTotal += Math.cos(radians);
    hueSinTotal += Math.sin(radians);
  }

  if (parsed > 0) {
    out[0] = clamp01(lightnessTotal / parsed / 100);
    out[1] = clamp01(chromaTotal / parsed / CHROMA_SCALE);
    out[4] = neutralCount / parsed;
    out[5] = Math.min(parsed, COLOR_COUNT_SCALE) / COLOR_COUNT_SCALE;
  }
  if (chromaticCount > 0) {
    out[2] = hueCosTotal / chromaticCount;
    out[3] = hueSinTotal / chromaticCount;
  }

  out[6] = clamp01(itemFormality(item) / FORMALITY_MAX);

  const pattern = item.pattern?.trim();
  out[7] = pattern ? 1 : 0;
  out[8] = isBoldPattern(item.pattern) ? 1 : 0;

  return out;
}

/**
 * ── Why there is no garment-kind one-hot ────────────────────────────────────
 *
 * The obvious feature — which kind of garment this is — is *unidentifiable* from
 * the data we log, and including it actively hurt.
 *
 * A comparison is between two outfits of the same shape, so the mean kind
 * composition is identical on both sides and cancels out of the difference. The
 * only thing left for a kind coefficient to fit is an artifact: `rejectedIds` is
 * stored as a deduplicated flat union of the passed-over outfits, so when two
 * arms share a piece the loser side has five items where the winner has three,
 * and its per-kind proportions shift for reasons that have nothing to do with
 * taste.
 *
 * With the one-hots in, the two largest fitted coefficients were kindTop (−1.59)
 * and neutralShare (+1.56) — the first of which cannot mean anything, since every
 * outfit on both sides had exactly one top. It also failed the transfer test:
 * like/pass AUC came out at 0.674 against 0.708 for using no affinity at all,
 * i.e. coefficients fit on pick rows made rate rows *worse*.
 *
 * Kind information still reaches the model through `formality`, which is derived
 * from it and is a scalar rather than a composition. If per-arm logging ever
 * lands — one row per shown outfit instead of a pooled union — the one-hots
 * become identifiable and are worth revisiting.
 */

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export type FeatureMap = {
  /** Item id → centred feature vector. */
  features: Map<string, Float64Array>;
  /** Closet mean that was subtracted, kept so a fit can be interpreted. */
  mean: Float64Array;
  dims: number;
};

/**
 * Feature vectors for a closet, centred on the closet mean.
 *
 * Centring is not cosmetic. The model compares *differences* of mean feature
 * vectors, so a constant offset cancels — except against `NEUTRAL_ANCHOR`, which
 * has no features and therefore an implicit zero vector. Uncentred, "an outfit
 * scores above neutral" would be explained partly by the raw magnitude of the
 * features, and `w` would absorb a bias term that belongs to the anchor. Centred,
 * a zero vector *is* the average garment, which is what the anchor is supposed to
 * mean and what NEUTRAL_AFFINITY = 0.5 already assumes.
 *
 * The mean is taken over the closet, not over the compared items: the compared
 * subset is chosen by a Thompson draw, so centring on it would move the origin
 * every time the sampler's taste changed.
 */
export function buildFeatureMap(items: Iterable<ScorableItem>): FeatureMap {
  const raw = new Map<string, Float64Array>();
  for (const item of items) raw.set(item.id, itemFeatures(item));

  const mean = new Float64Array(FEATURE_DIMS);
  if (raw.size > 0) {
    for (const vector of raw.values()) {
      for (let i = 0; i < FEATURE_DIMS; i += 1) mean[i] += vector[i];
    }
    for (let i = 0; i < FEATURE_DIMS; i += 1) mean[i] /= raw.size;
  }

  const features = new Map<string, Float64Array>();
  for (const [id, vector] of raw) {
    const centred = new Float64Array(FEATURE_DIMS);
    for (let i = 0; i < FEATURE_DIMS; i += 1) centred[i] = vector[i] - mean[i];
    features.set(id, centred);
  }

  return { features, mean, dims: FEATURE_DIMS };
}

/** Readable view of a fitted coefficient vector, strongest influence first. */
export function describeWeights(weights: readonly number[]): { name: string; weight: number }[] {
  return FEATURE_NAMES.map((name, index) => ({ name, weight: weights[index] ?? 0 })).sort(
    (a, b) => Math.abs(b.weight) - Math.abs(a.weight),
  );
}
