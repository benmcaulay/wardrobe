/**
 * Building the daily slate — a small set of distinct outfit proposals
 * (docs/OUTFIT_INTELLIGENCE.md §5B).
 *
 * Three proposals rather than one, because a single suggestion has to be right
 * or it is worthless, whereas three spread the risk: the user picks, and even a
 * rejection is a *choice* rather than a dead end. That is also what makes this
 * the data engine — one tap produces `chosen ≻ the other two`, which is exactly
 * the contrastive input Bradley-Terry consumes and is worth several times its
 * weight in raw wear counts.
 *
 * ── Why not reuse pickRandomOutfit ─────────────────────────────────────────
 *
 * That function backtracks to satisfy user-authored category and colour rules,
 * and its candidate ordering is a sampled permutation — there is no clean
 * probability attached to what came out. Off-policy evaluation needs
 * P(shown | policy), so the slate samples slot by slot and multiplies the
 * per-slot softmax probabilities as it goes. Recording the wrong propensity is
 * worse than recording none: it silently biases every future offline estimate.
 *
 * Pure and deterministic given an rng, so it can be unit-tested and replayed.
 */

import { classifyGarmentKind, type GarmentKind } from "@/lib/categories";
import {
  scoreAddition,
  scoreOutfit,
  type ScorableItem,
  type ScoringContext,
} from "@/lib/outfit/compatibility";
import { DEFAULT_TEMPERATURE } from "@/lib/outfit/sampling";
import { thompsonDraw, type AffinityPosterior } from "@/lib/outfit/posterior";
import {
  itemIsForbidden,
  pairIsForbidden,
  preferenceBonus,
  type AttributedRule,
  type RuleContext,
} from "@/lib/outfit/style-rules";

/**
 * Identifies the ranker that produced a slate. Bump on any change that alters
 * what gets proposed — logged rows from different policies are not comparable,
 * and an unbumped id makes two different rankers look like one noisy one.
 *
 * Lives here rather than beside the server actions because a `"use server"`
 * module may only export async functions.
 */
export const SLATE_POLICY_ID = "slate-thompson-v2";

export type SlateCandidate = ScorableItem;

export type SlateSlot = {
  kind: GarmentKind;
  /** Skipped without failing the proposal when nothing suitable is left. */
  optional?: boolean;
};

/**
 * What each slot in the slate is *for*.
 *
 *   safe        — highest posterior mean. The one they'll probably take.
 *   alternative — also strong, but differs from `safe` in at least two pieces.
 *   explore     — built from a Thompson draw, so items we know little about get
 *                 a fair chance of looking best. This is the utilization engine.
 */
export type SlateStrategy = "safe" | "alternative" | "explore";

export type Proposal = {
  strategy: SlateStrategy;
  itemIds: string[];
  /** Layer 1 score of the finished look, 0..1. */
  score: number;
  /**
   * P(this exact set | policy). The product of the per-slot softmax
   * probabilities that produced it. Logged so a future ranker can be scored
   * against this one on historical data instead of needing a live A/B test.
   *
   * For the `explore` slot this is conditional on the Thompson draw, not the
   * marginal over draws — computing the marginal would mean integrating over
   * the posterior of every candidate. Segment by `strategy` before using these
   * in an off-policy estimate; mixing them silently biases the result.
   */
  propensity: number;
};

/**
 * The default shape of a day's outfit.
 *
 * Deliberately not the builder's `CategoryRule` system: those are the user's
 * saved rules for the spin tool, and a morning proposal shouldn't silently
 * inherit whatever they last experimented with there. Outerwear is added by
 * `slotsForBand` only when the weather asks for it.
 */
export const BASE_SLOTS: SlateSlot[] = [
  { kind: "top" },
  { kind: "bottom" },
  { kind: "shoes" },
];

export function slotsForBand(band: string | null | undefined): SlateSlot[] {
  if (band === "cool" || band === "cold") {
    return [...BASE_SLOTS, { kind: "outerwear", optional: true }];
  }
  return BASE_SLOTS;
}

/**
 * Slots that can actually seat every pinned item.
 *
 * Pin a hat and the base top/bottom/shoes shape has nowhere to put it, so the
 * proposal would be discarded for missing its own pin. This adds a slot for any
 * kind the base shape doesn't already cover — optional, so an unpinnable extra
 * never fails a proposal on its own.
 */
export function slotsForPinned(
  items: readonly SlateCandidate[],
  pinnedIds: readonly string[],
  base: readonly SlateSlot[],
): SlateSlot[] {
  if (pinnedIds.length === 0) return [...base];
  const pinned = new Set(pinnedIds);
  const covered = new Set(base.map((slot) => slot.kind));
  const extra: SlateSlot[] = [];
  for (const item of items) {
    if (!pinned.has(item.id)) continue;
    const kind = classifyGarmentKind(item);
    if (covered.has(kind)) continue;
    covered.add(kind);
    extra.push({ kind, optional: true });
  }
  return [...base, ...extra];
}

/** How many items two proposals must differ by to count as genuinely distinct. */
export const MIN_DISTINCT_ITEMS = 2;

/** Attempts per proposal before accepting a less distinct one. */
const MAX_ATTEMPTS = 12;

function softmax(scores: number[], temperature: number): number[] {
  const max = Math.max(...scores);
  const exps = scores.map((s) => Math.exp((s - max) / Math.max(temperature, 1e-3)));
  const total = exps.reduce((sum, e) => sum + e, 0);
  // Degenerate weights fall back to uniform rather than producing NaNs that
  // would propagate into a logged propensity and quietly corrupt offline eval.
  if (!Number.isFinite(total) || total <= 0) return scores.map(() => 1 / scores.length);
  return exps.map((e) => e / total);
}

function sampleIndex(probabilities: number[], rng: () => number): number {
  let target = rng();
  for (let i = 0; i < probabilities.length; i += 1) {
    target -= probabilities[i];
    if (target <= 0) return i;
  }
  return probabilities.length - 1;
}

export type SlateOptions = {
  context?: ScoringContext;
  temperature?: number;
  rng?: () => number;
  count?: number;
  /** Item ids the user has already rejected today — never propose them again. */
  exclude?: ReadonlySet<string>;
  /**
   * Affinity with uncertainty. Present → the third slot becomes a Thompson
   * draw instead of another sample from the mean. Absent → all three slots are
   * sampled the same way, which is the pre-Phase-4 behaviour and still correct,
   * just without the exploration arm.
   */
  posterior?: AffinityPosterior;
  /**
   * The user's own notes, as rules (§9). Avoidances are applied as hard
   * exclusions rather than penalties — the user said "don't", and a scorer
   * that merely down-weights a "don't" will eventually surface it anyway and
   * read as not listening.
   */
  rules?: readonly AttributedRule[];
  ruleContext?: RuleContext;
  /**
   * Force every arm to one strategy. Training rounds (§10) use `explore` for
   * all three, because the goal there is an *informative* comparison rather
   * than a good outfit — Thompson sampling naturally over-picks the garments
   * we know least about, which is exactly what a preference model wants next.
   */
  uniformStrategy?: SlateStrategy;
  /**
   * Item ids that must appear in every proposal — "train me on this jacket".
   * A proposal that can't seat one is discarded rather than returned without it.
   * The caller is responsible for offering a slot of each pinned item's kind;
   * `slotsForPinned` derives that.
   */
  pinned?: readonly string[];
};

/** Near-greedy: stable enough to feel like a considered pick, not frozen. */
export const SAFE_TEMPERATURE = 0.05;

function buildOne(
  byKind: Map<GarmentKind, SlateCandidate[]>,
  slots: readonly SlateSlot[],
  context: ScoringContext,
  temperature: number,
  rng: () => number,
  strategy: SlateStrategy,
  rules: readonly AttributedRule[] = [],
  ruleContext: RuleContext = {},
  pinned: ReadonlySet<string> = new Set(),
): Proposal | null {
  const placed: SlateCandidate[] = [];
  const used = new Set<string>();
  let propensity = 1;

  for (const slot of slots) {
    const candidates = (byKind.get(slot.kind) ?? []).filter(
      (item) => !used.has(item.id) && !pairIsForbidden(placed, item, rules),
    );
    if (candidates.length === 0) {
      if (slot.optional) continue;
      return null;
    }

    // A pinned piece takes its slot outright. Propensity is left alone rather
    // than multiplied by 1/n: the user fixed this choice, so the policy didn't
    // make it, and charging it to the policy would bias any off-policy estimate
    // built from these logs.
    const pin = candidates.find((item) => pinned.has(item.id));
    if (pin) {
      placed.push(pin);
      used.add(pin.id);
      continue;
    }

    const scores = candidates.map(
      (item) =>
        scoreAddition(placed, item, context) +
        preferenceBonus(placed, item, rules, ruleContext),
    );
    const probabilities = softmax(scores, temperature);
    const index = sampleIndex(probabilities, rng);

    placed.push(candidates[index]);
    used.add(candidates[index].id);
    propensity *= probabilities[index];
  }

  if (placed.length === 0) return null;

  // Every pinned piece has to be on the frame. If a slot of its kind was taken
  // or absent it isn't, and a "specialised" round that quietly dropped the
  // piece you were training on would be worse than refusing to build one.
  for (const id of pinned) {
    if (!used.has(id)) return null;
  }

  // Score the finished look, not the running marginals: those were computed
  // against partial outfits and would understate one whose pieces only cohere
  // once the last is in place. This is what the user is actually being offered.
  const finalScore = scoreOutfit(placed, context).score;

  return { strategy, itemIds: placed.map((item) => item.id), score: finalScore, propensity };
}

/**
 * Distinctness is measured over the pieces the policy actually chose.
 *
 * Pinned items are in every proposal by construction, so counting them would
 * make a round of five outfits around one fixed jacket look like five copies of
 * each other and collapse the round to a single proposal.
 *
 * The bar also scales down for short outfits. "Differ by two" is right for a
 * three-piece look, but on a focused two-piece round — jacket and shoes, say —
 * it would demand a distinct jacket *and* a distinct pair of shoes for every
 * proposal, so a closet with three jackets could never fill a round of eight.
 * One free piece changing is enough to make two short outfits worth comparing.
 */
function distinctEnough(
  candidate: Proposal,
  existing: readonly Proposal[],
  pinned: ReadonlySet<string> = new Set(),
): boolean {
  const free = candidate.itemIds.filter((id) => !pinned.has(id));
  // Everything was pinned: there is exactly one such outfit, so only the first
  // proposal can be accepted.
  if (free.length === 0) return existing.length === 0;
  const bar = Math.min(MIN_DISTINCT_ITEMS, Math.max(1, free.length - 1));
  return existing.every((other) => {
    const overlap = free.filter((id) => other.itemIds.includes(id)).length;
    return free.length - overlap >= bar;
  });
}

/**
 * Build the slate: a safe pick, a genuine alternative, and one exploratory bet.
 *
 * The three-way split is the whole safety story. A single suggestion has to be
 * right or it is worthless, so risk is budgeted at the *slate* rather than the
 * item: two slots play it straight, and exactly one takes a chance. That is
 * also what lets exploration be meaningful — it has a dedicated place, so it
 * never has to compromise the recommendation the user is most likely to take.
 *
 * Returns fewer rather than padding with near-duplicates. Three variations of
 * the same outfit is a worse offer *and* teaches the preference model nothing,
 * since "picked A over two clones of A" carries no signal.
 */
export function buildSlate(
  items: readonly SlateCandidate[],
  slots: readonly SlateSlot[],
  options: SlateOptions = {},
): Proposal[] {
  const rng = options.rng ?? Math.random;
  const context = options.context ?? {};
  const count = Math.max(1, options.count ?? 3);
  const exclude = options.exclude ?? new Set<string>();

  const rules = options.rules ?? [];
  const ruleContext = options.ruleContext ?? {};

  const byKind = new Map<GarmentKind, SlateCandidate[]>();
  const ids: string[] = [];
  for (const item of items) {
    if (exclude.has(item.id)) continue;
    // Outright bans are pruned once here rather than re-checked per slot.
    if (itemIsForbidden(item, rules, ruleContext)) continue;
    ids.push(item.id);
    const kind = classifyGarmentKind(item);
    const bucket = byKind.get(kind);
    if (bucket) bucket.push(item);
    else byKind.set(kind, [item]);
  }

  // One draw per slate, not per candidate: an item that came up optimistic
  // stays optimistic while the outfit is built around it, so the result is a
  // coherent bet on that piece rather than noise scattered across the slots.
  const exploreContext: ScoringContext = options.posterior
    ? { ...context, affinity: thompsonDraw(options.posterior, ids, rng) }
    : context;

  const uniform = options.uniformStrategy;
  const exploreStep = {
    strategy: "explore" as SlateStrategy,
    context: exploreContext,
    temperature: options.temperature ?? DEFAULT_TEMPERATURE,
  };
  // Exactly `count` arms. Training rounds ask for up to eight of them; the
  // daily slate asks for three and gets the safe/alternative/explore split.
  // Anything past the third is another explore arm — beyond a safe pick and one
  // genuine alternative there is nothing left for a fourth "safe" to say, and
  // the extra breadth is worth more as exploration.
  const plan: { strategy: SlateStrategy; context: ScoringContext; temperature: number }[] = uniform
    ? Array.from({ length: count }, () => ({
        strategy: uniform,
        context: uniform === "explore" ? exploreContext : context,
        temperature: options.temperature ?? DEFAULT_TEMPERATURE,
      }))
    : [
        { strategy: "safe" as SlateStrategy, context, temperature: options.temperature ?? SAFE_TEMPERATURE },
        { strategy: "alternative" as SlateStrategy, context, temperature: options.temperature ?? SAFE_TEMPERATURE },
        ...Array.from({ length: Math.max(0, count - 2) }, () => exploreStep),
      ].slice(0, count);

  const pinned = new Set(options.pinned ?? []);

  const out: Proposal[] = [];
  for (let i = 0; i < plan.length; i += 1) {
    const step = plan[i];
    let accepted: Proposal | null = null;
    let fallback: Proposal | null = null;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const candidate = buildOne(
        byKind,
        slots,
        step.context,
        step.temperature,
        rng,
        step.strategy,
        rules,
        ruleContext,
        pinned,
      );
      if (!candidate) break;
      if (!fallback) fallback = candidate;
      if (distinctEnough(candidate, out, pinned)) {
        accepted = candidate;
        break;
      }
    }

    // Only fall back to a near-duplicate for the very first proposal, where
    // having something to show beats having nothing.
    const chosen = accepted ?? (out.length === 0 ? fallback : null);
    if (!chosen) continue;
    out.push(chosen);
  }

  return out;
}
