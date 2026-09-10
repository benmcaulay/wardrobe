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
import type { ScorableItem } from "./compatibility";

export type SessionDirective =
  /** Wants a garment matching these terms in the outfit ("a red hat"). */
  | { kind: "include"; id: string; text: string; category?: string; terms: string[] }
  /** Pulls the whole look toward a point on the formality ladder. */
  | { kind: "formality"; id: string; text: string; target: Formality };

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

const normalize = (s: string) => s.trim().toLowerCase();

/** Does this garment answer this directive? */
export function itemSatisfies(item: ScorableItem, directive: SessionDirective): boolean {
  if (directive.kind !== "include") return false;

  if (directive.category) {
    const haystack = normalize(`${item.category} ${item.subcategory ?? ""}`);
    if (!haystack.includes(normalize(directive.category))) return false;
  }

  // Every term must appear somewhere describable: colour names, pattern,
  // material, or the item's own name. "red hat" is category + colour; "linen"
  // alone is a material with no category at all.
  return directive.terms.every((term) => {
    const t = normalize(term);
    if ((item.colors ?? []).some((c) => normalize(c.name).includes(t))) return true;
    if (item.pattern && normalize(item.pattern).includes(t)) return true;
    if (item.material && normalize(item.material).includes(t)) return true;
    if (item.name && normalize(item.name).includes(t)) return true;
    return normalize(`${item.category} ${item.subcategory ?? ""}`).includes(t);
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
  placed: readonly ScorableItem[],
  item: ScorableItem,
  directives: readonly SessionDirective[],
): number {
  let bonus = 0;
  for (const directive of directives) {
    if (directive.kind === "include") {
      if (placed.some((p) => itemSatisfies(p, directive))) continue;
      if (itemSatisfies(item, directive)) bonus += DIRECTIVE_BOOST;
      continue;
    }
    const distance = Math.abs(itemFormality(item) - directive.target);
    bonus -= distance * FORMALITY_STEP_PENALTY;
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

export function unmetDirectives(
  items: readonly ScorableItem[],
  directives: readonly SessionDirective[],
): SessionDirective[] {
  return directives.filter((directive) => {
    if (directive.kind === "include") return !items.some((i) => itemSatisfies(i, directive));
    if (items.length === 0) return true;
    const mean = items.reduce((sum, i) => sum + itemFormality(i), 0) / items.length;
    return Math.abs(mean - directive.target) > FORMALITY_TOLERANCE;
  });
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

  for (const { match, target } of FORMALITY_WORDS) {
    if (match.test(lower)) return { kind: "formality", id, text, target };
  }

  // Longest first, so "long sleeve shirt" wins over "shirt".
  const category = [...vocab.categories]
    .sort((a, b) => b.length - a.length)
    .find((c) => new RegExp(`\\b${escapeRe(normalize(c))}s?\\b`).test(lower));

  const terms = vocab.colors.filter((c) => new RegExp(`\\b${escapeRe(normalize(c))}\\b`).test(lower));

  if (!category && terms.length === 0) return null;
  return { kind: "include", id, text, category, terms };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Short restatement shown on the chip, so the effect is legible at a glance. */
export function describeDirective(directive: SessionDirective): string {
  if (directive.kind === "formality") {
    if (directive.target >= 8) return "Dressing formally";
    if (directive.target >= 6) return "Smartening things up";
    if (directive.target <= 2) return "Keeping it very casual";
    return "Keeping it casual";
  }
  const what = [directive.terms.join(" "), directive.category].filter(Boolean).join(" ");
  return `Including ${what || directive.text}`;
}
