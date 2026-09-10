/**
 * Session directives — outfit instructions typed in plain English.
 *
 * "I want a red hat" or "keep it formal", applied to every proposal made
 * afterwards and gone when the page is left. They are deliberately *not*
 * StyleNotes: a note is a standing fact about how someone dresses ("I don't
 * wear boots with shorts") and earns its place in the database, whereas a
 * directive is a mood for the next ten minutes. Persisting those would quietly
 * shape next week's outfits from a whim nobody remembers typing.
 *
 * Soft, never a filter. The closet is small enough that two directives can
 * easily have zero overlap, and a hard filter would answer with a blank screen
 * and no explanation. Instead a matching garment gets a large score bonus and
 * unsatisfied directives are reported back so the UI can say so plainly.
 *
 * Why "formal" does not become a bag of per-category weights: lib/outfit/
 * formality.ts already scores every garment 0..10 from category, subcategory
 * and name, and it is 100% populated. Asking a model to invent weights per
 * category would duplicate that ladder, less consistently and at a cost per
 * outfit. The model's job here is to turn English into a target on the ladder
 * we already have.
 */

import { itemFormality, FORMALITY_MAX, FORMALITY_MIN, type Formality } from "./formality";
import { garmentWarmth } from "@/lib/packing/plan";
import type { Color } from "@/lib/json";

/**
 * What a directive can be matched against.
 *
 * Declared structurally rather than as ScorableItem, because a directive reads
 * only descriptive fields and the two callers disagree elsewhere — the random
 * builder's item types `season` differently, and inheriting a field nothing
 * here touches would have forced a cast at the call site to satisfy a
 * constraint that does not exist.
 *
 * `categoryPath` is the item's category and every category above it
 * (lib/category-tree.ts). Honouring it is what makes "I want a shirt" accept a
 * t shirt filed under shirt — the same widening the outfit slot rules already
 * do, rather than a second nesting rule that could disagree with the first.
 */
export type DirectiveTarget = {
  id?: string;
  category: string;
  subcategory?: string | null;
  name?: string | null;
  material?: string | null;
  pattern?: string | null;
  colors?: Color[];
  categoryPath?: string[];
};

export type SessionDirective =
  /** Wants a garment matching these terms in the outfit ("a red hat"). */
  | { kind: "include"; id: string; text: string; category?: string; terms: string[] }
  /** Wants to see less of something ("no black", "not the denim jacket"). */
  | { kind: "exclude"; id: string; text: string; category?: string; terms: string[] }
  /** Pulls the whole look toward a point on the formality ladder. */
  | { kind: "formality"; id: string; text: string; target: Formality }
  /** Pulls the look toward a warmth, on garmentWarmth's 0..3 scale. */
  | { kind: "warmth"; id: string; text: string; target: number }
  /**
   * Understood as clothing-related but not expressible as anything the scorer
   * can act on. Kept rather than refused: the same reasoning as StyleNote,
   * which stores what someone typed even when it parsed to nothing, because
   * throwing away their words to show an error teaches them not to type.
   */
  | { kind: "note"; id: string; text: string };

/**
 * Bonus for a garment that satisfies an outstanding `include` directive.
 *
 * Sized against PREFER_BOOST (0.08) in style-rules.ts, which is the soft nudge
 * a "I like these together" note earns. A directive is a live instruction, not
 * a standing taste, so it has to beat that decisively: at SAFE_TEMPERATURE
 * (0.05) a 0.35 gap makes the matching garment roughly e^7 — about 1100x —
 * likelier to be drawn. Effectively decisive without ever being a filter, so a
 * closet with no red hat still returns a complete outfit.
 */
export const DIRECTIVE_BOOST = 0.35;

/** Per-step penalty for missing the requested formality, over a 0..10 ladder. */
export const FORMALITY_STEP_PENALTY = 0.03;

/**
 * Per-step penalty for missing the requested warmth.
 *
 * garmentWarmth spans 0..3 against formality's 0..10, so the per-step figure
 * is larger to make a full miss cost about the same on both scales.
 */
export const WARMTH_STEP_PENALTY = 0.1;

/** Warmth of one garment, on garmentWarmth's scale. */
export function targetWarmth(item: DirectiveTarget): number {
  return garmentWarmth({ ...item, id: item.id ?? "" });
}

const normalize = (s: string) => s.trim().toLowerCase();

/** Does this garment answer this directive? */
export function itemSatisfies(item: DirectiveTarget, directive: SessionDirective): boolean {
  if (directive.kind !== "include" && directive.kind !== "exclude") return false;

  const categoryText = normalize(
    [item.category, item.subcategory ?? "", ...(item.categoryPath ?? [])].join(" "),
  );
  if (directive.category && !categoryText.includes(normalize(directive.category))) return false;

  // Every term must appear somewhere describable: colour names, pattern,
  // material, or the item's own name. "red hat" is category + colour; "linen"
  // alone is a material with no category at all.
  return directive.terms.every((term) => {
    const t = normalize(term);
    if ((item.colors ?? []).some((c) => normalize(c.name).includes(t))) return true;
    if (item.pattern && normalize(item.pattern).includes(t)) return true;
    if (item.material && normalize(item.material).includes(t)) return true;
    if (item.name && normalize(item.name).includes(t)) return true;
    return categoryText.includes(t);
  });
}

/**
 * Score adjustment for adding `item` to `placed`.
 *
 * An `include` directive pays out once: after something red-and-hat-shaped is
 * seated, further red hats earn nothing, so a directive cannot crowd out the
 * rest of the outfit.
 */
export function directiveBonus(
  placed: readonly DirectiveTarget[],
  item: DirectiveTarget,
  directives: readonly SessionDirective[],
): number {
  let bonus = 0;
  for (const directive of directives) {
    switch (directive.kind) {
      case "include":
        // Pays out once; a seated match stops further ones earning anything.
        if (placed.some((p) => itemSatisfies(p, directive))) break;
        if (itemSatisfies(item, directive)) bonus += DIRECTIVE_BOOST;
        break;
      case "exclude":
        // Symmetric to include and equally soft: strongly disfavoured, still
        // reachable if the slot has nothing else, which beats failing to
        // build an outfit at all.
        if (itemSatisfies(item, directive)) bonus -= DIRECTIVE_BOOST;
        break;
      case "formality":
        bonus -= Math.abs(itemFormality(item) - directive.target) * FORMALITY_STEP_PENALTY;
        break;
      case "warmth":
        bonus -= Math.abs(targetWarmth(item) - directive.target) * WARMTH_STEP_PENALTY;
        break;
      case "note":
        break;
    }
  }
  return bonus;
}

/**
 * Which directives the finished outfit failed to honour.
 *
 * Formality is judged on the mean of the look rather than any one garment: a
 * formal outfit is allowed a casual belt. Within two rungs counts as met,
 * matching FREE_SPREAD's premise that small formality gaps read as deliberate.
 */
export const FORMALITY_TOLERANCE = 2;
/** Warmth is a 0..3 scale, so the same proportional slack is a smaller number. */
export const WARMTH_TOLERANCE = 0.8;

export function unmetDirectives(
  items: readonly DirectiveTarget[],
  directives: readonly SessionDirective[],
): SessionDirective[] {
  return directives.filter((directive) => {
    if (directive.kind === "note") return false;
    if (directive.kind === "include") return !items.some((i) => itemSatisfies(i, directive));
    if (directive.kind === "exclude") return items.some((i) => itemSatisfies(i, directive));
    if (items.length === 0) return true;
    if (directive.kind === "warmth") {
      const warmth = items.reduce((max, i) => Math.max(max, targetWarmth(i)), 0);
      return Math.abs(warmth - directive.target) > WARMTH_TOLERANCE;
    }
    const mean = items.reduce((sum, i) => sum + itemFormality(i), 0) / items.length;
    return Math.abs(mean - directive.target) > FORMALITY_TOLERANCE;
  });
}

/**
 * Why a directive went unhonoured.
 *
 * The distinction is the whole value of the message. "I want a red hat" can
 * fail because the closet has no red hat, or because the outfit layout has no
 * hat slot to put one in — and those need opposite responses. Reporting the
 * first when the second is true sends someone looking for a wardrobe problem
 * they do not have, which is exactly what the first version did against a
 * closet holding five red hats.
 */
export type DirectiveMiss = "no_match" | "no_slot" | "not_this_time" | "couldnt_avoid";

export function diagnoseDirective(
  directive: SessionDirective,
  pool: readonly DirectiveTarget[],
  canSeat: (item: DirectiveTarget) => boolean,
): DirectiveMiss {
  // An exclusion that went unhonoured means the slot had nothing else to
  // offer — the soft penalty lost to an empty bench. Saying "no match" there
  // would be backwards.
  if (directive.kind === "exclude") return "couldnt_avoid";
  if (directive.kind !== "include") return "not_this_time";
  const matches = pool.filter((item) => itemSatisfies(item, directive));
  if (matches.length === 0) return "no_match";
  return matches.some(canSeat) ? "not_this_time" : "no_slot";
}

/** Clamp a model- or keyword-derived target onto the ladder. */
export function clampFormality(value: number): Formality {
  if (!Number.isFinite(value)) return (FORMALITY_MIN + FORMALITY_MAX) / 2;
  return Math.min(FORMALITY_MAX, Math.max(FORMALITY_MIN, value));
}

/* ----------------------------------------------------------- parsing --- */

/**
 * Words that place a look on the formality ladder.
 *
 * Deliberately small. This is the cheap path that catches the phrasings people
 * actually repeat; anything else falls through to the model rather than being
 * guessed at from a longer word list, because a wrong guess here silently
 * reshapes every outfit and never announces itself.
 */
const WARMTH_WORDS: ReadonlyArray<{ match: RegExp; target: number }> = [
  { match: /\b(freezing|snow|parka weather|bundled|very warm|warmest)\b/, target: 3 },
  { match: /\b(warm|warmer|cold|chilly|cosy|cozy|layered up)\b/, target: 2.4 },
  { match: /\b(light|lighter|cool|breathable|hot|heat|summery)\b/, target: 0.5 },
];

/**
 * Turns an instruction into an avoidance.
 *
 * Checked before the include path, because "no black" and "black" resolve to
 * the same terms and differ only here — reading the negation second would
 * make every avoidance a request for the thing.
 */
const NEGATION = /\b(no|not|without|avoid|skip|never|don'?t want|nothing)\b/;

const FORMALITY_WORDS: ReadonlyArray<{ match: RegExp; target: Formality }> = [
  { match: /\b(black tie|black-tie|formal|formalwear|suited|dressed up)\b/, target: 9 },
  { match: /\b(interview|wedding|funeral|court|gala)\b/, target: 8 },
  { match: /\b(smart casual|business casual|dressy|sharp|polished)\b/, target: 6 },
  { match: /\b(casual|relaxed|everyday|laid back|laid-back)\b/, target: 3 },
  { match: /\b(lounge|loungewear|pyjama|pajama|gym|workout|beach|errands)\b/, target: 1 },
];

export type ParsedDirective = { directive: SessionDirective; confident: boolean };

/**
 * Keyword pass over a typed instruction.
 *
 * Returns null when nothing recognisable is found, which is the signal to ask
 * the model. Matching categories against the user's own list is the same
 * lesson as resolveClassifierCategory: a closet labelled "t shirt" and
 * "jeans" does not answer to a built-in taxonomy.
 */
export function parseDirectiveKeywords(
  text: string,
  vocab: { categories: readonly string[]; colors: readonly string[] },
  id = "d",
): SessionDirective | null {
  const lower = normalize(text);
  if (!lower) return null;

  const negated = NEGATION.test(lower);

  if (!negated) {
    for (const { match, target } of FORMALITY_WORDS) {
      if (match.test(lower)) return { kind: "formality", id, text, target };
    }
    for (const { match, target } of WARMTH_WORDS) {
      if (match.test(lower)) return { kind: "warmth", id, text, target };
    }
  }

  // Longest first, so "long sleeve shirt" wins over "shirt".
  const category = [...vocab.categories]
    .sort((a, b) => b.length - a.length)
    .find((c) => new RegExp(`\\b${escapeRe(normalize(c))}s?\\b`).test(lower));

  const terms = vocab.colors.filter((c) => new RegExp(`\\b${escapeRe(normalize(c))}\\b`).test(lower));

  if (!category && terms.length === 0) return null;
  return { kind: negated ? "exclude" : "include", id, text, category, terms };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Short restatement shown on the chip, so the effect is legible at a glance. */
export function describeDirective(directive: SessionDirective): string {
  switch (directive.kind) {
    case "formality":
      if (directive.target >= 8) return "Dressing formally";
      if (directive.target >= 6) return "Smartening things up";
      if (directive.target <= 2) return "Keeping it very casual";
      return "Keeping it casual";
    case "warmth":
      if (directive.target >= 2.2) return "Dressing warm";
      if (directive.target <= 0.8) return "Dressing light";
      return "Dressing for mild weather";
    case "note":
      // Says plainly that it was heard and is doing nothing, rather than
      // implying an effect the scorer never applied.
      return "Noted, but not something I can match on";
    default: {
      const what = [directive.terms.join(" "), directive.category].filter(Boolean).join(" ");
      const verb = directive.kind === "exclude" ? "Avoiding" : "Including";
      return `${verb} ${what || directive.text}`;
    }
  }
}
