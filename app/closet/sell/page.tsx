import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseStylePrefs } from "@/lib/json";
import { isMarketplaceId, type MarketplaceId } from "@/lib/marketplaces";
import { suggestedAskingCents, isStaleListing, type ItemCondition } from "@/lib/sale-listing";
import { readFeeOverrides } from "@/lib/sell/fee-prefs";
import { estimateFeeCents } from "@/lib/sell/fees";
import {
  earnedBetween,
  earningsSummary,
  opportunitySize,
  overallAvgDaysToSell,
  platformBreakdown,
  startOfMonthMs,
  type MetricPlacement,
} from "@/lib/sell/metrics";
import { getClosetLenses } from "@/lib/actions/closet-lenses";
import { SellLanding } from "./sell-landing";

export const dynamic = "force-dynamic";

export default async function SellPage() {
  const user = await requireUser();
  const nowMs = Date.now();

  const [dbUser, untriaged, listings, placementRows, lenses] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: { stylePrefs: true } }),
    // Pieces with no sale decision yet — the triage queue, and the raw material
    // for "still on the table".
    prisma.wardrobeItem.findMany({
      where: { userId: user.id, isWishlist: false, saleListing: { is: null } },
      select: { id: true, priceCents: true },
    }),
    prisma.saleListing.findMany({
      where: { userId: user.id, status: { in: ["for_sale", "listed", "sold"] } },
      select: {
        id: true,
        itemId: true,
        status: true,
        askingCents: true,
        soldPriceCents: true,
        condition: true,
        currency: true,
        updatedAt: true,
        item: { select: { name: true, brand: true } },
      },
    }),
    prisma.listingPlacement.findMany({
      where: { userId: user.id },
      select: {
        listingId: true,
        platform: true,
        status: true,
        soldPriceCents: true,
        feeCents: true,
        shippingCents: true,
        listedAt: true,
        soldAt: true,
      },
    }),
    getClosetLenses(),
  ]);

  const feeOverrides = readFeeOverrides(parseStylePrefs(dbUser?.stylePrefs));

  // Drop any placement whose platform we no longer recognise rather than
  // letting an unknown id reach the mark lookup and render as a blank row.
  const placements: MetricPlacement[] = placementRows
    .filter((p): p is typeof p & { platform: MarketplaceId } => isMarketplaceId(p.platform))
    .map((p) => ({
      listingId: p.listingId,
      platform: p.platform,
      status: p.status,
      soldPriceCents: p.soldPriceCents,
      // No recorded fee means we never captured one; fall back to our estimate
      // so net isn't overstated, and let the UI say it's an estimate.
      feeCents:
        p.feeCents ??
        (p.status === "sold" && p.soldPriceCents
          ? estimateFeeCents(p.platform, p.soldPriceCents, feeOverrides)
          : null),
      shippingCents: p.shippingCents,
      listedAtMs: p.listedAt?.getTime() ?? null,
      soldAtMs: p.soldAt?.getTime() ?? null,
    }));

  const soldListings = listings.filter((l) => l.status === "sold");
  const activeListings = listings.filter(
    (l) => l.status === "for_sale" || l.status === "listed",
  );

  const earnings = earningsSummary({
    soldListings: soldListings.map((l) => ({
      listingId: l.id,
      soldPriceCents: l.soldPriceCents,
    })),
    placements,
  });

  const thisMonth = earnedBetween(placements, startOfMonthMs(nowMs), nowMs);

  const opportunity = opportunitySize({
    untriaged: untriaged.map((i) => ({ retailCents: i.priceCents })),
    active: activeListings.map((l) => ({ askingCents: l.askingCents })),
    // Untriaged pieces have no condition yet, so the estimate assumes "good" —
    // the same default the swipe deck applies when you mark something to sell.
    estimateCents: (retailCents) => suggestedAskingCents(retailCents, "good" as ItemCondition),
  });

  const timing = overallAvgDaysToSell(placements);
  const staleCount = listings.filter((l) =>
    isStaleListing({ status: l.status, updatedAtMs: l.updatedAt.getTime() }, nowMs),
  ).length;

  return (
    <SellLanding
      earnings={earnings}
      thisMonth={thisMonth}
      opportunity={opportunity}
      platforms={platformBreakdown(placements)}
      timing={timing}
      counts={{
        forSale: listings.filter((l) => l.status === "for_sale").length,
        listed: listings.filter((l) => l.status === "listed").length,
        sold: soldListings.length,
        untriaged: untriaged.length,
      }}
      staleCount={staleCount}
      currency={listings.find((l) => l.currency)?.currency || "USD"}
      // Only pieces still working can be logged as sold — an already-sold one
      // is corrected from the listings board, not logged again here.
      sellable={activeListings.map((l) => ({
        itemId: l.itemId,
        label: [l.item.brand, l.item.name].filter(Boolean).join(" ") || l.item.name,
        askingCents: l.askingCents,
      }))}
      lenses={lenses}
    />
  );
}
