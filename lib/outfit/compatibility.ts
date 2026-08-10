/**
 * Layer 1: the compatibility prior (docs/OUTFIT_INTELLIGENCE.md §4).
 *
 * Scores a look using nothing but the item's own attributes — no wear history,
 * no user model, no cross-user pooling. That is the requirement, not a
 * simplification: closets are islands, so a new user and a newly added item
 * both start with zero interactions and something still has to be able to say
 * whether a shirt goes with a pair of trousers.
 *
 * ── Weighting follows the data, not the theory ──────────────────────────────
 *
 * On the measured 180-item closet: colours 100% populated, `pattern` sparse,
 * `styleTags` 7.2%, `material` 3.3%, `season` 0%. So colour dominates, and the
 * sparse fields are treated as *modifiers that only fire when present* rather
 * than weighted terms that would otherwise score absence. A scorer weighted by
 * what sounds important instead of what exists mostly measures missing data.
 *
 * Terms that have no opinion are dropped and the remaining weights renormalized,
 * so an item missing colour data doesn't get a mediocre score — it gets scored
 * on whatever is actually known about it.
 */

import type { Color, Season } from "@/lib/json";
import type { ClimateBand } from "@/lib/services/weather";
import { bilinearCompatibility } from "@/lib/outfit/bilinear";
import { climateFit } from "@/lib/outfit/climate";
import { itemColorHarmony, outfitColorHarmony, UNKNOWN_PAIR_SCORE } from "@/lib/outfit/color-harmony";
import { formalityCoherence, itemFormality } from "@/lib/outfit/formality";
import { outfitAffinity } from "@/lib/outfit/affinity";

export type ScorableItem = {
  id: string;
  category: string;
  subcategory?: string | null;
  name?: string | null;
  material?: string | null;
  pattern?: string | null;
  colors?: Color[];
  season?: Season[];
};

export type ScoringContext = {
  /** Today's climate, when known. Null is neutral, never a penalty. */
  band?: ClimateBand | null;
  /** Item id → unit-length embedding, for the bilinear term. */
  embeddings?: Map<string, Float32Array>;
  /**
   * Layer 2 (lib/outfit/affinity.ts): item id → personal affinity in [0, 1],
   * blending the style prompt with learned Bradley-Terry utilities. Absent
   * items have no opinion and are skipped, not scored as neutral.
   */
  affinity?: ReadonlyMap<string, number>;
};

export type CompatibilityBreakdown = {
  /** 0..1 overall. */
  score: number;
  color: number | null;
  formality: number | null;
  climate: number | null;
  bilinear: number | null;
  /** Layer 2 personalization; null when the user has no prompt and no history. */
  affinity: number | null;
  /** Multiplier applied after the weighted blend (pattern clash). */
  patternPenalty: number;
};

/**
 * Base weights. Colour carries the layer because it is the only attribute that
 * is both fully populated and genuinely discriminative — see the module header.
 * Renormalized over whichever terms return a number.
 */
export const TERM_WEIGHTS = {
  color: 0.5,
  formality: 0.3,
  climate: 0.2,
  /** Zero until Polyvore weights exist; see lib/outfit/bilinear.ts. */
  bilinear: 0.35,
  /**
   * Layer 2. Weighted below colour on purpose: compatibility is the part that
   * is grounded in measurable structure, and personalization is a residual on
   * top of a prior that already works (principle 1). It only participates at
   * all once the user has written a style prompt or made some choices.
   */
  affinity: 0.35,
} as const;

/** Patterns that read as loud enough to compete for attention. */
const BOLD_PATTERN = /(floral|print|graphic|leopard|zebra|animal|paisley|tie.?dye|camo|plaid|tartan|check|houndstooth|stripe|polka|geometric|abstract)/i;
/** Fine-scale patterns that sit quietly beside a bolder one. */
const SUBTLE_PATTERN = /(pinstripe|micro|subtle|heather|marl|melange|solid|plain|textured|ribbed)/i;

export function isBoldPattern(pattern: string | null | undefined): boolean {
  if (!pattern) return false;
  const value = pattern.trim();
  if (!value) return false;
  if (SUBTLE_PATTERN.test(value)) return false;
  return BOLD_PATTERN.test(value);
}

/**
 * Multiplier for pattern clash — a multiplier rather than a weighted term
 * precisely because `pattern` is sparsely populated. As a term it would drag
 * every untagged look toward the middle; as a multiplier it is exactly 1 unless
 * there is real evidence of a clash.
 *
 * One bold pattern is a focal point. Two is a fight.
 */
export const TWO_BOLD_PENALTY = 0.75;
export const MANY_BOLD_PENALTY = 0.55;

export function patternPenalty(items: readonly ScorableItem[]): number {
  const bold = items.filter((item) => isBoldPattern(item.pattern)).length;
  if (bold <= 1) return 1;
  return bold === 2 ? TWO_BOLD_PENALTY : MANY_BOLD_PENALTY;
}

function blend(terms: { weight: number; value: number | null }[]): number {
  let weighted = 0;
  let total = 0;
  for (const term of terms) {
    if (term.value == null || term.weight <= 0) continue;
    weighted += term.weight * term.value;
    total += term.weight;
  }
  // Nothing had an opinion — a closet of untagged items with no colours. Return
  // the neutral score rather than 0, which would read as "actively bad".
  return total === 0 ? UNKNOWN_PAIR_SCORE : weighted / total;
}

/** Mean pairwise bilinear score across a look, or null if no pair is covered. */
function outfitBilinear(
  items: readonly ScorableItem[],
  embeddings: Map<string, Float32Array> | undefined,
): number | null {
  if (!embeddings || items.length < 2) return null;

  let total = 0;
  let count = 0;
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const score = bilinearCompatibility(
        items[i].category,
        embeddings.get(items[i].id),
        items[j].category,
        embeddings.get(items[j].id),
      );
      if (score == null) continue;
      total += score;
      count += 1;
    }
  }
  return count === 0 ? null : total / count;
}

/** Score a complete look, 0..1, with the per-term breakdown for debugging. */
export function scoreOutfit(
  items: readonly ScorableItem[],
  context: ScoringContext = {},
): CompatibilityBreakdown {
  if (items.length === 0) {
    return {
      score: 0,
      color: null,
      formality: null,
      climate: null,
      bilinear: null,
      affinity: null,
      patternPenalty: 1,
    };
  }

  const color = items.length >= 2 ? outfitColorHarmony(items) : null;
  const formality =
    items.length >= 2 ? formalityCoherence(items.map((item) => itemFormality(item))) : null;
  const climate = context.band ? climateFit(items as never, context.band) : null;
  const bilinear = outfitBilinear(items, context.embeddings);
  const affinity = context.affinity
    ? outfitAffinity(
        items.map((item) => item.id),
        context.affinity,
      )
    : null;

  const base = blend([
    { weight: TERM_WEIGHTS.color, value: color },
    { weight: TERM_WEIGHTS.formality, value: formality },
    { weight: TERM_WEIGHTS.climate, value: climate },
    { weight: TERM_WEIGHTS.bilinear, value: bilinear },
    { weight: TERM_WEIGHTS.affinity, value: affinity },
  ]);

  const penalty = patternPenalty(items);
  return {
    score: Math.min(1, Math.max(0, base * penalty)),
    color,
    formality,
    climate,
    bilinear,
    affinity,
    patternPenalty: penalty,
  };
}

/**
 * How well one candidate joins a partial look, 0..1.
 *
 * Scored as the candidate against what is already placed, not as a rescore of
 * the whole set. During slot filling the placed items are fixed, so their
 * internal harmony is a constant that would add the same offset to every
 * candidate — including it costs O(n²) per candidate and changes no ranking.
 */
export function scoreAddition(
  placed: readonly ScorableItem[],
  candidate: ScorableItem,
  context: ScoringContext = {},
): number {
  if (placed.length === 0) return UNKNOWN_PAIR_SCORE;

  let colorTotal = 0;
  for (const item of placed) colorTotal += itemColorHarmony(item.colors, candidate.colors);
  const color = colorTotal / placed.length;

  const formality = formalityCoherence(
    [...placed, candidate].map((item) => itemFormality(item)),
  );

  const climate = context.band ? climateFit([...placed, candidate] as never, context.band) : null;

  let bilinearTotal = 0;
  let bilinearCount = 0;
  if (context.embeddings) {
    for (const item of placed) {
      const score = bilinearCompatibility(
        item.category,
        context.embeddings.get(item.id),
        candidate.category,
        context.embeddings.get(candidate.id),
      );
      if (score == null) continue;
      bilinearTotal += score;
      bilinearCount += 1;
    }
  }
  const bilinear = bilinearCount === 0 ? null : bilinearTotal / bilinearCount;

  // Only the candidate's own affinity: the placed items contribute the same
  // constant to every candidate, so including them would shift all scores
  // equally and change no ranking while diluting the term that discriminates.
  const affinity = context.affinity?.get(candidate.id) ?? null;

  const base = blend([
    { weight: TERM_WEIGHTS.color, value: color },
    { weight: TERM_WEIGHTS.formality, value: formality },
    { weight: TERM_WEIGHTS.climate, value: climate },
    { weight: TERM_WEIGHTS.bilinear, value: bilinear },
    { weight: TERM_WEIGHTS.affinity, value: affinity },
  ]);

  return Math.min(1, Math.max(0, base * patternPenalty([...placed, candidate])));
}
