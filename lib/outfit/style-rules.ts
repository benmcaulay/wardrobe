/**
 * Rules parsed from the user's own notes (docs/OUTFIT_INTELLIGENCE.md §9).
 *
 * ── Why these are rules and not embeddings ──────────────────────────────────
 *
 * The obvious move is to embed each note and compare it to outfits. It does not
 * work, and it fails in the worst possible direction: CLIP has no negation, so
 * "don't put that hat with that shirt" embeds *close* to outfits containing
 * that hat and that shirt. The similarity signal is real and points exactly
 * backwards. A note like this is a logical constraint over specific items, and
 * the only faithful representation is a structured rule.
 *
 * ── Why the items are known ─────────────────────────────────────────────────
 *
 * Notes are captured in context — the user writes one *about a proposal that is
 * on screen* — so "that hat" resolves to an item id without any pronoun
 * resolution. The parser (lib/services/styleNoteParser.ts) is told which items
 * were visible and only has to decide which of them the note is about. That
 * design choice is what makes the whole feature tractable.
 *
 * ── Why there is no global "describe your style" prompt ─────────────────────
 *
 * There was, briefly. It was the wrong shape: a blanket statement like
 * "relaxed streetwear, mostly neutrals" is largely already encoded in *which
 * garments the closet contains*, so ranking a closet by its own description
 * adds little. What the closet cannot tell you is the specific, situational
 * knowledge in the user's head — this hat doesn't work with that shirt, these
 * jeans only with boots. That is what notes capture.
 *
 * Pure and dependency-light; runs client-side.
 */

import type { ClimateBand } from "@/lib/services/weather";
import type { Occasion } from "@/lib/wear/occasions";

/**
 * Roughly one sentence. Notes are meant to be one thought each — a longer one
 * usually contains two rules, and the parser resolves a single intent far more
 * reliably than a compound one.
 *
 * Lives here rather than beside the server actions because a `"use server"`
 * module may only export async functions, and the client needs it for the
 * character counter.
 */
export const MAX_NOTE_LENGTH = 280;

/** Where a note's garment references are resolved from. */
export type NoteScope = "outfit" | "closet";

export type StyleRule =
  /** These two never go together. */
  | { kind: "avoid_pair"; itemIds: [string, string] }
  /**
   * A *kind* of garment never goes with another kind — "I don't wear boots with
   * shorts". Matched by term against each item's category, subcategory and
   * name, so it covers the whole closet and every future purchase rather than
   * the handful of boots owned today. This is the only rule shape that
   * generalizes; the id-based ones are all about specific garments.
   */
  | { kind: "avoid_term_pair"; terms: [string, string] }
  | { kind: "prefer_term_pair"; terms: [string, string] }
  /** These two are good together — a gentle boost, not a requirement. */
  | { kind: "prefer_pair"; itemIds: [string, string] }
  /** Stop suggesting this item at all. */
  | { kind: "avoid_item"; itemId: string }
  /** This item only in — or never in — certain conditions. */
  | {
      kind: "avoid_item_context";
      itemId: string;
      bands?: ClimateBand[];
      occasions?: Occasion[];
    }
  | {
      kind: "prefer_item_context";
      itemId: string;
      bands?: ClimateBand[];
      occasions?: Occasion[];
    };

export type StyleRuleKind = StyleRule["kind"];

/** A rule plus where it came from, so the UI can say *why*. */
export type AttributedRule = { rule: StyleRule; noteId: string; noteText: string };

/** The fields a rule needs to test an item. */
export type RuleItem = {
  id: string;
  category?: string | null;
  subcategory?: string | null;
  name?: string | null;
};

/**
 * Does this garment answer to this word?
 *
 * Word-boundary matching over category + subcategory + name, the same widening
 * `classifyGarmentKind` uses — an item whose category is vague ("other") is
 * still findable by its name. Same collision risk too: "boot" would otherwise
 * match "bootcut jeans", which is why compound terms in the note are matched
 * whole rather than split.
 */
export function itemMatchesTerm(item: RuleItem, term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (!needle) return false;
  const haystack = `${item.category ?? ""} ${item.subcategory ?? ""} ${item.name ?? ""}`.toLowerCase();
  // Allow an optional plural but nothing else, so "short" doesn't match
  // "shortsleeve" and "boot" doesn't match "bootcut".
  return new RegExp(`\\b${escapeTerm(needle)}s?\\b`).test(haystack);
}

function escapeTerm(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type RuleContext = {
  band?: ClimateBand | null;
  occasion?: Occasion | null;
};

/**
 * Boost applied per matching `prefer_*` rule.
 *
 * Preferences are soft and avoidances are hard, deliberately. "Don't" is an
 * instruction and gets obeyed; "these look good together" is taste, and taste
 * should tilt a ranking rather than dictate it — otherwise two or three notes
 * collapse the closet onto the same outfit every day.
 */
export const PREFER_BOOST = 0.08;

function contextMatches(
  rule: Extract<StyleRule, { kind: "avoid_item_context" | "prefer_item_context" }>,
  context: RuleContext,
): boolean {
  // A rule with no conditions is unconditional. A rule with conditions the
  // caller can't evaluate (no band today, no occasion chosen) does NOT fire —
  // "too warm above 20°C" must not silently apply on a day with no forecast.
  if (rule.bands && rule.bands.length > 0) {
    if (!context.band || !rule.bands.includes(context.band)) return false;
  }
  if (rule.occasions && rule.occasions.length > 0) {
    if (!context.occasion || !rule.occasions.includes(context.occasion)) return false;
  }
  return !!(rule.bands?.length || rule.occasions?.length);
}

function pairMatches(pair: readonly [string, string], a: string, b: string): boolean {
  return (pair[0] === a && pair[1] === b) || (pair[0] === b && pair[1] === a);
}

/**
 * Is this item forbidden outright, before anything is placed?
 * Used to prune the candidate pool once per slate rather than per comparison.
 */
export function itemIsForbidden(
  item: RuleItem,
  rules: readonly AttributedRule[],
  context: RuleContext = {},
): AttributedRule | null {
  for (const entry of rules) {
    const { rule } = entry;
    if (rule.kind === "avoid_item" && rule.itemId === item.id) return entry;
    if (rule.kind === "avoid_item_context" && rule.itemId === item.id) {
      if (contextMatches(rule, context)) return entry;
    }
  }
  return null;
}

/**
 * Is adding this candidate to a partial outfit forbidden by a pair rule?
 * Returns the offending rule so the caller can explain itself.
 */
export function pairIsForbidden(
  placed: readonly RuleItem[],
  candidate: RuleItem,
  rules: readonly AttributedRule[],
): AttributedRule | null {
  for (const entry of rules) {
    const { rule } = entry;
    if (rule.kind === "avoid_pair") {
      for (const item of placed) {
        if (pairMatches(rule.itemIds, item.id, candidate.id)) return entry;
      }
    } else if (rule.kind === "avoid_term_pair") {
      const [a, b] = rule.terms;
      for (const item of placed) {
        // Either assignment of the two terms to the two garments counts —
        // "boots with shorts" and "shorts with boots" are the same rule.
        const forbidden =
          (itemMatchesTerm(item, a) && itemMatchesTerm(candidate, b)) ||
          (itemMatchesTerm(item, b) && itemMatchesTerm(candidate, a));
        if (forbidden) return entry;
      }
    }
  }
  return null;
}

/**
 * Soft score adjustment for a candidate joining a partial outfit, in score
 * units. Only `prefer_*` rules contribute — avoidance is handled by the two
 * predicates above, as exclusion rather than a penalty.
 */
export function preferenceBonus(
  placed: readonly RuleItem[],
  candidate: RuleItem,
  rules: readonly AttributedRule[],
  context: RuleContext = {},
): number {
  let bonus = 0;
  for (const { rule } of rules) {
    if (rule.kind === "prefer_pair") {
      for (const item of placed) {
        if (pairMatches(rule.itemIds, item.id, candidate.id)) bonus += PREFER_BOOST;
      }
    } else if (rule.kind === "prefer_term_pair") {
      const [a, b] = rule.terms;
      for (const item of placed) {
        const matched =
          (itemMatchesTerm(item, a) && itemMatchesTerm(candidate, b)) ||
          (itemMatchesTerm(item, b) && itemMatchesTerm(candidate, a));
        if (matched) bonus += PREFER_BOOST;
      }
    } else if (rule.kind === "prefer_item_context" && rule.itemId === candidate.id) {
      if (contextMatches(rule, context)) bonus += PREFER_BOOST;
    }
  }
  return bonus;
}

/** Reject malformed rules from the parser before they reach the scorer. */
export function isValidRule(value: unknown, knownItemIds: ReadonlySet<string>): value is StyleRule {
  if (!value || typeof value !== "object") return false;
  const rule = value as Partial<StyleRule> & { kind?: string };

  switch (rule.kind) {
    case "avoid_pair":
    case "prefer_pair": {
      const ids = (rule as { itemIds?: unknown }).itemIds;
      return (
        Array.isArray(ids) &&
        ids.length === 2 &&
        ids.every((id) => typeof id === "string" && knownItemIds.has(id)) &&
        ids[0] !== ids[1]
      );
    }
    case "avoid_term_pair":
    case "prefer_term_pair": {
      // Terms are free text, not ids, so the closet allow-list doesn't apply.
      // They do have to be real words: a one-character term would match half
      // the wardrobe.
      const terms = (rule as { terms?: unknown }).terms;
      return (
        Array.isArray(terms) &&
        terms.length === 2 &&
        terms.every((t) => typeof t === "string" && t.trim().length >= 3) &&
        terms[0].trim().toLowerCase() !== terms[1].trim().toLowerCase()
      );
    }
    case "avoid_item":
      return typeof (rule as { itemId?: unknown }).itemId === "string" &&
        knownItemIds.has((rule as { itemId: string }).itemId);
    case "avoid_item_context":
    case "prefer_item_context": {
      const itemId = (rule as { itemId?: unknown }).itemId;
      if (typeof itemId !== "string" || !knownItemIds.has(itemId)) return false;
      // A conditional rule with no conditions is either a parser slip or a
      // silently-unconditional ban. Reject it rather than guess which.
      const bands = (rule as { bands?: unknown }).bands;
      const occasions = (rule as { occasions?: unknown }).occasions;
      const hasBands = Array.isArray(bands) && bands.length > 0;
      const hasOccasions = Array.isArray(occasions) && occasions.length > 0;
      return hasBands || hasOccasions;
    }
    default:
      return false;
  }
}
