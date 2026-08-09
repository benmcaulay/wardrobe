/**
 * What each marketplace keeps when a piece sells, so "you've made $1,284" can
 * become "$1,106 after fees" — and so we can answer "you'd net more on Vinted".
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THESE RATES GO STALE. Marketplace fee structures change often and vary by
 * region and seller plan — Depop and Mercari both dropped their seller
 * commissions in 2024 and moved the cost to buyers, and any of them could
 * reverse that tomorrow. Treat this table as a *default*, never as truth:
 *
 *   - every rate carries `asOf`, surfaced in settings so a stale number is
 *     visible rather than silently wrong;
 *   - the user can override any platform's rate (see `resolveFeeRule`);
 *   - a fee we calculated is stored with `feeEstimated: true`, so a recorded
 *     actual fee always wins over our guess.
 *
 * Re-check against each platform's seller-fees page when the `asOf` dates age.
 * ────────────────────────────────────────────────────────────────────────────
 */
import type { MarketplaceId } from "@/lib/marketplaces";

/**
 * How one platform's cut is computed. Every field is optional-by-default (0)
 * so a zero-fee platform is expressed by simply omitting the parts it doesn't
 * charge, rather than by a special case.
 */
export type FeeRule = {
  /** Share of the sale price the platform keeps as commission, 0..1. */
  commissionRate: number;
  /** Flat commission in cents, charged per order on top of the rate. */
  commissionFlatCents: number;
  /** Payment processing, when the platform bills it separately. */
  processingRate: number;
  processingFlatCents: number;
  /**
   * Some platforms swap the percentage for a flat fee on cheap orders —
   * Poshmark takes $2.95 on anything under $15 rather than its usual 20%.
   */
  smallOrder?: { underCents: number; flatCents: number };
  /** Plain-English version, shown next to the override field in settings. */
  summary: string;
  /** ISO date the rate was last verified. Surfaced when it gets old. */
  asOf: string;
};

/**
 * Default seller-side fees per marketplace. Seller-side is the operative word:
 * Vinted and Mercari shifted their fees onto buyers, which costs the seller
 * nothing at payout even though the buyer pays more.
 */
export const DEFAULT_FEE_RULES: Record<MarketplaceId, FeeRule> = {
  depop: {
    commissionRate: 0,
    commissionFlatCents: 0,
    processingRate: 0.033,
    processingFlatCents: 45,
    summary: "No selling fee; payment processing 3.3% + $0.45.",
    asOf: "2026-05-01",
  },
  poshmark: {
    commissionRate: 0.2,
    commissionFlatCents: 0,
    processingRate: 0,
    processingFlatCents: 0,
    smallOrder: { underCents: 1500, flatCents: 295 },
    summary: "20% commission, or a flat $2.95 on sales under $15.",
    asOf: "2026-05-01",
  },
  mercari: {
    commissionRate: 0,
    commissionFlatCents: 0,
    processingRate: 0,
    processingFlatCents: 0,
    summary: "No seller fees — Mercari charges the buyer instead.",
    asOf: "2026-05-01",
  },
  vinted: {
    commissionRate: 0,
    commissionFlatCents: 0,
    processingRate: 0,
    processingFlatCents: 0,
    summary: "No seller fees — the buyer pays Buyer Protection.",
    asOf: "2026-05-01",
  },
  ebay: {
    commissionRate: 0.1325,
    commissionFlatCents: 30,
    processingRate: 0,
    processingFlatCents: 0,
    summary: "≈13.25% final value fee + $0.30 per order (varies by category).",
    asOf: "2026-05-01",
  },
  grailed: {
    commissionRate: 0.09,
    commissionFlatCents: 0,
    processingRate: 0.035,
    processingFlatCents: 30,
    summary: "9% commission + payment processing 3.5% + $0.30.",
    asOf: "2026-05-01",
  },
  facebook: {
    commissionRate: 0.05,
    commissionFlatCents: 0,
    processingRate: 0,
    processingFlatCents: 0,
    summary: "5% on shipped orders; local pickup is free.",
    asOf: "2026-05-01",
  },
};

/**
 * A user's correction to one platform's rate, stored under `stylePrefs`. Only
 * the fields they actually changed are kept, so a later default update still
 * reaches anyone who never touched that platform.
 */
export type FeeOverride = Partial<
  Pick<
    FeeRule,
    "commissionRate" | "commissionFlatCents" | "processingRate" | "processingFlatCents"
  >
>;

export type FeeOverrides = Partial<Record<MarketplaceId, FeeOverride>>;

/** Rates outside these bounds are almost certainly a typo (or a percent/decimal mixup). */
const MAX_RATE = 0.9;
const MAX_FLAT_CENTS = 100_00;

/**
 * Merge a user's override onto the default rule. Values are clamped rather
 * than rejected: someone typing "20" meaning 20% shouldn't produce a net
 * payout of negative $400, and a silently-ignored override would be worse
 * still — they'd think the correction took.
 */
export function resolveFeeRule(platform: MarketplaceId, overrides?: FeeOverrides): FeeRule {
  const base = DEFAULT_FEE_RULES[platform];
  const override = overrides?.[platform];
  if (!override) return base;

  const rate = (value: number | undefined, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0
      ? Math.min(value > 1 ? value / 100 : value, MAX_RATE)
      : fallback;
  const flat = (value: number | undefined, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0
      ? Math.min(Math.round(value), MAX_FLAT_CENTS)
      : fallback;

  return {
    ...base,
    commissionRate: rate(override.commissionRate, base.commissionRate),
    commissionFlatCents: flat(override.commissionFlatCents, base.commissionFlatCents),
    processingRate: rate(override.processingRate, base.processingRate),
    processingFlatCents: flat(override.processingFlatCents, base.processingFlatCents),
  };
}

/**
 * What the platform takes on a sale of `saleCents`. Never exceeds the sale
 * price — a flat fee on a $1 sale would otherwise imply the seller owes money,
 * which no platform actually does; they just take the lot.
 */
export function estimateFeeCents(
  platform: MarketplaceId,
  saleCents: number,
  overrides?: FeeOverrides,
): number {
  if (!Number.isFinite(saleCents) || saleCents <= 0) return 0;
  const rule = resolveFeeRule(platform, overrides);

  const commission =
    rule.smallOrder && saleCents < rule.smallOrder.underCents
      ? rule.smallOrder.flatCents
      : saleCents * rule.commissionRate + rule.commissionFlatCents;

  const processing = saleCents * rule.processingRate + rule.processingFlatCents;

  return Math.min(saleCents, Math.round(commission + processing));
}

/**
 * What actually reaches the seller: sale price, less the platform's cut, less
 * any shipping they absorbed. Can go negative — eating $12 of shipping on a $8
 * sale really is a loss, and rounding that up to zero would hide it.
 */
export function netProceedsCents(input: {
  saleCents: number;
  feeCents?: number | null;
  shippingCents?: number | null;
}): number {
  const sale = Number.isFinite(input.saleCents) ? input.saleCents : 0;
  return sale - (input.feeCents ?? 0) - (input.shippingCents ?? 0);
}

/**
 * Rank platforms by what the seller would clear on the same sale price. Powers
 * "you'd net $12 more on Vinted" — note it compares *fees only*, so it can't
 * know that a piece might sell faster or dearer somewhere else.
 */
export function compareNetByPlatform(
  saleCents: number,
  platforms: readonly MarketplaceId[],
  overrides?: FeeOverrides,
): { platform: MarketplaceId; feeCents: number; netCents: number }[] {
  return platforms
    .map((platform) => {
      const feeCents = estimateFeeCents(platform, saleCents, overrides);
      return { platform, feeCents, netCents: saleCents - feeCents };
    })
    .sort((a, b) => b.netCents - a.netCents || a.platform.localeCompare(b.platform));
}

/** How long before a rate is old enough that we should say so in settings. */
export const FEE_RATE_STALE_AFTER_DAYS = 180;

/** True when a platform's default rate hasn't been re-verified in a while. */
export function isFeeRuleStale(rule: FeeRule, nowMs: number): boolean {
  const asOfMs = Date.parse(rule.asOf);
  if (Number.isNaN(asOfMs)) return true;
  return nowMs - asOfMs > FEE_RATE_STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;
}
