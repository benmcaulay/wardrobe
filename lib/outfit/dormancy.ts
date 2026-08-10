/**
 * Lens 1 — dormancy (docs/OUTFIT_INTELLIGENCE.md §6).
 *
 * "Last worn 14 months ago." A fact about an item, never an instruction: this
 * module has no concept of selling anything, and the copy it drives is
 * descriptive by construction.
 *
 * ── The readiness gate is the most important thing here ─────────────────────
 *
 * A dormancy model needs wear history. On a closet that started logging last
 * week, *every* garment is dormant — the statement is true of everything and
 * therefore says nothing, while reading like an accusation. Shipping this
 * ungated on day one is the single fastest way to burn the trust §6 exists to
 * protect. `dormancyReadiness` decides whether the lens gets to speak at all,
 * and it is the caller's job to respect it.
 *
 * ── What "dormant" means ────────────────────────────────────────────────────
 *
 * Clothing is repeat consumption with wildly different natural periods — jeans
 * weekly, a ski jacket annually. So dormancy is measured against the item's own
 * plausible recurrence rather than a fixed calendar cutoff, and a garment is
 * only surfaced when it has clearly fallen out of a rhythm it used to have, or
 * has never entered one despite having had the chance.
 *
 * Pure and dependency-light.
 */

import type { Season } from "@/lib/json";
import type { ClimateBand } from "@/lib/services/weather";

/** Wear events must span at least this long before the lens says anything. */
export const MIN_HISTORY_DAYS = 90;
/** …and there must be at least this many, or there is no rhythm to be out of. */
export const MIN_WEAR_EVENTS = 25;

export type DormancyReadiness = {
  ready: boolean;
  /** Why not, in words the UI can show instead of a broken lens. */
  reason?: "too-few-wears" | "too-short-a-history";
  wearEvents: number;
  historyDays: number;
};

/**
 * May the dormancy lens speak yet?
 *
 * Both conditions matter and neither implies the other: fifty wears logged in
 * one week is a burst, not a history, and one wear a month for a year is a
 * history with nothing in it.
 */
export function dormancyReadiness(input: {
  wearEvents: number;
  earliestWearAt: Date | null;
  now: Date;
}): DormancyReadiness {
  const historyDays = input.earliestWearAt
    ? Math.floor((input.now.getTime() - input.earliestWearAt.getTime()) / 86_400_000)
    : 0;

  if (input.wearEvents < MIN_WEAR_EVENTS) {
    return { ready: false, reason: "too-few-wears", wearEvents: input.wearEvents, historyDays };
  }
  if (historyDays < MIN_HISTORY_DAYS) {
    return {
      ready: false,
      reason: "too-short-a-history",
      wearEvents: input.wearEvents,
      historyDays,
    };
  }
  return { ready: true, wearEvents: input.wearEvents, historyDays };
}

export type DormancyInput = {
  itemId: string;
  /** Confidence-weighted wears. */
  effectiveWears: number;
  /** Most recent confident wear, or null if never. */
  lastWornAt: Date | null;
  addedAt: Date;
  /** Seasons the item is tagged for; empty is the common case. */
  seasons: Season[];
  /** Owner ids — a shared garment is insulated (§6). */
  ownerCount: number;
  protectedAt: Date | null;
  /** Leave-one-out value from lib/outfit/marginal-value.ts, 0..1. */
  marginalValue: number;
  /** Today's band, for the in-season-pending check. */
  band: ClimateBand | null;
  now: Date;
};

export type DormancySuppression =
  | "protected"
  | "too-new"
  | "shared"
  | "load-bearing"
  | "out-of-season"
  | "not-dormant";

export type DormancyResult = {
  itemId: string;
  daysSinceWorn: number | null;
  /** 0..1 — how far out of any plausible rhythm this item has fallen. */
  score: number;
  /** Set when the lens declines to surface it, with the reason. */
  suppressedBy: DormancySuppression | null;
};

/** Nothing under three months old is dormant; it's new. */
export const MIN_AGE_DAYS = 90;
/** Above this leave-one-out value an item is structurally load-bearing. */
export const LOAD_BEARING_THRESHOLD = 0.6;

const BAND_SEASONS: Record<ClimateBand, Season[]> = {
  hot: ["summer"],
  warm: ["summer", "spring"],
  mild: ["spring", "fall"],
  cool: ["fall", "spring"],
  cold: ["winter"],
};

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

/**
 * How dormant one item is, and whether we're willing to say so.
 *
 * The suppression list is the substance of this function. Roughly a fifth of a
 * typical wardrobe is dormant at any moment, but ~70% of dormant items are
 * retained with real intent to wear again — about 20% reserved for a specific
 * occasion. That 20% is the false-positive class, and misclassifying someone's
 * funeral suit costs more trust than ten correct findings earn.
 */
export function assessDormancy(input: DormancyInput): DormancyResult {
  const ageDays = daysBetween(input.addedAt, input.now);
  const daysSinceWorn = input.lastWornAt ? daysBetween(input.lastWornAt, input.now) : null;

  const base: Omit<DormancyResult, "score" | "suppressedBy"> = {
    itemId: input.itemId,
    daysSinceWorn,
  };
  const suppressed = (reason: DormancySuppression): DormancyResult => ({
    ...base,
    score: 0,
    suppressedBy: reason,
  });

  if (input.protectedAt) return suppressed("protected");
  if (ageDays < MIN_AGE_DAYS) return suppressed("too-new");
  // A garment more than one person wears isn't idle just because *this* person
  // hasn't reached for it.
  if (input.ownerCount > 1) return suppressed("shared");
  if (input.marginalValue >= LOAD_BEARING_THRESHOLD) return suppressed("load-bearing");

  // In-season-pending: a wool coat in July is waiting, not neglected.
  if (input.seasons.length > 0 && input.band) {
    const wanted = BAND_SEASONS[input.band];
    if (!input.seasons.some((season) => wanted.includes(season))) {
      return suppressed("out-of-season");
    }
  }

  // Never worn, but old enough that it has had a fair chance.
  if (daysSinceWorn == null) {
    const score = Math.min(1, ageDays / (MIN_AGE_DAYS * 4));
    return { ...base, score, suppressedBy: score > 0 ? null : "not-dormant" };
  }

  // Measured against the item's own rhythm: something worn twenty times has a
  // short natural gap, so three months of silence means more than it does for
  // something worn twice. Guarded so a single wear can't imply a 1-day period.
  const observedPeriod = input.effectiveWears >= 2 ? ageDays / input.effectiveWears : ageDays;
  const expectedGap = Math.max(30, Math.min(observedPeriod, 365));
  const overdue = daysSinceWorn / expectedGap;

  if (overdue < 2) return suppressed("not-dormant");
  return { ...base, score: Math.min(1, (overdue - 2) / 4), suppressedBy: null };
}

/** Items the lens is willing to surface, most dormant first. */
export function rankDormant(results: readonly DormancyResult[]): DormancyResult[] {
  return results.filter((r) => r.suppressedBy == null).sort((a, b) => b.score - a.score);
}
