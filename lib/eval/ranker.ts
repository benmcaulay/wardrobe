/**
 * Offline ranker evaluation (docs/OUTFIT_INTELLIGENCE.md §8).
 *
 * Six phases of scoring shipped without ever being measured against a baseline.
 * This module is the instrument: it replays the logged choice history and asks
 * whether the ranker would have predicted what the user actually did.
 *
 * ── Why not the FITB design in §8 ───────────────────────────────────────────
 *
 * §8 specifies hold-one-out fill-in-the-blank over the user's *saved outfits*.
 * There are zero `Outfit` rows: `acceptProposal` writes a WearEvent and a
 * PreferenceEvent, and only virtual try-on ever creates an Outfit. So that
 * recipe has no data and cannot be run.
 *
 * The choice log is a better substrate anyway. A `train_pick` is already the
 * task FITB approximates — one set preferred over others, under identical
 * context, with the alternatives recorded — and it needs no synthetic
 * distractors, because the user saw the real ones.
 *
 * ── Two row shapes, and why the older one is weaker ─────────────────────────
 *
 * Rows written since per-arm logging landed carry `armsJson`: every outfit shown,
 * so `rivalsFor` reads the real alternatives and both metrics are exact.
 *
 * Older rows only have `rejectedIds`, a deduplicated union of the passed-over
 * outfits' items, so which piece belonged to which rival is unrecoverable.
 * `reconstructRivals` enumerates every same-shape outfit drawable from that pool,
 * a *superset* of what was shown. On those rows:
 *
 *   - Pairwise accuracy is over reconstructed pairs, not shown pairs. It is
 *     unbiased for the question "does the scorer rank the chosen set above
 *     outfits built from what was rejected", which is the question that matters.
 *   - Top-1 is a *lower bound*: beating every reconstructed rival implies beating
 *     the real ones, but not conversely.
 *
 * The report says how many cases fall in each group, because a number that mixes
 * them is only as precise as its weaker half.
 *
 * Pure and deterministic — no DB, no clock, no network. scripts/eval-ranker.ts
 * supplies the data.
 */

import { classifyGarmentKind, type GarmentKind } from "@/lib/categories";
import { UNKNOWN_PAIR_SCORE } from "@/lib/outfit/color-harmony";
import {
  scoreOutfit,
  TERM_WEIGHTS,
  type CompatibilityBreakdown,
  type ScorableItem,
  type ScoringContext,
} from "@/lib/outfit/compatibility";
import { buildAffinityMap } from "@/lib/outfit/affinity";
import {
  fitBradleyTerry,
  NEUTRAL_ANCHOR,
  type Comparison,
} from "@/lib/outfit/bradley-terry";
import { comparisonsFrom, type PreferenceKind } from "@/lib/wear/signals";

export type TermWeights = Record<keyof typeof TERM_WEIGHTS, number>;

/** One logged decision, flattened into the shape the metrics consume. */
export type EvalCase = {
  /** PreferenceEvent id, so a surprising result can be traced to a row. */
  id: string;
  kind: PreferenceKind;
  /**
   * Rows from different policies are not comparable — §5B's own warning. The
   * caller segments on this; the metrics never mix silently.
   */
  policyId: string | null;
  /** Context the proposal was made under, replayed into the scorer. */
  band: string | null;
  chosen: string[];
  /** Union of items from the outfits passed over; see the module header. */
  rejectedPool: string[];
  /**
   * The outfits actually shown, when the row recorded them. Present → rivals are
   * read rather than reconstructed, which makes top-1 exact instead of a lower
   * bound. Null on rows written before per-arm logging.
   */
  arms?: string[][] | null;
  chosenArm?: number | null;
  propensity: number | null;
};

/**
 * Enumeration cap per case.
 *
 * A three-piece outfit against a six-item pool yields at most eight rivals, so
 * this is slack rather than a real limit — but an eight-arm training round with
 * a wide pool could combinatorially explode, and a metric that silently
 * evaluated a truncated rival set would overstate accuracy. Truncation is
 * reported (`capped`), never absorbed.
 */
export const MAX_RIVALS = 64;

export type RivalSet = {
  rivals: string[][];
  /** True when enumeration hit MAX_RIVALS and the set is incomplete. */
  capped: boolean;
  /** True when the rivals were read from the log rather than reconstructed. */
  logged: boolean;
};

/**
 * The outfits this case was actually judged against.
 *
 * Prefers the logged arms. Reconstruction exists only because the pooled rows
 * cannot support anything better, and it costs real precision: the enumerated set
 * is a *superset* of what was shown, so top-1 measured against it is a lower
 * bound. Read arms and both problems go away — the comparison is the one the
 * user made.
 */
export function rivalsFor(
  evalCase: EvalCase,
  byId: ReadonlyMap<string, ScorableItem>,
): RivalSet {
  const arms = evalCase.arms;
  const chosen = evalCase.chosenArm;
  if (arms && arms.length > 1 && chosen != null && chosen >= 0 && chosen < arms.length) {
    const rivals = arms
      .filter((_, index) => index !== chosen)
      .map((arm) => arm.filter((id) => byId.has(id)))
      .filter((arm) => arm.length > 0);
    if (rivals.length > 0) return { rivals, capped: false, logged: true };
  }
  return reconstructRivals(evalCase.chosen, evalCase.rejectedPool, byId);
}

/**
 * Every same-shape outfit drawable from the rejected pool.
 *
 * Shape is the multiset of GarmentKinds in the chosen outfit — matching it is
 * what keeps the comparison fair. Scoring a three-piece look against a
 * two-piece one measures outfit length, since `formalityCoherence` and
 * `outfitColorHarmony` both average over pairs and a shorter look has fewer
 * chances to clash.
 *
 * Items already in the chosen set are excluded: a "rival" sharing every piece
 * with the chosen outfit is the same outfit, and scoring it produces a tie that
 * dilutes the metric toward 0.5.
 */
export function reconstructRivals(
  chosen: readonly string[],
  rejectedPool: readonly string[],
  byId: ReadonlyMap<string, ScorableItem>,
): RivalSet {
  const chosenSet = new Set(chosen);
  const shape: GarmentKind[] = [];
  for (const id of chosen) {
    const item = byId.get(id);
    if (item) shape.push(classifyGarmentKind(item));
  }
  if (shape.length === 0) return { rivals: [], capped: false, logged: false };

  const poolByKind = new Map<GarmentKind, string[]>();
  for (const id of rejectedPool) {
    if (chosenSet.has(id)) continue;
    const item = byId.get(id);
    if (!item) continue;
    const kind = classifyGarmentKind(item);
    const bucket = poolByKind.get(kind);
    if (bucket) bucket.push(id);
    else poolByKind.set(kind, [id]);
  }

  // Cartesian product over the slots, drawing without replacement so one item
  // can't fill two slots of the same kind.
  let partials: string[][] = [[]];
  let capped = false;
  for (const kind of shape) {
    const options = poolByKind.get(kind) ?? [];
    if (options.length === 0) return { rivals: [], capped: false, logged: false };
    const next: string[][] = [];
    for (const partial of partials) {
      for (const option of options) {
        if (partial.includes(option)) continue;
        if (next.length >= MAX_RIVALS) {
          capped = true;
          break;
        }
        next.push([...partial, option]);
      }
      if (capped) break;
    }
    if (next.length === 0) return { rivals: [], capped, logged: false };
    partials = next;
  }

  return {
    rivals: partials.filter((rival) => rival.length === shape.length),
    capped,
    logged: false,
  };
}

/**
 * Re-blend a scored breakdown under different term weights.
 *
 * Ablation without re-scoring: `scoreOutfit` already returns every term it
 * computed, so zeroing a weight here is arithmetically identical to having
 * scored with that weight in the first place. Duplicating the blend is the risk
 * — it is pinned by a test asserting `reblend(b, TERM_WEIGHTS) === b.score`, so
 * a change to compatibility.ts's blend that this doesn't mirror fails loudly
 * rather than producing quietly wrong ablations.
 */
export function reblend(breakdown: CompatibilityBreakdown, weights: TermWeights): number {
  const terms: { weight: number; value: number | null }[] = [
    { weight: weights.color, value: breakdown.color },
    { weight: weights.formality, value: breakdown.formality },
    { weight: weights.climate, value: breakdown.climate },
    { weight: weights.bilinear, value: breakdown.bilinear },
    { weight: weights.affinity, value: breakdown.affinity },
  ];

  let weighted = 0;
  let total = 0;
  for (const term of terms) {
    if (term.value == null || term.weight <= 0) continue;
    weighted += term.weight * term.value;
    total += term.weight;
  }
  const base = total === 0 ? UNKNOWN_PAIR_SCORE : weighted / total;
  return Math.min(1, Math.max(0, base * breakdown.patternPenalty));
}

export const FULL_WEIGHTS: TermWeights = { ...TERM_WEIGHTS };

function only(term: keyof TermWeights): TermWeights {
  const out = { color: 0, formality: 0, climate: 0, bilinear: 0, affinity: 0 };
  out[term] = TERM_WEIGHTS[term];
  return out;
}

function without(term: keyof TermWeights): TermWeights {
  return { ...FULL_WEIGHTS, [term]: 0 };
}

/**
 * The ablation set.
 *
 * `layer 1 only` vs `full` is the load-bearing comparison — it is the only thing
 * that answers whether Layer 2 personalization earns the 0.35 weight it takes.
 * Read it against the leave-one-out affinity map, never the in-sample one.
 */
export const ABLATIONS: { label: string; weights: TermWeights }[] = [
  { label: "full (as shipped)", weights: FULL_WEIGHTS },
  { label: "layer 1 only (no affinity)", weights: without("affinity") },
  { label: "affinity only (layer 2)", weights: only("affinity") },
  { label: "colour only", weights: only("color") },
  { label: "formality only", weights: only("formality") },
  { label: "climate only", weights: only("climate") },
  { label: "no colour", weights: without("color") },
  { label: "no formality", weights: without("formality") },
];

export type Accuracy = {
  /** Fraction of (chosen, rival) pairs ranked correctly. Ties score 0.5. */
  pairwise: number;
  /**
   * Standard error of `pairwise`, clustered by case.
   *
   * Not sqrt(p(1−p)/pairs) — that would assume 468 independent observations
   * when there are only ~51. All the pairs in one case share a single chosen
   * outfit, so they rise and fall together, and the naive pair-count SE
   * understates the real uncertainty by roughly 3×. That difference decides
   * whether a 7-point gap between two ablations is a finding or noise, which is
   * the entire question this harness exists to answer.
   */
  pairwiseStderr: number;
  /** Fraction of cases where the chosen set beat every rival. A lower bound. */
  top1: number;
  cases: number;
  pairs: number;
  /** Cases with no reconstructable rival — not counted in either metric. */
  skipped: number;
  capped: number;
};

/** Scores one outfit under a weight set, or null if no item resolves. */
type Scorer = (itemIds: readonly string[]) => number | null;

export function makeScorer(
  byId: ReadonlyMap<string, ScorableItem>,
  context: ScoringContext,
  weights: TermWeights,
): Scorer {
  return (itemIds) => {
    const items = itemIds
      .map((id) => byId.get(id))
      .filter((item): item is ScorableItem => !!item);
    if (items.length === 0) return null;
    return reblend(scoreOutfit(items, context), weights);
  };
}

/**
 * A control that ignores the outfit entirely.
 *
 * §8 asks for "baseline is current uniform random". One draw per outfit, so the
 * chosen set and each rival are scored independently — see `randomControl` for
 * why a single replicate of this is not a usable baseline.
 */
export function randomScorer(rng: () => number): Scorer {
  return () => rng();
}

/**
 * The evaluation core: score each case's chosen set against its rivals.
 *
 * Takes a scorer *per case* rather than one scorer, because leave-one-out needs
 * a different affinity map for every case. The single-scorer path wraps this.
 * One implementation, so the LOO numbers and the in-sample numbers cannot drift
 * apart in how they count ties, skips, or top-1.
 */
export function accuracyForPerCase(
  cases: readonly EvalCase[],
  byId: ReadonlyMap<string, ScorableItem>,
  scorerFor: (evalCase: EvalCase, index: number) => Scorer,
): Accuracy {
  let correctPairs = 0;
  let pairs = 0;
  let top1 = 0;
  let skipped = 0;
  let capped = 0;
  // Per-case pairwise proportions, for the clustered standard error.
  const perCase: number[] = [];

  for (let i = 0; i < cases.length; i += 1) {
    const evalCase = cases[i];
    const { rivals, capped: wasCapped } = rivalsFor(evalCase, byId);
    if (wasCapped) capped += 1;
    if (rivals.length === 0) {
      skipped += 1;
      continue;
    }
    const scorer = scorerFor(evalCase, i);
    const chosenScore = scorer(evalCase.chosen);
    if (chosenScore == null) {
      skipped += 1;
      continue;
    }

    let beatsAll = true;
    let caseCorrect = 0;
    let caseRivals = 0;
    for (const rival of rivals) {
      const rivalScore = scorer(rival);
      if (rivalScore == null) continue;
      caseRivals += 1;
      if (chosenScore > rivalScore) caseCorrect += 1;
      else if (chosenScore === rivalScore) {
        caseCorrect += 0.5;
        beatsAll = false;
      } else beatsAll = false;
    }
    if (caseRivals === 0) {
      skipped += 1;
      continue;
    }

    correctPairs += caseCorrect;
    pairs += caseRivals;
    perCase.push(caseCorrect / caseRivals);
    if (beatsAll) top1 += 1;
  }

  return {
    pairwise: pairs === 0 ? 0 : correctPairs / pairs,
    pairwiseStderr: clusteredStderr(perCase),
    top1: perCase.length === 0 ? 0 : top1 / perCase.length,
    cases: perCase.length,
    pairs,
    skipped,
    capped,
  };
}

/**
 * Standard error of the mean over per-case proportions.
 *
 * The cluster is the case, not the pair: within one case every comparison shares
 * the same chosen outfit, so they are not independent draws.
 */
export function clusteredStderr(perCase: readonly number[]): number {
  if (perCase.length < 2) return 0;
  const mean = perCase.reduce((sum, value) => sum + value, 0) / perCase.length;
  const variance =
    perCase.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (perCase.length - 1);
  return Math.sqrt(variance / perCase.length);
}

export function accuracyFor(
  cases: readonly EvalCase[],
  byId: ReadonlyMap<string, ScorableItem>,
  scorer: Scorer,
): Accuracy {
  return accuracyForPerCase(cases, byId, () => scorer);
}

export type ControlResult = {
  /** Mean pairwise accuracy across replicates. Should sit on 0.5. */
  mean: number;
  /** Spread across replicates — the noise floor for every other row. */
  stdev: number;
  replicates: number;
};

/**
 * The chance baseline, averaged over many random rankers.
 *
 * A single replicate is a terrible baseline and it took a wrong-looking 40.4% to
 * notice why: with ~50 cases the per-replicate spread is around 4 points, so one
 * draw lands anywhere in the mid-40s to mid-50s and invites a hunt for a leak
 * that isn't there. Averaging over replicates estimates the chance level to well
 * under a point, which is what makes it usable as a check that the case
 * construction isn't leaking the answer.
 *
 * The `stdev` it reports is independently useful: it is the noise floor for the
 * whole report, measured rather than assumed.
 */
export function randomControl(
  cases: readonly EvalCase[],
  byId: ReadonlyMap<string, ScorableItem>,
  seedFor: (replicate: number) => () => number,
  replicates = 200,
): ControlResult {
  const runs: number[] = [];
  for (let r = 0; r < replicates; r += 1) {
    runs.push(accuracyFor(cases, byId, randomScorer(seedFor(r))).pairwise);
  }
  if (runs.length === 0) return { mean: 0, stdev: 0, replicates: 0 };
  const mean = runs.reduce((sum, value) => sum + value, 0) / runs.length;
  const variance =
    runs.length < 2
      ? 0
      : runs.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (runs.length - 1);
  return { mean, stdev: Math.sqrt(variance), replicates: runs.length };
}

/**
 * The comparisons one logged case contributes to a Bradley-Terry fit.
 *
 * Delegates to `comparisonsFrom`, the same function `buildAffinity` uses, rather
 * than reimplementing the weights and the polarity rule. A leave-one-out number
 * is only meaningful if the folds fit the model the product actually uses, and
 * two copies of that logic would eventually disagree.
 *
 * Plural because a pick over n arms is n−1 comparisons once the arms are logged.
 */
export function comparisonsFor(evalCase: EvalCase): Comparison[] {
  return comparisonsFrom({
    kind: evalCase.kind,
    itemIds: evalCase.chosen,
    rejectedIds: evalCase.rejectedPool,
    arms: evalCase.arms,
    chosenArm: evalCase.chosenArm,
  }).map(({ winners, losers, weight }) => ({ winners, losers, weight }));
}

/**
 * Affinity map from a set of cases, built the way buildAffinity builds it.
 *
 * `features` present → the contextual model; absent → the identity model. Both
 * are kept reachable because the only way to know whether the contextual term
 * earns its place is to score the same held-out cases under each.
 */
export function affinityFromCases(
  cases: readonly EvalCase[],
  features?: ReadonlyMap<string, Float64Array>,
): Map<string, number> {
  const comparisons = cases.flatMap(comparisonsFor);
  if (comparisons.length === 0) return new Map();
  const fit = fitBradleyTerry(comparisons, { anchorId: NEUTRAL_ANCHOR, features });
  const affinity = buildAffinityMap({ fit });
  affinity.delete(NEUTRAL_ANCHOR);
  return affinity;
}

/**
 * One affinity map per case, each fit without that case — the folds Layer 2 has
 * to be judged on.
 *
 * `buildAffinity` fits on the whole log, so scoring a logged choice with the
 * production affinity map asks the model about a comparison it was trained on.
 * With ~50 comparisons over ~76 items that is heavily contaminated: an item that
 * appears in one winning outfit gets pushed up by that outfit, then credited for
 * predicting it. In-sample affinity numbers here ran 30 points above their
 * leave-one-out counterparts — which is the difference between "personalization
 * works" and "personalization memorizes".
 *
 * Computed once and shared across every ablation: the folds depend on the
 * *cases*, not on the term weights, so refitting per ablation would be the same
 * arithmetic eight times over.
 *
 * Expensive by construction — one Bradley-Terry fit per case, 300 gradient steps
 * each — but a few dozen cases over a few hundred parameters is milliseconds.
 */
export function looAffinityMaps(
  cases: readonly EvalCase[],
  features?: ReadonlyMap<string, Float64Array>,
): Map<string, number>[] {
  return cases.map((_, index) =>
    affinityFromCases(
      cases.filter((__, other) => other !== index),
      features,
    ),
  );
}

/**
 * Accuracy under leave-one-out affinity.
 *
 * `contextFor` supplies the per-case scoring context — the climate band the
 * proposal was actually made under, since a training round carries none and a
 * daily proposal does.
 */
export function looAccuracy(
  cases: readonly EvalCase[],
  byId: ReadonlyMap<string, ScorableItem>,
  contextFor: (evalCase: EvalCase) => ScoringContext,
  weights: TermWeights,
  affinityMaps: readonly Map<string, number>[] = looAffinityMaps(cases),
): Accuracy {
  return accuracyForPerCase(cases, byId, (evalCase, index) =>
    makeScorer(
      byId,
      { ...contextFor(evalCase), affinity: affinityMaps[index] ?? new Map() },
      weights,
    ),
  );
}

/**
 * Liked/passed judgements from training's rate mode.
 *
 * Unary, so they carry no rival and can't join the pairwise metric — but they
 * are a second, independent read on the same question: does the scorer put
 * outfits the user liked above ones they passed on? Cheap to compute and it
 * uses the 27 rows the contrastive metric can only partly consume.
 */
export type RatedOutfit = { itemIds: string[]; liked: boolean };

export type AucResult = {
  /**
   * Mann-Whitney AUC. 0.5 is chance; null when either class is too small to
   * support a number.
   */
  auc: number | null;
  liked: number;
  passed: number;
  /** Set when `auc` is null, so a caller can say why rather than print "n/a". */
  reason: string | null;
};

/**
 * Smallest class size worth reporting an AUC for.
 *
 * One like against one pass yields exactly 1.000 or 0.000 — a coin flip dressed
 * as a result, and the sort of number that gets quoted later without its sample
 * size attached. Same discipline as MIN_SNIPS_SAMPLE: refuse rather than mislead.
 */
export const MIN_AUC_CLASS = 5;

export function rateAuc(rated: readonly RatedOutfit[], scorer: Scorer): AucResult {
  const likedScores: number[] = [];
  const passedScores: number[] = [];
  for (const row of rated) {
    const score = scorer(row.itemIds);
    if (score == null) continue;
    if (row.liked) likedScores.push(score);
    else passedScores.push(score);
  }
  if (likedScores.length < MIN_AUC_CLASS || passedScores.length < MIN_AUC_CLASS) {
    return {
      auc: null,
      liked: likedScores.length,
      passed: passedScores.length,
      reason: `needs ${MIN_AUC_CLASS} of each, has ${likedScores.length} liked / ${passedScores.length} passed`,
    };
  }

  let wins = 0;
  for (const liked of likedScores) {
    for (const passed of passedScores) {
      if (liked > passed) wins += 1;
      else if (liked === passed) wins += 0.5;
    }
  }
  return {
    auc: wins / (likedScores.length * passedScores.length),
    liked: likedScores.length,
    passed: passedScores.length,
    reason: null,
  };
}

/**
 * Minimum logged rows before a self-normalized estimate means anything.
 *
 * SNIPS variance scales with the spread of the importance weights, and the
 * slate's propensities are products of per-slot softmaxes — routinely 1e-3 or
 * smaller. A handful of rows produces an estimate dominated by whichever one
 * had the smallest propensity. Refusing to print a number is the correct
 * behaviour; printing one with n=2 would be worse than printing nothing.
 */
export const MIN_SNIPS_SAMPLE = 30;

export type SnipsInput = {
  /** Observed outcome for the logged action — 1 for accepted, 0 for rejected. */
  reward: number;
  /** P(logged action | logging policy), from PreferenceEvent.propensity. */
  logged: number;
  /** P(logged action | policy under test). */
  target: number;
};

export type SnipsResult = {
  estimate: number | null;
  /** Kish effective sample size of the importance weights. */
  effectiveSample: number;
  usable: number;
  dropped: number;
  reason: string | null;
};

/**
 * Self-normalized inverse propensity scoring.
 *
 *     V̂ = Σ wᵢ rᵢ / Σ wᵢ,   wᵢ = target(aᵢ) / logged(aᵢ)
 *
 * Self-normalized rather than plain IPS because plain IPS is unbiased but has
 * unbounded variance when a logged propensity is near zero, which is the normal
 * case here. SNIPS trades a small bias for variance that stays finite.
 */
export function snips(rows: readonly SnipsInput[]): SnipsResult {
  const usable = rows.filter(
    (row) => Number.isFinite(row.logged) && row.logged > 0 && Number.isFinite(row.target),
  );
  const dropped = rows.length - usable.length;

  if (usable.length === 0) {
    return { estimate: null, effectiveSample: 0, usable: 0, dropped, reason: "no usable rows" };
  }

  let weightSum = 0;
  let weightedReward = 0;
  let weightSquares = 0;
  for (const row of usable) {
    const weight = row.target / row.logged;
    weightSum += weight;
    weightSquares += weight * weight;
    weightedReward += weight * row.reward;
  }
  const effectiveSample = weightSquares === 0 ? 0 : (weightSum * weightSum) / weightSquares;

  if (usable.length < MIN_SNIPS_SAMPLE) {
    return {
      estimate: null,
      effectiveSample,
      usable: usable.length,
      dropped,
      reason: `needs ${MIN_SNIPS_SAMPLE} rows carrying a propensity, has ${usable.length}`,
    };
  }

  return {
    estimate: weightSum === 0 ? null : weightedReward / weightSum,
    effectiveSample,
    usable: usable.length,
    dropped,
    reason: null,
  };
}

/**
 * The §8 guardrail: rising protect-rate means the dormancy model is overreaching.
 *
 * A rate, not a count, so it is comparable as a closet grows. There is no
 * absolute threshold to check against yet — the first measurement is the
 * baseline, and what matters is the trend after the dormancy lens has been live
 * long enough for anyone to react to it.
 */
export function protectRate(protectedItems: number, totalItems: number): number | null {
  if (totalItems <= 0) return null;
  return protectedItems / totalItems;
}
