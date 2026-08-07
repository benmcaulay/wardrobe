/**
 * Closet gap analysis: which categories the wardrobe is thin in, which it's
 * already saturated in, and — for each wishlist item — whether buying it fills
 * a hole or piles onto a stack you already own.
 *
 * Pure. Callers pass plain counts so this stays trivially testable.
 */

import { isNoneCategoryStored } from "../categories";

export type OwnedSummary = { category: string };
export type WishlistSummary = { id: string; category: string };

export type CoverageStatus = "gap" | "thin" | "covered" | "saturated";

export type CategoryCoverage = {
  category: string;
  owned: number;
  wishlisted: number;
  status: CoverageStatus;
};

export type ItemVerdict = "fills-gap" | "duplicates" | "neutral";

export type GapReport = {
  coverage: CategoryCoverage[];
  /** Categories with nothing (or almost nothing) in them, worst first. */
  gaps: CategoryCoverage[];
  /** Categories you already have plenty of. */
  saturated: CategoryCoverage[];
  /** itemId → whether this purchase fills a hole or doubles up. */
  verdicts: Record<string, ItemVerdict>;
  /** Median owned-per-category, the anchor for "saturated". */
  medianOwned: number;
};

const THIN_MAX = 2;
/** Below this you're never "stocked up", however lopsided the closet is. */
const SATURATED_MIN = 5;
/** Owning this many of one thing is plenty on its own terms. */
const SATURATED_ABSOLUTE = 12;
const SATURATED_MULTIPLE = 2;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function normalize(category: string): string {
  return category.trim().toLowerCase();
}

/**
 * The "None" bucket is the absence of a category, not a wardrobe hole — an
 * uncategorised pile would otherwise read as a gap worth spending on, and an
 * uncategorised wishlist item would get a verdict its category can't support.
 */
function isUsableCategory(category: string): boolean {
  return !isNoneCategoryStored(category);
}

/**
 * @param owned      Items actually in the closet (exclude wishlist + sold).
 * @param wishlist   Unbought wishlist items.
 * @param categories The user's category roster — categories with zero owned
 *                   items only surface as gaps if they're on this list, so a
 *                   typo'd one-off category doesn't read as a hole.
 */
export function analyzeCloset(input: {
  owned: readonly OwnedSummary[];
  wishlist: readonly WishlistSummary[];
  categories: readonly string[];
}): GapReport {
  const ownedCounts = new Map<string, number>();
  const labels = new Map<string, string>();

  for (const c of input.categories) {
    const key = normalize(c);
    if (!key || !isUsableCategory(c)) continue;
    if (!ownedCounts.has(key)) ownedCounts.set(key, 0);
    if (!labels.has(key)) labels.set(key, c.trim());
  }
  for (const item of input.owned) {
    const key = normalize(item.category);
    if (!key || !isUsableCategory(item.category)) continue;
    ownedCounts.set(key, (ownedCounts.get(key) ?? 0) + 1);
    if (!labels.has(key)) labels.set(key, item.category.trim());
  }

  const wishCounts = new Map<string, number>();
  for (const item of input.wishlist) {
    const key = normalize(item.category);
    if (!key || !isUsableCategory(item.category)) continue;
    wishCounts.set(key, (wishCounts.get(key) ?? 0) + 1);
    if (!ownedCounts.has(key)) ownedCounts.set(key, 0);
    if (!labels.has(key)) labels.set(key, item.category.trim());
  }

  // Median over categories that actually hold something — otherwise a roster
  // full of empty categories drags the anchor to zero and everything reads
  // as saturated.
  const nonEmpty = [...ownedCounts.values()].filter((n) => n > 0);
  const medianOwned = median(nonEmpty);

  const coverage: CategoryCoverage[] = [...ownedCounts.entries()]
    .map(([key, owned]) => ({
      category: labels.get(key) ?? key,
      owned,
      wishlisted: wishCounts.get(key) ?? 0,
      status: statusFor(owned, medianOwned),
    }))
    .sort((a, b) => a.owned - b.owned || a.category.localeCompare(b.category));

  const verdicts: Record<string, ItemVerdict> = {};
  for (const item of input.wishlist) {
    if (!isUsableCategory(item.category)) {
      verdicts[item.id] = "neutral";
      continue;
    }
    const owned = ownedCounts.get(normalize(item.category)) ?? 0;
    const status = statusFor(owned, medianOwned);
    verdicts[item.id] =
      status === "gap" || status === "thin"
        ? "fills-gap"
        : status === "saturated"
          ? "duplicates"
          : "neutral";
  }

  return {
    coverage,
    gaps: coverage.filter((c) => c.status === "gap" || c.status === "thin"),
    saturated: coverage.filter((c) => c.status === "saturated"),
    verdicts,
    medianOwned,
  };
}

/**
 * "Saturated" needs two escape hatches. A relative test alone (owned vs. the
 * median category) can't fire in a closet with only a couple of populated
 * categories — the median sits right on top of the biggest stack. An absolute
 * test alone would call a well-rounded closet overstocked. So: a dozen of one
 * thing is plenty outright, and below that it takes both a real count and a
 * count well above the typical category.
 */
function statusFor(owned: number, medianOwned: number): CoverageStatus {
  if (owned === 0) return "gap";

  const stockedOutright = owned >= SATURATED_ABSOLUTE;
  const stockedRelative = owned >= SATURATED_MIN && owned >= medianOwned * SATURATED_MULTIPLE;
  if (stockedOutright || stockedRelative) return "saturated";

  if (owned <= THIN_MAX) return "thin";
  return "covered";
}
