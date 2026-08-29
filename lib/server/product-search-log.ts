/**
 * Record a product search so the bill is visible.
 *
 * Every other paid call in the app lands in a ledger the Settings page totals.
 * Product search did not: SerpAPI charges per request, `searchProducts` had no
 * guardrail, and the quietest path was the most expensive — "Check prices" on
 * the wishlist issues one search per watched item, so a twenty-item list was a
 * twenty-search click that reported nothing anywhere.
 *
 * A server-only read/write module rather than a `"use server"` action, following
 * lib/server/category-shapes.ts: nothing here should be callable from a browser.
 *
 * Best-effort by design. A failure to write the ledger row must never fail the
 * search the user asked for — the row is bookkeeping, the search is the feature.
 */

import { prisma } from "@/lib/db";
import { log } from "@/lib/log";
import type { SearchProvider, WebProductSearch } from "@/lib/services/webProductSearch";

/**
 * What one SerpAPI search costs, in tenths of a US cent.
 *
 * From `SERPAPI_COST_TENTH_CENTS`, and **zero when unset** — deliberately. The
 * price depends on which SerpAPI plan you are on, and this codebase's standing
 * rule is that a guess is never presented as a fact (see lib/sell/metrics.ts).
 * So with nothing configured the ledger reports the count and no dollar figure,
 * which is exactly what is known.
 */
export function serpSearchCostTenthCents(): number {
  const raw = (process.env.SERPAPI_COST_TENTH_CENTS ?? "").trim();
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/**
 * Log one search.
 *
 * Cache hits are recorded with `cached: true` and zero cost rather than skipped:
 * the number of billed searches the cache avoided is the main thing anyone would
 * want from this table, and it cannot be derived from rows that were never
 * written.
 *
 * Only the SerpAPI lane carries a cost. Gemini identification is billed through
 * the generation ledger, and the stub is free.
 */
export async function recordProductSearch(
  userId: string,
  result: Pick<WebProductSearch, "provider" | "cached"> & { resultCount: number },
): Promise<void> {
  const billed = result.provider === "serpapi" && !result.cached;
  try {
    await prisma.productSearchEvent.create({
      data: {
        userId,
        provider: result.provider,
        cached: result.cached,
        resultCount: result.resultCount,
        costTenthCents: billed ? serpSearchCostTenthCents() : 0,
      },
    });
  } catch (err) {
    log.error("product-search.log.failed", err, { provider: result.provider });
  }
}

/** Convenience for the common shape returned by `searchWebProductsDetailed`. */
export async function recordSearchResult(
  userId: string,
  result: WebProductSearch,
): Promise<void> {
  await recordProductSearch(userId, {
    provider: result.provider,
    cached: result.cached,
    resultCount: result.matches.length,
  });
}

export type ProductSearchSpend = {
  /** Every recorded search, cache hits included. */
  total: number;
  /** Searches that actually went out to SerpAPI and were billed. */
  billed: number;
  /** Searches the cache answered for free. */
  cached: number;
  tenthCents: number;
  /** False when SERPAPI_COST_TENTH_CENTS is unset, so the UI can omit a total. */
  priced: boolean;
  byProvider: { provider: SearchProvider; searches: number }[];
};

/** The searches side of the Settings spend panel. */
export async function loadProductSearchSpend(userId: string): Promise<ProductSearchSpend> {
  const rows = await prisma.productSearchEvent.findMany({
    where: { userId },
    select: { provider: true, cached: true, costTenthCents: true },
  });

  const byProvider = new Map<string, number>();
  let billed = 0;
  let cached = 0;
  let tenthCents = 0;
  for (const row of rows) {
    byProvider.set(row.provider, (byProvider.get(row.provider) ?? 0) + 1);
    if (row.cached) cached += 1;
    else if (row.provider === "serpapi") billed += 1;
    tenthCents += row.costTenthCents;
  }

  return {
    total: rows.length,
    billed,
    cached,
    tenthCents,
    priced: serpSearchCostTenthCents() > 0,
    byProvider: [...byProvider.entries()]
      .map(([provider, searches]) => ({ provider: provider as SearchProvider, searches }))
      .sort((a, b) => b.searches - a.searches),
  };
}
