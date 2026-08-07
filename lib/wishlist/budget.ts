/**
 * Budget math for the wishlist. Pure — no Prisma, no I/O — so the page, the
 * server actions and the tests all agree on one set of numbers.
 *
 * The model is "planned vs spent":
 *   funds     = the pot you were given (+ resale proceeds, when the budget is
 *               funded by sales)
 *   spent     = what wishlist items actually cost when you marked them bought
 *   planned   = sticker price of everything still on the list
 *   remaining = funds - spent          → what's genuinely left to spend
 *   uncommitted = remaining - planned  → negative means the list outruns the money
 */

import { normalizePriority, type WishlistPriority } from "./priority";

/** Minimal shape the math needs; both wishlist and purchased items use it. */
export type BudgetLineItem = {
  id: string;
  /** Retail sticker price, in cents. Null when we couldn't resolve one. */
  priceCents: number | null;
  /** Set once bought. */
  purchasedAt: Date | string | null;
  /** What was actually paid, if it differed from the sticker. */
  purchasedCents: number | null;
  wishlistPriority: number | null;
};

export type BudgetSummary = {
  /** The pot as configured by the user. */
  potCents: number;
  /** Resale proceeds folded in (0 when the budget isn't funded by sales). */
  salesCents: number;
  /** potCents + salesCents. */
  fundsCents: number;
  spentCents: number;
  plannedCents: number;
  remainingCents: number;
  uncommittedCents: number;
  /** Wishlist items with no resolved price — planned is an undercount by this many. */
  unpricedCount: number;
  purchasedCount: number;
  plannedCount: number;
  /** remaining as a 0..1 fraction of funds; 0 when there are no funds. */
  remainingFraction: number;
  /** True when the still-unbought list costs more than what's left. */
  overCommitted: boolean;
  /** True when purchases alone have blown past the pot. */
  overspent: boolean;
};

/** What an item actually drew from the pot. Falls back to the sticker price. */
export function drawdownCents(item: BudgetLineItem): number {
  if (item.purchasedCents != null && item.purchasedCents > 0) return item.purchasedCents;
  if (item.priceCents != null && item.priceCents > 0) return item.priceCents;
  return 0;
}

export function isPurchased(item: BudgetLineItem): boolean {
  return item.purchasedAt != null;
}

export function computeBudgetSummary(input: {
  potCents: number;
  salesCents?: number;
  items: readonly BudgetLineItem[];
}): BudgetSummary {
  const potCents = Math.max(0, Math.round(input.potCents || 0));
  const salesCents = Math.max(0, Math.round(input.salesCents ?? 0));
  const fundsCents = potCents + salesCents;

  let spentCents = 0;
  let plannedCents = 0;
  let unpricedCount = 0;
  let purchasedCount = 0;
  let plannedCount = 0;

  for (const item of input.items) {
    if (isPurchased(item)) {
      spentCents += drawdownCents(item);
      purchasedCount += 1;
      continue;
    }
    plannedCount += 1;
    const price = item.priceCents ?? 0;
    if (price > 0) plannedCents += price;
    else unpricedCount += 1;
  }

  const remainingCents = fundsCents - spentCents;

  return {
    potCents,
    salesCents,
    fundsCents,
    spentCents,
    plannedCents,
    remainingCents,
    uncommittedCents: remainingCents - plannedCents,
    unpricedCount,
    purchasedCount,
    plannedCount,
    remainingFraction: fundsCents > 0 ? Math.max(0, Math.min(1, remainingCents / fundsCents)) : 0,
    overCommitted: plannedCents > remainingCents,
    overspent: spentCents > fundsCents,
  };
}

export type AffordabilityRow<T extends BudgetLineItem> = {
  item: T;
  /** Sticker prices of this item and everything ranked above it. */
  cumulativeCents: number;
  /** True while the running total still fits inside what's left. */
  affordable: boolean;
};

/**
 * Walk the unbought list in buy order (priority, then cheapest first so a
 * cheap must-have never gets stranded behind an expensive one) and mark where
 * the money runs out. Unpriced items are treated as free — they can't be
 * ranked honestly, so they never push a priced item below the line.
 */
export function rankByAffordability<T extends BudgetLineItem>(
  items: readonly T[],
  remainingCents: number,
): AffordabilityRow<T>[] {
  const ordered = [...items].filter((i) => !isPurchased(i)).sort(compareBuyOrder);

  let cumulative = 0;
  return ordered.map((item) => {
    cumulative += Math.max(0, item.priceCents ?? 0);
    return { item, cumulativeCents: cumulative, affordable: cumulative <= remainingCents };
  });
}

/** Buy order: most urgent first, then cheapest, then stable by id. */
export function compareBuyOrder(a: BudgetLineItem, b: BudgetLineItem): number {
  const pa = normalizePriority(a.wishlistPriority);
  const pb = normalizePriority(b.wishlistPriority);
  if (pa !== pb) return pa - pb;

  const ca = a.priceCents ?? Number.MAX_SAFE_INTEGER;
  const cb = b.priceCents ?? Number.MAX_SAFE_INTEGER;
  if (ca !== cb) return ca - cb;

  return a.id.localeCompare(b.id);
}

/** Sum of unbought items in a single priority tier. */
export function plannedCentsForPriority(
  items: readonly BudgetLineItem[],
  priority: WishlistPriority,
): number {
  return items
    .filter((i) => !isPurchased(i) && normalizePriority(i.wishlistPriority) === priority)
    .reduce((sum, i) => sum + Math.max(0, i.priceCents ?? 0), 0);
}
