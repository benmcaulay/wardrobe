/**
 * Where a user's fee corrections live: under `stylePrefs.marketplaceFees`,
 * following the same pattern as owners and hidden filters — one JSON blob on
 * the user row rather than a table, since it's a handful of numbers that only
 * ever load with the user.
 */
import { isMarketplaceId, type MarketplaceId } from "@/lib/marketplaces";
import type { FeeOverride, FeeOverrides } from "./fees";

const KEY = "marketplaceFees";

const NUMERIC_FIELDS = [
  "commissionRate",
  "commissionFlatCents",
  "processingRate",
  "processingFlatCents",
] as const;

/**
 * Pull fee overrides out of parsed style prefs, discarding anything that isn't
 * a known platform with finite numbers. `resolveFeeRule` clamps the values
 * themselves; this only guarantees the shape.
 */
export function readFeeOverrides(prefs: Record<string, unknown> | null | undefined): FeeOverrides {
  const raw = prefs?.[KEY];
  if (!raw || typeof raw !== "object") return {};

  const out: FeeOverrides = {};
  for (const [platform, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isMarketplaceId(platform) || !value || typeof value !== "object") continue;
    const override: FeeOverride = {};
    for (const field of NUMERIC_FIELDS) {
      const n = (value as Record<string, unknown>)[field];
      if (typeof n === "number" && Number.isFinite(n) && n >= 0) override[field] = n;
    }
    if (Object.keys(override).length > 0) out[platform as MarketplaceId] = override;
  }
  return out;
}

/** Merge one platform's override into prefs, dropping it when emptied. */
export function writeFeeOverride(
  prefs: Record<string, unknown>,
  platform: MarketplaceId,
  override: FeeOverride | null,
): Record<string, unknown> {
  const current = readFeeOverrides(prefs);
  if (override && Object.keys(override).length > 0) current[platform] = override;
  else delete current[platform];
  return { ...prefs, [KEY]: current };
}
