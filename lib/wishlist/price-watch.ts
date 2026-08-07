/**
 * Price history for wishlist items. Stored as a JSON string column
 * (WardrobeItem.priceHistory), oldest point first, following the same
 * encoding convention as the other JSON columns in this schema.
 */

export type PricePoint = { cents: number; at: string };

/** Keep the tail bounded — a wishlist item checked weekly for a year still fits. */
export const MAX_PRICE_POINTS = 60;

export function parsePriceHistory(raw: string | null | undefined): PricePoint[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is PricePoint =>
        !!p &&
        typeof p === "object" &&
        typeof (p as PricePoint).cents === "number" &&
        Number.isFinite((p as PricePoint).cents) &&
        (p as PricePoint).cents > 0 &&
        typeof (p as PricePoint).at === "string",
    );
  } catch {
    return [];
  }
}

/**
 * Append a reading. A repeat of the current price is dropped rather than
 * stored — history should record changes, not how often we polled.
 */
export function appendPricePoint(
  history: readonly PricePoint[],
  cents: number,
  atIso: string,
): PricePoint[] {
  if (!Number.isFinite(cents) || cents <= 0) return [...history];
  const last = history[history.length - 1];
  if (last && last.cents === cents) return [...history];
  return [...history, { cents, at: atIso }].slice(-MAX_PRICE_POINTS);
}

export type PriceDrop = {
  fromCents: number;
  toCents: number;
  dropCents: number;
  /** Whole-percent discount off the peak, e.g. 30 for 30% off. */
  dropPercent: number;
  /** ISO timestamp of the reading that established the drop. */
  at: string;
};

/**
 * A drop is the latest price sitting below the highest price we've previously
 * recorded — peak-relative, so a sale that partially rebounds still reads as a
 * discount rather than the price "rising".
 */
export function detectPriceDrop(history: readonly PricePoint[]): PriceDrop | null {
  if (history.length < 2) return null;

  const latest = history[history.length - 1];
  const peak = history.slice(0, -1).reduce((max, p) => (p.cents > max ? p.cents : max), 0);
  if (peak <= latest.cents) return null;

  const dropCents = peak - latest.cents;
  return {
    fromCents: peak,
    toCents: latest.cents,
    dropCents,
    dropPercent: Math.round((dropCents / peak) * 100),
    at: latest.at,
  };
}

/** Most recent recorded price, or null when nothing has been checked yet. */
export function latestPriceCents(history: readonly PricePoint[]): number | null {
  return history.length > 0 ? history[history.length - 1].cents : null;
}

/** How stale a price check is, in whole days. Null when never checked. */
export function daysSinceCheck(checkedAt: Date | string | null | undefined, now: Date): number | null {
  if (!checkedAt) return null;
  const then = typeof checkedAt === "string" ? new Date(checkedAt) : checkedAt;
  const ms = now.getTime() - then.getTime();
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return Math.floor(ms / 86_400_000);
}
