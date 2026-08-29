/**
 * Load the space ledger for a user.
 *
 * One query pair, shared by the closet header (which needs only this month's
 * departure count, to size the wordmark's gap) and the Space page (which needs
 * the whole thing). Separate reads would have meant the header and the page
 * disagreeing about the same month whenever a sale landed between them.
 *
 * A server-only read module rather than a `"use server"` action, following
 * lib/server/category-shapes.ts: nothing here mutates and nothing needs to be
 * callable from the client, so it should not be exposed as an action endpoint.
 *
 * The arithmetic all lives in lib/space/ledger.ts, which is pure and tested.
 * This file is only responsible for turning rows into the flat shapes that
 * module expects — in particular for deciding *when* a sale happened.
 */

import { prisma } from "@/lib/db";
import { decode, type StylePrefs } from "@/lib/json";
import type { GarmentKind } from "@/lib/categories";
import {
  buildSpaceLedger,
  ledgerByMonth,
  type LedgerArrival,
  type LedgerDeparture,
  type LedgerMonth,
  type SpaceLedger,
} from "@/lib/space/ledger";
import { startOfMonthMs } from "@/lib/sell/metrics";

/** How much history the year view shows. */
export const SPACE_MONTHS = 12;

export type SpaceSnapshot = {
  /** The calendar month `nowMs` falls in. */
  month: SpaceLedger;
  /** Everything, ever — the all-time reading. */
  allTime: SpaceLedger;
  /** Trailing `SPACE_MONTHS` months, oldest first. */
  months: LedgerMonth[];
  /** Pieces in the closet right now. Context for the net figure. */
  ownedCount: number;
  nowMs: number;
};

export async function loadSpaceSnapshot(
  userId: string,
  nowMs: number = Date.now(),
): Promise<SpaceSnapshot> {
  const [prefsRow, items, soldListings] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { stylePrefs: true } }),
    prisma.wardrobeItem.findMany({
      // Wishlist pieces are not owned, so they never arrived and can never
      // leave — counting them would put "in" numbers on a browsing session.
      where: { userId, isWishlist: false },
      select: { createdAt: true },
    }),
    prisma.saleListing.findMany({
      // A sold listing is the authoritative record that a sale happened — the
      // same rule lib/sell/metrics.ts runs on. Placements only add where and
      // when, and a listing with no sold placement is still a real departure.
      where: { userId, status: "sold" },
      select: {
        soldPriceCents: true,
        item: { select: { category: true, subcategory: true, name: true } },
        placements: {
          where: { status: "sold" },
          select: { soldAt: true },
        },
      },
    }),
  ]);

  const prefs = decode<StylePrefs>(prefsRow?.stylePrefs, {});
  const categoryShapes = (prefs.categoryShapes ?? {}) as Record<string, GarmentKind>;

  const arrivals: LedgerArrival[] = items.map((i) => ({ createdAtMs: i.createdAt.getTime() }));

  const departures: LedgerDeparture[] = soldListings.map((listing) => ({
    /*
     * The earliest sold placement, not the latest: cross-posting means one
     * garment can be marked sold on two platforms, and the first of those is
     * when it actually left the closet. Null when no placement carries a date,
     * which the ledger reports as undated rather than guessing.
     */
    soldAtMs: earliestSoldAtMs(listing.placements),
    grossCents: listing.soldPriceCents ?? 0,
    category: listing.item.category,
    subcategory: listing.item.subcategory,
    name: listing.item.name,
  }));

  const monthStart = startOfMonthMs(nowMs);

  return {
    month: buildSpaceLedger({
      arrivals,
      departures,
      fromMs: monthStart,
      toMs: nowMs,
      categoryShapes,
    }),
    allTime: buildSpaceLedger({
      arrivals,
      departures,
      // 0 rather than the earliest row: the window is "everything", and
      // deriving a floor from the data would drop a row with a bad timestamp.
      fromMs: 0,
      toMs: nowMs,
      categoryShapes,
      // An undated sale can't be claimed for a month, but it is certainly
      // inside "ever" — leaving it out here would understate real departures.
      countUndated: true,
    }),
    months: ledgerByMonth({ arrivals, departures, nowMs, months: SPACE_MONTHS }),
    ownedCount: items.length,
    nowMs,
  };
}

function earliestSoldAtMs(placements: readonly { soldAt: Date | null }[]): number | null {
  let earliest: number | null = null;
  for (const p of placements) {
    if (!p.soldAt) continue;
    const ms = p.soldAt.getTime();
    if (earliest == null || ms < earliest) earliest = ms;
  }
  return earliest;
}
