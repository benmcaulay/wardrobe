/**
 * The space ledger: what came in, what went out, and what that freed.
 *
 * Four independent readings, deliberately **never fused into a single score** —
 * the same rule the observation lenses run on (lib/actions/closet-lenses.ts).
 * There is no "space score", no percentage, no target, and no code path that
 * could add one:
 *
 *   in    — pieces added in the window
 *   out   — pieces that sold in the window
 *   rail  — linear inches of hanging rail those pieces were taking up
 *   money — what they brought back
 *
 * `net` is the only derived number, and it is a subtraction (out − in) rather
 * than an index: it can be negative, it has no ceiling, and a bad month reads
 * as "seven more in than out", which is a fact about the closet rather than a
 * grade for the person.
 *
 * Pure and deterministic in the same style as lib/sell/metrics.ts: timestamps
 * arrive as epoch ms, "now" is always passed in, so the server renders this
 * without a round trip and the tests need no clock.
 *
 * The rule inherited from metrics.ts holds here too — never present a guess as
 * a fact. Rail inches come from a category table, so `rail.estimated` is always
 * true and the UI is expected to say "about". A sale with no recorded date is
 * counted separately rather than dropped or given an invented one.
 */

import { classifyGarmentKind, type GarmentKind } from "@/lib/categories";

/** A piece that entered the closet. */
export type LedgerArrival = {
  createdAtMs: number;
};

/** A piece that left it. `soldAtMs` is null when the sale predates date tracking. */
export type LedgerDeparture = {
  soldAtMs: number | null;
  grossCents: number;
  /**
   * Everything `classifyGarmentKind` needs. All three, not just the category:
   * the add flow files new items as "None", so category alone loses a
   * meaningful slice of any real closet to the fallback.
   */
  category: string;
  subcategory?: string | null;
  name?: string | null;
};

export type SpaceLedger = {
  window: { fromMs: number; toMs: number };
  /** Pieces added. */
  in: { count: number };
  /** Pieces sold, dated inside the window. */
  out: { count: number };
  /**
   * Hanging rail those departures were occupying. Always an estimate — see
   * `RAIL_INCHES_BY_CATEGORY`.
   */
  rail: { inches: number; estimated: true };
  money: { grossCents: number };
  /**
   * Sales we know happened but cannot place in time. Reported rather than
   * silently folded into the window or dropped from the total.
   */
  undated: { count: number; grossCents: number };
  /** out − in. A subtraction, not a score. Negative means the closet grew. */
  net: number;
};

/**
 * Roughly how much rail a hanging garment of each kind eats, in inches.
 *
 * Rounded on purpose — the honest precision here is "about an inch and a half".
 * The numbers exist so "made space" can be stated in a physical unit the user
 * can picture instead of a piece count, which is the only unit a closet
 * actually runs out of.
 *
 * Keyed by `GarmentKind`, not by category name. Categories are user-editable,
 * so a table keyed on names would work on the default list and quietly collapse
 * on a real closet — which is exactly the bug SmartPakker shipped and
 * `classifyGarmentKind` exists to prevent (see lib/categories.ts). Cost of
 * doing it right: the taxonomy is coarse, so a parka and a cardigan are both
 * "outerwear" at the same width. That inaccuracy is bounded and admitted by
 * `rail.estimated`; the name-keyed version's inaccuracy was not.
 *
 * Shoes and accessories are zero. They free shelf, drawer, and floor rather
 * than rail, and counting them would let the headline number climb on a
 * clear-out that didn't widen the rail by an inch.
 */
export const RAIL_INCHES_BY_KIND: Readonly<Record<GarmentKind, number>> = {
  outerwear: 2.75,
  dress: 1.5,
  bottom: 1.5,
  top: 1.25,
  shoes: 0,
  accessory: 0,
  /** Unclassifiable. A shirt's worth, which is the commonest thing to be. */
  other: 1.25,
};

/**
 * Rail inches for one departing piece. Exported so the UI can explain a row.
 *
 * `categoryShapes` is the user's own answer for categories no regex can read
 * ("workwear", "favorites") and is threaded through because
 * `classifyGarmentKind` consults it before inferring anything.
 */
export function railInchesForPiece(
  piece: Pick<LedgerDeparture, "category" | "subcategory" | "name">,
  categoryShapes?: Record<string, GarmentKind> | null,
): number {
  return RAIL_INCHES_BY_KIND[classifyGarmentKind({ ...piece, categoryShapes })];
}

/**
 * Build the ledger for a window.
 *
 * `fromMs` is inclusive, `toMs` inclusive — a piece added at the exact start of
 * the month belongs to that month, and the caller computing month boundaries
 * with `startOfMonthMs` gets no off-by-one at midnight.
 */
export function buildSpaceLedger(input: {
  arrivals: readonly LedgerArrival[];
  departures: readonly LedgerDeparture[];
  fromMs: number;
  toMs: number;
  /** The user's category→shape answers, for the rail estimate. */
  categoryShapes?: Record<string, GarmentKind> | null;
  /**
   * Count sales that carry no date.
   *
   * False for a month, because a sale we cannot place in time cannot be claimed
   * for March. True for an all-time window, because there the sale is
   * unambiguously inside it and excluding it would understate a real departure,
   * real rail, and real money. `undated` is still reported either way, so a
   * caller can always show the split.
   */
  countUndated?: boolean;
}): SpaceLedger {
  const { arrivals, departures, fromMs, toMs, categoryShapes } = input;
  const countUndated = input.countUndated ?? false;

  let inCount = 0;
  for (const a of arrivals) {
    if (a.createdAtMs < fromMs || a.createdAtMs > toMs) continue;
    inCount += 1;
  }

  let outCount = 0;
  let railInches = 0;
  let grossCents = 0;
  let undatedCount = 0;
  let undatedGrossCents = 0;

  for (const d of departures) {
    if (d.soldAtMs == null) {
      undatedCount += 1;
      undatedGrossCents += d.grossCents;
      if (!countUndated) continue;
    } else if (d.soldAtMs < fromMs || d.soldAtMs > toMs) {
      continue;
    }
    outCount += 1;
    railInches += railInchesForPiece(d, categoryShapes);
    grossCents += d.grossCents;
  }

  return {
    window: { fromMs, toMs },
    in: { count: inCount },
    out: { count: outCount },
    // Quarter-inch resolution: the inputs are rounded estimates, so anything
    // finer would be false precision dressed up as a measurement.
    rail: { inches: Math.round(railInches * 4) / 4, estimated: true },
    money: { grossCents },
    undated: { count: undatedCount, grossCents: undatedGrossCents },
    net: outCount - inCount,
  };
}

/** One month of the year view. */
export type LedgerMonth = {
  /** Epoch ms of the first instant of the month, local time. */
  startMs: number;
  in: number;
  out: number;
};

/**
 * The trailing `months` calendar months, oldest first, including the month
 * `nowMs` falls in.
 *
 * Calendar months rather than 30-day blocks because the user reads this
 * alongside their own sense of "March was the big clear-out", and a sliding
 * window silently disagrees with that by a few days every row.
 */
export function ledgerByMonth(input: {
  arrivals: readonly LedgerArrival[];
  departures: readonly LedgerDeparture[];
  nowMs: number;
  months: number;
}): LedgerMonth[] {
  const { arrivals, departures, nowMs, months } = input;
  if (months <= 0) return [];

  const now = new Date(nowMs);
  const buckets: LedgerMonth[] = [];
  const indexByStart = new Map<number, number>();

  for (let back = months - 1; back >= 0; back -= 1) {
    const start = new Date(now.getFullYear(), now.getMonth() - back, 1).getTime();
    indexByStart.set(start, buckets.length);
    buckets.push({ startMs: start, in: 0, out: 0 });
  }

  const oldestStart = buckets[0].startMs;

  const bucketFor = (ms: number): LedgerMonth | null => {
    if (ms < oldestStart || ms > nowMs) return null;
    const d = new Date(ms);
    const start = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    const idx = indexByStart.get(start);
    return idx === undefined ? null : buckets[idx];
  };

  for (const a of arrivals) {
    const bucket = bucketFor(a.createdAtMs);
    if (bucket) bucket.in += 1;
  }
  for (const d of departures) {
    if (d.soldAtMs == null) continue;
    const bucket = bucketFor(d.soldAtMs);
    if (bucket) bucket.out += 1;
  }

  return buckets;
}

/**
 * "about 6 in" / "about 3 ft 2 in".
 *
 * Switches to feet past a foot because a closet rail is a thing people measure
 * in feet, and "38 inches of rail" makes the reader do the division.
 */
export function formatRailInches(inches: number): string {
  if (inches <= 0) return "none yet";
  if (inches < 12) return `about ${trimZero(inches)} in`;
  const feet = Math.floor(inches / 12);
  const rest = Math.round((inches - feet * 12) * 2) / 2;
  if (rest <= 0) return `about ${feet} ft`;
  return `about ${feet} ft ${trimZero(rest)} in`;
}

/** Quarter-inch values without a trailing ".00" or ".50". */
function trimZero(value: number): string {
  return value.toFixed(2).replace(/\.?0+$/, "");
}
