/**
 * The fixed occasion vocabulary (docs/OUTFIT_INTELLIGENCE.md §7).
 *
 * Calendar integration is out of scope, so nothing infers occasion from context
 * — the wear-confirmation prompt is the only source, and it asks the user to
 * pick one of these. That constrains the list hard: it has to be answerable in
 * one tap, without thinking, by someone half-paying-attention. Eight entries is
 * already the upper bound; resist adding a ninth.
 *
 * The mapping to style tags below is not decoration. Before any wear data
 * exists, an item's `styleTags` already imply which occasions it suits, so
 * occasion-conditioned recommendation works on day one and the wear log merely
 * sharpens a prior instead of building one from nothing. This is the cold-start
 * bridge for island closets, which have no cross-user pooling to fall back on.
 */

import { normalizeStyleTagName } from "@/lib/preferences";

export const OCCASIONS = [
  "work",
  "everyday",
  "going_out",
  "formal",
  "active",
  "travel",
  "home",
  "outdoors",
] as const;

export type Occasion = (typeof OCCASIONS)[number];

export const OCCASION_LABELS: Record<Occasion, string> = {
  work: "Work",
  everyday: "Everyday",
  going_out: "Going out",
  formal: "Formal",
  active: "Active",
  travel: "Travel",
  home: "Home",
  outdoors: "Outdoors",
};

/**
 * Style tags that suggest an item suits an occasion, drawn from the vocabulary
 * in lib/preferences.ts. Weights are priors, deliberately soft — a tag makes an
 * occasion more plausible, it never proves one.
 */
const OCCASION_TAG_PRIORS: Record<Occasion, Record<string, number>> = {
  work: { workwear: 0.9, tailored: 0.7, classic: 0.5, minimal: 0.4, preppy: 0.4 },
  everyday: { casual: 0.9, relaxed: 0.8, minimal: 0.5, cozy: 0.4, streetwear: 0.4 },
  going_out: { "going-out": 0.95, romantic: 0.6, streetwear: 0.4, vintage: 0.3 },
  formal: { tailored: 0.8, classic: 0.6, romantic: 0.4 },
  active: { athletic: 0.95, relaxed: 0.3 },
  travel: { relaxed: 0.6, cozy: 0.5, casual: 0.5, minimal: 0.3 },
  home: { cozy: 0.9, relaxed: 0.7 },
  outdoors: { athletic: 0.5, workwear: 0.3 },
};

export function isOccasion(value: string): value is Occasion {
  return (OCCASIONS as readonly string[]).includes(value);
}

/** Normalize a stored/user-supplied occasion, or null when unrecognized. */
export function parseOccasion(raw: string | null | undefined): Occasion | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return isOccasion(key) ? key : null;
}

/**
 * Prior probability, in [0, 1], that an item suits an occasion given only its
 * style tags. Returns a flat NEUTRAL_PRIOR for untagged items rather than zero:
 * absence of a tag is not evidence of unsuitability, and scoring it as such
 * would bury every item the user never bothered to tag.
 */
export const NEUTRAL_OCCASION_PRIOR = 0.35;

export function occasionPriorFromStyleTags(
  occasion: Occasion,
  styleTags: readonly string[],
): number {
  const priors = OCCASION_TAG_PRIORS[occasion];
  let best = 0;
  for (const tag of styleTags) {
    const weight = priors[normalizeStyleTagName(tag)];
    if (weight != null && weight > best) best = weight;
  }
  // Take the strongest matching tag rather than summing: three work-ish tags
  // don't make an item three times more suitable for work, and summing would
  // let heavily-tagged items dominate sparsely-tagged ones on tag count alone.
  return best > 0 ? best : NEUTRAL_OCCASION_PRIOR;
}

/** Occasions ranked by how well an item's tags fit them. Ties keep enum order. */
export function rankOccasionsForStyleTags(styleTags: readonly string[]): Occasion[] {
  return [...OCCASIONS].sort(
    (a, b) => occasionPriorFromStyleTags(b, styleTags) - occasionPriorFromStyleTags(a, styleTags),
  );
}
