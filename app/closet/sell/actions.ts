"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseColors, parseStringArray, parseStylePrefs } from "@/lib/json";
import { isMarketplaceId, sanitizeMarketplaceIds } from "@/lib/marketplaces";
import {
  buildListingDraft,
  isItemCondition,
  isSaleStatus,
  suggestedAskingCents,
  type ItemCondition,
  type SaleStatus,
} from "@/lib/sale-listing";
import { readFeeOverrides } from "@/lib/sell/fee-prefs";
import { estimateFeeCents } from "@/lib/sell/fees";

type Result = { ok: true } | { ok: false; error: string };

const TITLE_MAX = 140;
const DESCRIPTION_MAX = 4000;
const DEFAULT_CONDITION: ItemCondition = "good";

/**
 * Record a swipe decision. "keep" marks the item skipped; "sell" creates (or
 * revives) a for-sale listing pre-filled with a generated draft and a suggested
 * asking price so the review screen starts from something usable.
 */
export async function setSaleDecision(input: {
  itemId: string;
  decision: "sell" | "keep";
}): Promise<Result> {
  const user = await requireUser();
  const item = await prisma.wardrobeItem.findFirst({
    where: { id: input.itemId, userId: user.id },
    select: {
      name: true,
      brand: true,
      category: true,
      subcategory: true,
      colors: true,
      material: true,
      pattern: true,
      styleTags: true,
      priceCents: true,
      currency: true,
    },
  });
  if (!item) return { ok: false, error: "Item not found" };

  if (input.decision === "keep") {
    await prisma.saleListing.upsert({
      where: { itemId: input.itemId },
      update: { status: "skipped" satisfies SaleStatus },
      create: {
        userId: user.id,
        itemId: input.itemId,
        status: "skipped",
        marketplaces: "[]",
      },
    });
    revalidatePath("/closet/sell");
    revalidatePath("/closet/sell/triage");
    return { ok: true };
  }

  const draft = buildListingDraft(
    {
      name: item.name,
      brand: item.brand,
      category: item.category,
      subcategory: item.subcategory,
      colors: parseColors(item.colors),
      material: item.material,
      pattern: item.pattern,
      styleTags: parseStringArray(item.styleTags),
    },
    { condition: DEFAULT_CONDITION },
  );
  const asking = suggestedAskingCents(item.priceCents, DEFAULT_CONDITION);

  await prisma.saleListing.upsert({
    where: { itemId: input.itemId },
    // Re-selling an item that was previously skipped/sold flips it back to
    // for_sale but keeps any draft edits the user already made.
    update: { status: "for_sale" satisfies SaleStatus },
    create: {
      userId: user.id,
      itemId: input.itemId,
      status: "for_sale",
      condition: DEFAULT_CONDITION,
      askingCents: asking,
      currency: item.currency || "USD",
      title: draft.title,
      description: draft.description,
      marketplaces: "[]",
    },
  });
  revalidatePath("/closet/sell");
  revalidatePath("/closet/sell/triage");
  revalidatePath("/closet/sell/listings");
  return { ok: true };
}

/** Edit a listing's sale fields from the review screen. */
export async function updateSaleListing(input: {
  itemId: string;
  askingCents?: number | null;
  condition?: string | null;
  title?: string;
  description?: string;
  marketplaces?: string[];
}): Promise<Result> {
  const user = await requireUser();
  const existing = await prisma.saleListing.findUnique({
    where: { itemId: input.itemId },
    select: { userId: true },
  });
  if (!existing || existing.userId !== user.id) {
    return { ok: false, error: "Listing not found" };
  }

  const data: Record<string, unknown> = {};
  if (input.askingCents !== undefined) {
    data.askingCents =
      input.askingCents == null ? null : Math.max(0, Math.round(input.askingCents));
  }
  if (input.condition !== undefined) {
    data.condition =
      input.condition && isItemCondition(input.condition) ? input.condition : null;
  }
  if (input.title !== undefined) {
    data.title = input.title.trim().slice(0, TITLE_MAX) || null;
  }
  if (input.description !== undefined) {
    data.description = input.description.trim().slice(0, DESCRIPTION_MAX) || null;
  }
  if (input.marketplaces !== undefined) {
    data.marketplaces = JSON.stringify(sanitizeMarketplaceIds(input.marketplaces));
  }

  if (Object.keys(data).length === 0) return { ok: true };

  await prisma.saleListing.update({ where: { itemId: input.itemId }, data });
  revalidatePath("/closet/sell/listings");
  return { ok: true };
}

/**
 * Move a listing through its lifecycle (for_sale → listed → sold, etc.).
 * When marking sold, an optional soldPriceCents records the actual proceeds;
 * moving back out of "sold" clears any recorded price so it doesn't linger.
 */
export async function setSaleStatus(input: {
  itemId: string;
  status: string;
  soldPriceCents?: number | null;
}): Promise<Result> {
  const user = await requireUser();
  if (!isSaleStatus(input.status)) return { ok: false, error: "Invalid status" };
  const existing = await prisma.saleListing.findUnique({
    where: { itemId: input.itemId },
    select: { userId: true },
  });
  if (!existing || existing.userId !== user.id) {
    return { ok: false, error: "Listing not found" };
  }

  const data: { status: string; soldPriceCents?: number | null } = { status: input.status };
  if (input.status === "sold") {
    if (input.soldPriceCents !== undefined) {
      data.soldPriceCents =
        input.soldPriceCents == null ? null : Math.max(0, Math.round(input.soldPriceCents));
    }
  } else {
    data.soldPriceCents = null;
  }

  await prisma.saleListing.update({ where: { itemId: input.itemId }, data });
  revalidatePath("/closet/sell");
  revalidatePath("/closet/sell/triage");
  revalidatePath("/closet/sell/listings");
  return { ok: true };
}

/** Drop the listing entirely so the item returns to the swipe deck. */
export async function removeSaleListing(itemId: string): Promise<Result> {
  const user = await requireUser();
  const existing = await prisma.saleListing.findUnique({
    where: { itemId },
    select: { userId: true },
  });
  if (!existing || existing.userId !== user.id) {
    return { ok: false, error: "Listing not found" };
  }
  await prisma.saleListing.delete({ where: { itemId } });
  revalidatePath("/closet/sell");
  revalidatePath("/closet/sell/triage");
  revalidatePath("/closet/sell/listings");
  return { ok: true };
}

type BulkResult = { ok: true; count: number } | { ok: false; error: string };

/**
 * Apply a lifecycle status to several listings at once (board bulk triage).
 * Scoped to the caller's own listings; "sold" is intentionally excluded — it
 * needs a per-item sale price, so it stays on the single-item flow.
 */
export async function bulkSetSaleStatus(input: {
  itemIds: string[];
  status: string;
}): Promise<BulkResult> {
  const user = await requireUser();
  if (!isSaleStatus(input.status)) return { ok: false, error: "Invalid status" };
  if (input.status === "sold") {
    return { ok: false, error: "Mark items sold one at a time to record the sale price." };
  }
  if (input.itemIds.length === 0) return { ok: true, count: 0 };

  const res = await prisma.saleListing.updateMany({
    where: { userId: user.id, itemId: { in: input.itemIds } },
    data: { status: input.status, soldPriceCents: null },
  });
  revalidatePath("/closet/sell");
  revalidatePath("/closet/sell/triage");
  revalidatePath("/closet/sell/listings");
  return { ok: true, count: res.count };
}

/** Remove several listings at once; the items return to the swipe deck. */
export async function bulkRemoveSaleListings(itemIds: string[]): Promise<BulkResult> {
  const user = await requireUser();
  if (itemIds.length === 0) return { ok: true, count: 0 };
  const res = await prisma.saleListing.deleteMany({
    where: { userId: user.id, itemId: { in: itemIds } },
  });
  revalidatePath("/closet/sell");
  revalidatePath("/closet/sell/triage");
  revalidatePath("/closet/sell/listings");
  return { ok: true, count: res.count };
}

/**
 * Record a completed sale against a specific marketplace.
 *
 * This is the write behind "Log a sale" — the one place per-platform truth
 * enters the system. It does two things at once: flips the listing to sold
 * (so the board and totals agree), and writes the placement row that every
 * per-platform and time-to-sell number reads from.
 *
 * `feeCents` is optional. When the user didn't supply one we fall back to the
 * platform's rate and mark the row `feeEstimated`, so the UI can be honest
 * about which net figures are measured and which are inferred.
 */
export async function logSale(input: {
  itemId: string;
  platform: string;
  soldPriceCents: number;
  feeCents?: number | null;
  shippingCents?: number | null;
  soldAtMs?: number | null;
  listedAtMs?: number | null;
  externalUrl?: string | null;
}): Promise<Result> {
  const user = await requireUser();
  if (!isMarketplaceId(input.platform)) return { ok: false, error: "Unknown marketplace" };

  const sold = Math.max(0, Math.round(input.soldPriceCents));
  if (!Number.isFinite(sold)) return { ok: false, error: "Enter a sale price" };

  const listing = await prisma.saleListing.findUnique({
    where: { itemId: input.itemId },
    select: { id: true, userId: true, currency: true },
  });
  if (!listing || listing.userId !== user.id) return { ok: false, error: "Listing not found" };

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { stylePrefs: true },
  });
  const overrides = readFeeOverrides(parseStylePrefs(dbUser?.stylePrefs));

  const feeGiven = input.feeCents != null && Number.isFinite(input.feeCents);
  const feeCents = feeGiven
    ? Math.max(0, Math.round(input.feeCents as number))
    : estimateFeeCents(input.platform, sold, overrides);

  const shippingCents =
    input.shippingCents != null && Number.isFinite(input.shippingCents)
      ? Math.max(0, Math.round(input.shippingCents))
      : null;

  // A sale needs a date to count toward time-to-sell; default to now rather
  // than leaving it null, since the user is logging it as it happens.
  const soldAt = input.soldAtMs ? new Date(input.soldAtMs) : new Date();
  const listedAt = input.listedAtMs ? new Date(input.listedAtMs) : undefined;

  const placementData = {
    status: "sold",
    soldPriceCents: sold,
    feeCents,
    feeEstimated: !feeGiven,
    shippingCents,
    soldAt,
    currency: listing.currency || "USD",
    externalUrl: input.externalUrl?.trim() || null,
    ...(listedAt ? { listedAt } : {}),
  };

  await prisma.$transaction([
    prisma.listingPlacement.upsert({
      where: { listingId_platform: { listingId: listing.id, platform: input.platform } },
      update: placementData,
      create: {
        userId: user.id,
        listingId: listing.id,
        platform: input.platform,
        ...placementData,
      },
    }),
    // Anywhere else it was cross-posted is no longer for sale — it's gone.
    prisma.listingPlacement.updateMany({
      where: {
        listingId: listing.id,
        platform: { not: input.platform },
        status: { in: ["draft", "listed"] },
      },
      data: { status: "ended" },
    }),
    prisma.saleListing.update({
      where: { id: listing.id },
      data: { status: "sold" satisfies SaleStatus, soldPriceCents: sold },
    }),
  ]);

  revalidatePath("/closet/sell");
  revalidatePath("/closet/sell/triage");
  revalidatePath("/closet/sell/listings");
  return { ok: true };
}

/**
 * Mark a listing live on a marketplace. Sets `listedAt` the first time only —
 * re-listing shouldn't reset the clock that time-to-sell measures against.
 */
export async function setPlacementListed(input: {
  itemId: string;
  platform: string;
  externalUrl?: string | null;
}): Promise<Result> {
  const user = await requireUser();
  if (!isMarketplaceId(input.platform)) return { ok: false, error: "Unknown marketplace" };

  const listing = await prisma.saleListing.findUnique({
    where: { itemId: input.itemId },
    select: { id: true, userId: true, askingCents: true, currency: true },
  });
  if (!listing || listing.userId !== user.id) return { ok: false, error: "Listing not found" };

  const existing = await prisma.listingPlacement.findUnique({
    where: { listingId_platform: { listingId: listing.id, platform: input.platform } },
    select: { id: true, listedAt: true },
  });

  const externalUrl = input.externalUrl?.trim() || null;
  if (existing) {
    await prisma.listingPlacement.update({
      where: { id: existing.id },
      data: {
        status: "listed",
        externalUrl,
        ...(existing.listedAt ? {} : { listedAt: new Date() }),
      },
    });
  } else {
    await prisma.listingPlacement.create({
      data: {
        userId: user.id,
        listingId: listing.id,
        platform: input.platform,
        status: "listed",
        askingCents: listing.askingCents,
        currency: listing.currency || "USD",
        listedAt: new Date(),
        externalUrl,
      },
    });
  }

  revalidatePath("/closet/sell");
  revalidatePath("/closet/sell/listings");
  return { ok: true };
}
