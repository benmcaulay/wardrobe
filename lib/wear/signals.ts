/**
 * The signal taxonomy behind outfit recommendation (docs/OUTFIT_INTELLIGENCE.md §1).
 *
 * Two kinds of evidence live in this system and they must not be conflated:
 *
 *   affinity      — how much the user likes an *item*. Item-level scalar.
 *   compatibility — how well items work *together*. Pair- and set-level.
 *
 * A saved outfit is overwhelmingly compatibility evidence: it says "these go
 * together", not "I love each of these five things". Counting a save as five
 * affinity votes is the standard route to a recommender that only ever suggests
 * your five favourite garments. A locked slot is the mirror image — the user
 * reached for that specific piece, which is affinity, and says little about
 * whatever the builder filled in around it.
 *
 * So every signal declares how much it trains each model, and callers read the
 * weights from here rather than deciding at the call site.
 */

/** How a WearEvent came to exist. Mirrors WearEvent.source. */
export type WearSource = "explicit" | "photo" | "packing" | "backfill";

/** A user choice about a suggestion. Mirrors PreferenceEvent.kind. */
export type PreferenceKind =
  | "save" // saved an outfit
  | "lock" // pinned a piece in the builder
  | "reroll" // asked for a different suggestion
  | "dismiss" // rejected a daily proposal outright
  | "accept" // took a suggestion
  | "protect" // marked an item exempt from dormancy
  | "train_pick" // picked a favourite from a training round
  | "train_rate" // liked/passed a single outfit while training
  | "train_item"; // liked/passed a single *garment* while training

/**
 * How much each model should learn from one observation.
 * Both in [0, 1]; negative polarity is carried separately by `polarity`.
 */
export type SignalWeight = {
  affinity: number;
  compatibility: number;
  polarity: 1 | -1;
};

/**
 * Default confidence per wear source.
 *
 * Nothing here is a boolean. A photo match is evidence that degrades gracefully;
 * an explicit tap is a fact. Aggregations must weight by confidence rather than
 * count rows, or an afternoon of camera-roll scanning will outvote a year of
 * deliberate logging.
 */
export const WEAR_SOURCE_CONFIDENCE: Record<WearSource, number> = {
  explicit: 1,
  // Overridden per row by match strength; this is the midpoint of the usable band.
  photo: 0.4,
  // Being in a packed bag means the item travelled, not that it was worn.
  packing: 0.4,
  // Pre-WearEvent history was all explicitly logged, so it carries full weight —
  // but see backfillWearEvents() for why it has no useful temporal structure.
  backfill: 1,
};

/** Clamp band for photo-inferred wears. Below the floor we don't record at all. */
export const PHOTO_CONFIDENCE_FLOOR = 0.15;
export const PHOTO_CONFIDENCE_CEILING = 0.7;

/**
 * A confirmed inference is as good as an explicit log — that is the entire
 * point of the confirmation prompt (§7), which is the only source of occasion
 * labels now that calendar integration is out of scope.
 */
export const CONFIRMED_CONFIDENCE = 1;

export const WEAR_SIGNAL_WEIGHT: Record<WearSource, SignalWeight> = {
  explicit: { affinity: 1, compatibility: 1, polarity: 1 },
  photo: { affinity: 1, compatibility: 1, polarity: 1 },
  // Packing says something about what you reach for, nothing about what you
  // wore it *with* — bags are assembled by the packing algorithm, not by taste.
  packing: { affinity: 1, compatibility: 0, polarity: 1 },
  backfill: { affinity: 1, compatibility: 0, polarity: 1 },
};

export const PREFERENCE_SIGNAL_WEIGHT: Record<PreferenceKind, SignalWeight> = {
  save: { affinity: 0.15, compatibility: 0.9, polarity: 1 },
  lock: { affinity: 0.7, compatibility: 0, polarity: 1 },
  // The most valuable signal in the system: a clean pairwise comparison under
  // identical context, which is exactly what Bradley-Terry consumes. Contrastive
  // choice data is worth several times its weight in raw wear counts.
  reroll: { affinity: 0.1, compatibility: 0.6, polarity: -1 },
  dismiss: { affinity: 0.35, compatibility: 0.7, polarity: -1 },
  accept: { affinity: 0.4, compatibility: 0.8, polarity: 1 },
  // Bookkeeping, not taste — protecting a thing you rarely wear is common.
  protect: { affinity: 0, compatibility: 0, polarity: 1 },
  /**
   * Training rounds (§10). Weighted a little below a real accept: choosing
   * between hypotheticals is honest preference data, but it isn't the same as
   * deciding what to actually put on and walk outside in.
   */
  train_pick: { affinity: 0.55, compatibility: 0.6, polarity: 1 },
  train_rate: { affinity: 0.45, compatibility: 0.5, polarity: 1 },
  /**
   * "Do you like this piece?" — the only *directly stated* affinity signal in the
   * table, and the one thing §1 asks for that nothing was collecting.
   *
   * Compatibility is zero, not small: one garment on its own says nothing
   * whatever about what goes with what. That is the point of having it. Every
   * other signal here is set-level, so the model has had to infer item taste from
   * outfit choices, where a three-piece pick spreads its 0.55 across three items
   * and no answer can say which piece earned it.
   *
   * Affinity above `train_pick` because there is no attribution to undo — the
   * judgement names one garment — but below a wear, since it is still an opinion
   * about a photo rather than a decision to walk outside dressed that way.
   */
  train_item: { affinity: 0.6, compatibility: 0, polarity: 1 },
};

/**
 * Sources whose `wornOn` carries real temporal information.
 *
 * Backfilled rows are excluded: pre-WearEvent history recorded a *count* and a
 * *last-worn date*, never the dates in between, so the backfill stacks every
 * wear on the last known date (see scripts/backfill-wear-events.ts). Those rows
 * are honest about totals and about the most recent wear, and meaningless about
 * intervals. Any recurrence, gap, or seasonality computation must filter on
 * this — inventing plausible dates to fill the gap would hand the dormancy
 * model fabricated structure and it would learn from it happily.
 */
export const TEMPORALLY_MEANINGFUL_SOURCES: readonly WearSource[] = [
  "explicit",
  "photo",
  "packing",
];

export function hasUsableTiming(source: WearSource): boolean {
  return TEMPORALLY_MEANINGFUL_SOURCES.includes(source);
}

/** Kinds that carry a rejected set and can be read as `chosen ≻ rejected`. */
export const CONTRASTIVE_KINDS: readonly PreferenceKind[] = [
  "reroll",
  "dismiss",
  "accept",
  "train_pick",
  "train_rate",
  "train_item",
];

export function isContrastive(kind: PreferenceKind): boolean {
  return CONTRASTIVE_KINDS.includes(kind);
}

/** One logged row, in the shape both the model fit and the evaluator read. */
export type LoggedPreference = {
  kind: PreferenceKind;
  /** The chosen set. */
  itemIds: readonly string[];
  /** Pooled union of the passed-over sets. Only used when `arms` is absent. */
  rejectedIds: readonly string[];
  /** Every outfit shown, in display order. Null on rows predating per-arm logging. */
  arms?: readonly (readonly string[])[] | null;
  chosenArm?: number | null;
};

/** A `winners ≻ losers` observation, weighted by how much the signal teaches. */
export type PreferenceComparison = {
  winners: string[];
  losers: string[];
  weight: number;
  /** True when this came from logged arms rather than the pooled fallback. */
  perArm: boolean;
};

/**
 * Read one logged row as the comparisons it actually contains.
 *
 * The single place that decides how a row becomes model input, because the
 * production fit (lib/wear/affinity-server.ts) and the offline evaluator
 * (lib/eval/ranker.ts) must not disagree about it — a difference there shows up
 * as an unexplained gap between measured and live behaviour.
 *
 * With `arms`, a pick over n outfits yields the n−1 shape-matched comparisons the
 * user's single tap actually expressed. Each carries the row's full signal
 * weight: an eight-way choice genuinely is more informative than a three-way one,
 * and all-pairs expansion of a ranked choice is the standard reading. The
 * practical consequence is that `evidence` counts — and therefore the λ ramp —
 * now grow faster per answer than they did under pooled logging.
 *
 * Without `arms`, it falls back to the one pooled comparison, which is all the
 * older rows can support.
 */
export function comparisonsFrom(row: LoggedPreference): PreferenceComparison[] {
  const signal = PREFERENCE_SIGNAL_WEIGHT[row.kind];
  // A reroll names only what was turned down, so there is no winning set to
  // point at; the rejected pieces are handled by the slate's exclusion instead.
  // A protect is bookkeeping, not taste.
  if (!signal || signal.affinity <= 0 || signal.polarity !== 1) return [];

  const arms = row.arms;
  const chosen = row.chosenArm;
  if (arms && arms.length > 1 && chosen != null && chosen >= 0 && chosen < arms.length) {
    const winners = [...arms[chosen]];
    if (winners.length > 0) {
      const out: PreferenceComparison[] = [];
      for (let i = 0; i < arms.length; i += 1) {
        if (i === chosen || arms[i].length === 0) continue;
        out.push({ winners, losers: [...arms[i]], weight: signal.affinity, perArm: true });
      }
      if (out.length > 0) return out;
    }
  }

  if (row.itemIds.length === 0 || row.rejectedIds.length === 0) return [];
  return [
    {
      winners: [...row.itemIds],
      losers: [...row.rejectedIds],
      weight: signal.affinity,
      perArm: false,
    },
  ];
}

/** Parse an `armsJson` column, tolerating anything that is not the shape we wrote. */
export function decodeArms(raw: string | null | undefined): string[][] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const out: string[][] = [];
    for (const arm of parsed) {
      if (!Array.isArray(arm)) return null;
      out.push(arm.filter((id): id is string => typeof id === "string"));
    }
    return out;
  } catch {
    return null;
  }
}

const WEAR_SOURCES = new Set<string>(["explicit", "photo", "packing", "backfill"]);
const PREFERENCE_KINDS = new Set<string>([
  "save",
  "lock",
  "reroll",
  "dismiss",
  "accept",
  "protect",
  "train_pick",
  "train_rate",
  "train_item",
]);

export function isWearSource(value: string): value is WearSource {
  return WEAR_SOURCES.has(value);
}

export function isPreferenceKind(value: string): value is PreferenceKind {
  return PREFERENCE_KINDS.has(value);
}

/**
 * Resolve the confidence to store for a wear, clamped to what the source can
 * honestly support. A photo match never reaches 1 without user confirmation.
 */
export function resolveWearConfidence(source: WearSource, raw?: number | null): number {
  if (raw == null || !Number.isFinite(raw)) return WEAR_SOURCE_CONFIDENCE[source];
  if (source === "photo") {
    return Math.min(PHOTO_CONFIDENCE_CEILING, Math.max(PHOTO_CONFIDENCE_FLOOR, raw));
  }
  return Math.min(1, Math.max(0, raw));
}
