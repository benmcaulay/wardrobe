/**
 * The numbers behind the Sell landing: what you've made, what's still on the
 * table, and which platform is actually working for you.
 *
 * Pure and deterministic — timestamps arrive as epoch ms and "now" is always
 * passed in, so the server can render these without a round trip and the tests
 * don't need a clock.
 *
 * One rule runs through all of it: never present a guess as a fact. A sale we
 * can't attribute to a platform is counted in your total and reported
 * separately rather than quietly assigned to one; a piece that sold before we
 * tracked dates is excluded from time-to-sell rather than given an invented
 * one. See `unattributedGrossCents` and `timedSaleCount`.
 */
import type { MarketplaceId } from "@/lib/marketplaces";
import { netProceedsCents } from "./fees";

/** A placement as the metrics need it — the DB row, flattened to plain values. */
export type MetricPlacement = {
  listingId: string;
  platform: MarketplaceId;
  /** "draft" | "listed" | "sold" | "ended" */
  status: string;
  soldPriceCents: number | null;
  feeCents: number | null;
  shippingCents: number | null;
  listedAtMs: number | null;
  soldAtMs: number | null;
};

/** A sold listing, which is the authoritative record that a sale happened. */
export type MetricSoldListing = {
  listingId: string;
  soldPriceCents: number | null;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function isSold(p: MetricPlacement): boolean {
  return p.status === "sold";
}

function isWorking(p: MetricPlacement): boolean {
  return p.status === "listed" || p.status === "draft";
}

// ─────────────────────────────────────────────────────────────────────────────
// Earnings

export type EarningsSummary = {
  /** Every dollar that came in, attributed or not. The headline number. */
  grossCents: number;
  /** Gross we could tie to a specific platform. */
  attributedGrossCents: number;
  /**
   * Gross from sales with no platform recorded — real money, unknown source.
   * Shown as its own row so the platform breakdown never has to lie about
   * summing to the total.
   */
  unattributedGrossCents: number;
  /** Platform commissions, across attributed sales only. */
  feesCents: number;
  /** Shipping the seller absorbed. */
  shippingCents: number;
  /** Gross less fees less shipping. Only attributed sales carry cost data. */
  netCents: number;
  soldCount: number;
  /** Sales missing a platform — the count behind `unattributedGrossCents`. */
  unattributedCount: number;
};

/**
 * Total takings. `soldListings` is the source of truth for *whether* something
 * sold; placements add *where* and *at what cost*. A sold listing with no sold
 * placement still counts toward gross — it just lands in the unattributed
 * bucket, because dropping it would understate real earnings and guessing a
 * platform would fabricate data.
 */
export function earningsSummary(input: {
  soldListings: readonly MetricSoldListing[];
  placements: readonly MetricPlacement[];
}): EarningsSummary {
  const soldPlacements = input.placements.filter(isSold);
  const attributedListingIds = new Set(soldPlacements.map((p) => p.listingId));

  let attributedGrossCents = 0;
  let feesCents = 0;
  let shippingCents = 0;
  for (const p of soldPlacements) {
    const sale = p.soldPriceCents ?? 0;
    attributedGrossCents += sale;
    feesCents += p.feeCents ?? 0;
    shippingCents += p.shippingCents ?? 0;
  }

  let unattributedGrossCents = 0;
  let unattributedCount = 0;
  for (const listing of input.soldListings) {
    if (attributedListingIds.has(listing.listingId)) continue;
    unattributedGrossCents += listing.soldPriceCents ?? 0;
    unattributedCount += 1;
  }

  const grossCents = attributedGrossCents + unattributedGrossCents;
  return {
    grossCents,
    attributedGrossCents,
    unattributedGrossCents,
    feesCents,
    shippingCents,
    netCents: grossCents - feesCents - shippingCents,
    soldCount: attributedListingIds.size + unattributedCount,
    unattributedCount,
  };
}

/**
 * Gross taken in a time window — "you've made $340 this month". Only
 * placements with a recorded `soldAt` can be placed in time, so sales
 * backfilled without a date are absent by design.
 */
export function earnedBetween(
  placements: readonly MetricPlacement[],
  fromMs: number,
  toMs: number,
): { grossCents: number; netCents: number; soldCount: number } {
  let grossCents = 0;
  let netCents = 0;
  let soldCount = 0;
  for (const p of placements) {
    if (!isSold(p) || p.soldAtMs == null) continue;
    if (p.soldAtMs < fromMs || p.soldAtMs > toMs) continue;
    const sale = p.soldPriceCents ?? 0;
    grossCents += sale;
    netCents += netProceedsCents({
      saleCents: sale,
      feeCents: p.feeCents,
      shippingCents: p.shippingCents,
    });
    soldCount += 1;
  }
  return { grossCents, netCents, soldCount };
}

/** Start of the current calendar month, local time. */
export function startOfMonthMs(nowMs: number): number {
  const d = new Date(nowMs);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-platform breakdown

export type PlatformStats = {
  platform: MarketplaceId;
  /** Sold here. */
  soldCount: number;
  /** Live or drafted here right now. */
  activeCount: number;
  grossCents: number;
  netCents: number;
  feesCents: number;
  /** Mean days from listed to sold, over sales that have both dates. */
  avgDaysToSell: number | null;
  /** How many sales that average rests on. Small n deserves a caveat in the UI. */
  timedSaleCount: number;
};

/**
 * Per-platform performance, sorted by gross so the platform actually earning
 * you money leads. Platforms you've never touched are absent — the caller
 * decides whether to render them greyed out as an invitation.
 */
export function platformBreakdown(placements: readonly MetricPlacement[]): PlatformStats[] {
  const byPlatform = new Map<MarketplaceId, PlatformStats & { daysTotal: number }>();

  const get = (platform: MarketplaceId) => {
    let row = byPlatform.get(platform);
    if (!row) {
      row = {
        platform,
        soldCount: 0,
        activeCount: 0,
        grossCents: 0,
        netCents: 0,
        feesCents: 0,
        avgDaysToSell: null,
        timedSaleCount: 0,
        daysTotal: 0,
      };
      byPlatform.set(platform, row);
    }
    return row;
  };

  for (const p of placements) {
    const row = get(p.platform);
    if (isSold(p)) {
      const sale = p.soldPriceCents ?? 0;
      row.soldCount += 1;
      row.grossCents += sale;
      row.feesCents += p.feeCents ?? 0;
      row.netCents += netProceedsCents({
        saleCents: sale,
        feeCents: p.feeCents,
        shippingCents: p.shippingCents,
      });
      const days = daysToSell(p);
      if (days != null) {
        row.daysTotal += days;
        row.timedSaleCount += 1;
      }
    } else if (isWorking(p)) {
      row.activeCount += 1;
    }
  }

  return [...byPlatform.values()]
    .map(({ daysTotal, ...row }) => ({
      ...row,
      avgDaysToSell: row.timedSaleCount > 0 ? daysTotal / row.timedSaleCount : null,
    }))
    .sort(
      (a, b) =>
        b.grossCents - a.grossCents ||
        b.soldCount - a.soldCount ||
        a.platform.localeCompare(b.platform),
    );
}

/**
 * Days a placement took to sell, or null when we can't know. Negative spans
 * (a soldAt before its listedAt — clock skew, or a hand-edited date) are
 * rejected rather than clamped to 0, which would drag the average down with a
 * value we know is wrong.
 */
export function daysToSell(p: MetricPlacement): number | null {
  if (!isSold(p) || p.listedAtMs == null || p.soldAtMs == null) return null;
  const span = p.soldAtMs - p.listedAtMs;
  if (span < 0) return null;
  return span / MS_PER_DAY;
}

/** Mean days to sell across every platform. Null until one timed sale exists. */
export function overallAvgDaysToSell(
  placements: readonly MetricPlacement[],
): { avgDays: number | null; timedSaleCount: number } {
  let total = 0;
  let count = 0;
  for (const p of placements) {
    const days = daysToSell(p);
    if (days == null) continue;
    total += days;
    count += 1;
  }
  return { avgDays: count > 0 ? total / count : null, timedSaleCount: count };
}

// ─────────────────────────────────────────────────────────────────────────────
// Opportunity — "still on the table"

export type Opportunity = {
  /** Pieces with no sale decision yet. */
  untriagedCount: number;
  untriagedValueCents: number;
  /** Pieces marked to sell that haven't sold. */
  activeCount: number;
  activeAskingCents: number;
  /** The headline: everything not yet turned into money. */
  totalCents: number;
  totalCount: number;
  /**
   * How many untriaged pieces had no retail price to estimate from, and so
   * contribute nothing to the total. A large number here means the estimate
   * is conservative, and the UI should say so.
   */
  unpricedCount: number;
};

/**
 * What the closet could still bring in: untriaged pieces valued at their
 * estimated resale, plus everything already marked for sale at its asking
 * price. This is the second half of the landing's hero, and the number that
 * makes the page worth visiting before you've sold anything.
 *
 * `estimateCents` is injected (rather than importing `suggestedAskingCents`)
 * so the caller controls the pricing model and the tests can use a trivial one.
 */
export function opportunitySize(input: {
  untriaged: readonly { retailCents: number | null }[];
  active: readonly { askingCents: number | null }[];
  estimateCents: (retailCents: number | null) => number | null;
}): Opportunity {
  let untriagedValueCents = 0;
  let unpricedCount = 0;
  for (const item of input.untriaged) {
    const estimate = input.estimateCents(item.retailCents);
    if (estimate == null || estimate <= 0) {
      unpricedCount += 1;
      continue;
    }
    untriagedValueCents += estimate;
  }

  let activeAskingCents = 0;
  for (const listing of input.active) {
    activeAskingCents += listing.askingCents ?? 0;
  }

  return {
    untriagedCount: input.untriaged.length,
    untriagedValueCents,
    activeCount: input.active.length,
    activeAskingCents,
    totalCents: untriagedValueCents + activeAskingCents,
    totalCount: input.untriaged.length + input.active.length,
    unpricedCount,
  };
}

/** Round a day count for display: "9 d", "1.5 d" under two days. */
export function formatDays(days: number): string {
  return days < 2 ? `${Math.round(days * 10) / 10} d` : `${Math.round(days)} d`;
}
