/**
 * The formality ladder (docs/OUTFIT_INTELLIGENCE.md §4, Layer 1).
 *
 * Trainers with a suit is the second thing people notice after a colour clash,
 * and unlike colour it is almost purely categorical — you can judge it from
 * what a garment *is*, with no image and no wear history.
 *
 * Derived from category / subcategory / name rather than `styleTags`. The tags
 * would be the natural source and are the wrong one: 7.2% populated on the
 * measured closet (see lib/packing/palette.ts), so a tag-driven ladder would
 * score 13 of every 14 items as "unknown". Category is 100% populated, and the
 * name text rescues the vague ones — the same reasoning, and the same
 * ordered-rules shape, as `classifyGarmentKind` in lib/categories.ts.
 *
 * Pure and dependency-light so it runs client-side.
 */

import { classifyGarmentKind, type GarmentKind } from "@/lib/categories";

/** 0 = gym floor, 10 = black tie. */
export type Formality = number;

export const FORMALITY_MIN = 0;
export const FORMALITY_MAX = 10;

/**
 * Baseline per garment kind, used when nothing more specific matches.
 * Mid-scale on purpose: an unrecognised item should not drag a look toward
 * either extreme on no evidence.
 */
const KIND_BASELINE: Record<GarmentKind, Formality> = {
  top: 5,
  bottom: 5,
  dress: 6,
  outerwear: 5.5,
  shoes: 5,
  accessory: 5,
  other: 5,
};

/**
 * Ordered most-specific first, first match wins — same discipline as
 * GARMENT_KIND_RULES. Add rules where their specificity demands, not at the end:
 * "dress shirt" must beat "shirt", "tuxedo shoe" must beat "shoe".
 */
const FORMALITY_RULES: { score: Formality; match: RegExp }[] = [
  // Black tie and ceremonial.
  { score: 10, match: /(tuxedo|tux\b|black.?tie|ball ?gown|morning coat|tails\b)/ },
  { score: 9, match: /(evening gown|cocktail dress|dinner jacket|dress shoe|oxford|patent)/ },

  // Business / tailored.
  { score: 8, match: /(suit\b|dress shirt|dress pant|dress trouser|blazer|sport coat|waistcoat|pencil skirt|pump\b|heel)/ },
  { score: 7.5, match: /(trench|overcoat|topcoat|tie\b|silk blouse|loafer|brogue|derby|monk strap)/ },

  // Smart casual.
  { score: 6.5, match: /(chino|slack|button.?down|oxford shirt|midi dress|wrap dress|cardigan|merino|cashmere|knit\b|blouse)/ },
  { score: 6, match: /(polo|chelsea boot|ankle boot|mule|ballet flat|sweater|jumper|turtleneck|pleated)/ },

  // Everyday casual.
  { score: 4, match: /(jean|denim|t-?shirt|\btee\b|sneaker|trainer|canvas|chuck|plimsoll|sundress|cargo)/ },
  { score: 3.5, match: /(short\b|shorts\b|camisole|tank|graphic|henley|flannel|utility|anorak|windbreaker|puffer|parka)/ },

  // Loungewear, athletic, beach.
  { score: 2, match: /(hoodie|sweatshirt|sweatpant|track ?pant|jogger|fleece|legging|yoga|gym|athletic|running|jersey)/ },
  { score: 1, match: /(pyjama|pajama|lounge|slipper|robe|flip.?flop|slide\b|croc|swim|bikini|board short)/ },
];

/**
 * Where a garment sits on the ladder.
 *
 * Category is checked first on its own, then subcategory and name — a "Beach
 * Shirt Dress" filed under "dress" should not be read as a dress shirt because
 * its name happens to contain the words.
 */
export function itemFormality(input: {
  category?: string | null;
  subcategory?: string | null;
  name?: string | null;
}): Formality {
  const category = (input.category ?? "").trim().toLowerCase();
  if (category) {
    for (const rule of FORMALITY_RULES) {
      if (rule.match.test(category)) return rule.score;
    }
  }

  const detail = `${input.subcategory ?? ""} ${input.name ?? ""}`.trim().toLowerCase();
  if (detail) {
    for (const rule of FORMALITY_RULES) {
      if (rule.match.test(detail)) return rule.score;
    }
  }

  return KIND_BASELINE[classifyGarmentKind(input)];
}

/**
 * How far apart the pieces of a look sit, in ladder points.
 *
 * Spread rather than variance: what people notice is the single worst
 * mismatch — the trainers under the suit — not how tightly the whole outfit
 * clusters. Variance would let three tailored pieces dilute one wrong shoe.
 */
export function formalitySpread(scores: readonly Formality[]): number {
  if (scores.length < 2) return 0;
  return Math.max(...scores) - Math.min(...scores);
}

/**
 * A spread this size or smaller is unremarkable — nobody reads a knit with
 * chinos as a mismatch. Beyond it the penalty ramps to zero at MAX_SPREAD.
 */
export const FREE_SPREAD = 2.5;
export const MAX_SPREAD = 7;

/** Formality coherence of a look, 0..1. */
export function formalityCoherence(scores: readonly Formality[]): number {
  const spread = formalitySpread(scores);
  if (spread <= FREE_SPREAD) return 1;
  if (spread >= MAX_SPREAD) return 0;
  return 1 - (spread - FREE_SPREAD) / (MAX_SPREAD - FREE_SPREAD);
}
