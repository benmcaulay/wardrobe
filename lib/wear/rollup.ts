/**
 * Collapsing the WearEvent log back down into the counters on WardrobeItem.
 *
 * `timesWorn` and `lastWornAt` predate the event log and are read all over the
 * UI, so they survive as denormalized mirrors — the same pattern already used
 * for SaleListing.marketplaces vs ListingPlacement. Nothing increments them
 * directly any more; they are recomputed from events.
 *
 * The split that matters:
 *
 *   timesWorn      — integer count of *confident* wears only, because it is
 *                    rendered as "worn 4 times" and that sentence has to be
 *                    literally true. A 0.4-confidence camera-roll guess is not
 *                    a wear the user would agree happened.
 *   effectiveWears — confidence-weighted sum, which is what models read. This
 *                    is the number that treats evidence as evidence.
 *
 * Keeping both is what lets inference be aggressive without making the UI lie.
 */

/** At or above this, we're willing to state the wear as fact in the interface. */
export const CONFIDENT_WEAR_THRESHOLD = 0.8;

export type WearRollupInput = {
  wornOn: Date;
  confidence: number;
  confirmedAt?: Date | null;
};

export type WearRollup = {
  timesWorn: number;
  effectiveWears: number;
  /** Most recent confident wear. Drives user-facing "last worn" copy. */
  lastWornAt: Date | null;
  /**
   * Most recent wear of any confidence, including unconfirmed guesses. The
   * dormancy model (§6) reads this so it won't announce "you haven't worn this
   * in a year" about something it half-saw in a photo last week — that is
   * exactly the kind of confidently-wrong claim that costs trust.
   */
  lastInferredWearOn: Date | null;
};

/** A confirmed inference counts as fact regardless of its original score. */
export function effectiveConfidence(event: WearRollupInput): number {
  if (event.confirmedAt) return 1;
  if (!Number.isFinite(event.confidence)) return 0;
  return Math.min(1, Math.max(0, event.confidence));
}

export function isConfidentWear(event: WearRollupInput): boolean {
  return effectiveConfidence(event) >= CONFIDENT_WEAR_THRESHOLD;
}

export function rollUpWearEvents(events: readonly WearRollupInput[]): WearRollup {
  let timesWorn = 0;
  let effectiveWears = 0;
  let lastWornAt: Date | null = null;
  let lastInferredWearOn: Date | null = null;

  for (const event of events) {
    const confidence = effectiveConfidence(event);
    if (confidence <= 0) continue;
    effectiveWears += confidence;

    if (!lastInferredWearOn || event.wornOn > lastInferredWearOn) {
      lastInferredWearOn = event.wornOn;
    }
    if (confidence >= CONFIDENT_WEAR_THRESHOLD) {
      timesWorn += 1;
      if (!lastWornAt || event.wornOn > lastWornAt) lastWornAt = event.wornOn;
    }
  }

  // Float error accumulates over hundreds of events and would surface as
  // "3.9999999999999996 wears" in any debug view that prints it raw.
  return {
    timesWorn,
    effectiveWears: Math.round(effectiveWears * 1e6) / 1e6,
    lastWornAt,
    lastInferredWearOn,
  };
}

/**
 * `wornOn` is a DATE, and which date a wear belongs to is a question only the
 * *user's* timezone can answer. Something put on at 11pm in Los Angeles is
 * already tomorrow in UTC, so normalizing a raw timestamp server-side would
 * shift roughly a third of evening wears onto the following day and skew every
 * recurrence gap the dormancy model computes.
 *
 * So the calendar date is resolved on the client and sent as "YYYY-MM-DD".
 * These two helpers are the only sanctioned way to produce a `wornOn`.
 */

/** Parse a client-supplied "YYYY-MM-DD" into the UTC midnight the column stores. */
export function wornOnFromISODate(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  // Round-trip guards against "2026-02-31" silently rolling into March.
  return date.getUTCMonth() === Number(m) - 1 && date.getUTCDate() === Number(d) ? date : null;
}

/**
 * Calendar date of a Date *as read in the runtime's own timezone*. Correct in
 * the browser, where the runtime timezone is the user's; on the server it is
 * only a fallback for when the client didn't send a date.
 */
export function wornOnFromLocalDate(local: Date): Date {
  return new Date(Date.UTC(local.getFullYear(), local.getMonth(), local.getDate()));
}

/** Format a `wornOn` back to "YYYY-MM-DD" for transport. */
export function wornOnToISODate(wornOn: Date): string {
  return wornOn.toISOString().slice(0, 10);
}
