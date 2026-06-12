"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseColors, parseStringArray } from "@/lib/json";
import { sanitizeMarketplaceIds } from "@/lib/marketplaces";
import {
  buildListingDraft,
  isItemCondition,
  isSaleStatus,
  suggestedAskingCents,
  type ItemCondition,
  type SaleStatus,
} from "@/lib/sale-listing";

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
  revalidatePath("/closet/sell/listings");
  return { ok: true };
}
