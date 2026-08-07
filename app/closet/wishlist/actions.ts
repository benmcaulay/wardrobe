"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { NONE_CATEGORY } from "@/lib/categories";
import { encode, parseStylePrefs } from "@/lib/json";
import { getPrimaryOwnerId, resolveItemOwnerIds } from "@/lib/owners";
import { saveImageBuffer, deleteUpload, UploadError } from "@/lib/uploads";
import { searchWebProducts } from "@/lib/services/webProductSearch";
import type { ProductMatch } from "@/lib/services/reverseImageSearch";
import { normalizePriority } from "@/lib/wishlist/priority";
import { appendPricePoint, parsePriceHistory } from "@/lib/wishlist/price-watch";
import {
  recheckPriceCents,
  resolveSearchMatch,
  resolveWishlistProduct,
} from "@/lib/wishlist/resolve";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_FETCH_TIMEOUT_MS = 20_000;

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { value?: never } : { value: T }))
  | { ok: false; error: string };

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/* ------------------------------------------------------------------ budget */

export async function saveBudget(input: {
  name: string;
  amountDollars: number;
  fundedBySales: boolean;
}): Promise<ActionResult<{ budgetId: string }>> {
  const user = await requireUser();

  const name = input.name.trim() || "Wishlist budget";
  const amountCents = Math.round((Number(input.amountDollars) || 0) * 100);
  if (!Number.isFinite(amountCents) || amountCents < 0) {
    return fail("Enter a budget amount of zero or more.");
  }

  const existing = await prisma.budget.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  const budget = existing
    ? await prisma.budget.update({
        where: { id: existing.id },
        data: { name, amountCents, fundedBySales: input.fundedBySales },
      })
    : await prisma.budget.create({
        data: { userId: user.id, name, amountCents, fundedBySales: input.fundedBySales },
      });

  // Adopt any wishlist items that predate the budget so the meter isn't empty
  // on first save.
  await prisma.wardrobeItem.updateMany({
    where: { userId: user.id, isWishlist: true, budgetId: null },
    data: { budgetId: budget.id },
  });

  revalidatePath("/closet/wishlist");
  return { ok: true, value: { budgetId: budget.id } };
}

/* ------------------------------------------------------------ adding items */

export type WishlistPreview = {
  name: string;
  brand: string | null;
  priceCents: number | null;
  currency: string;
  retailer: string | null;
  productUrl: string;
  imageUrl: string | null;
  priceSource: "merchant" | "shopping-search" | "none";
};

/** Read a pasted store link without committing it, so the user can confirm. */
export async function previewFromUrl(url: string): Promise<ActionResult<WishlistPreview>> {
  await requireUser();
  const resolved = await resolveWishlistProduct(url);
  if (!resolved.ok) return fail(resolved.error);

  const p = resolved.product;
  return {
    ok: true,
    value: {
      name: p.name,
      brand: p.brand,
      priceCents: p.priceCents,
      currency: p.currency,
      retailer: p.retailer,
      productUrl: p.productUrl,
      imageUrl: p.imageUrl,
      priceSource: p.priceSource,
    },
  };
}

export async function searchProducts(query: string): Promise<ActionResult<ProductMatch[]>> {
  await requireUser();
  const q = query.trim();
  if (!q) return fail("Enter something to search for.");
  try {
    return { ok: true, value: await searchWebProducts(q) };
  } catch (err) {
    return fail((err as Error).message || "Search failed.");
  }
}

export type AddWishlistInput = {
  name: string;
  brand: string | null;
  priceCents: number | null;
  currency: string;
  retailer: string | null;
  productUrl: string | null;
  imageUrl: string | null;
  category?: string;
  priority: number;
  notes?: string;
};

export async function addWishlistItem(
  input: AddWishlistInput,
): Promise<ActionResult<{ itemId: string }>> {
  const user = await requireUser();

  const name = input.name.trim();
  if (!name) return fail("Give it a name.");

  const imageUrl = input.imageUrl?.trim();
  if (!imageUrl) {
    return fail("No product photo found. Pick a different listing or add the item from a photo.");
  }

  let saved;
  try {
    saved = await downloadImage(imageUrl, user.id);
  } catch (err) {
    if (err instanceof UploadError) return fail(err.message);
    return fail("Couldn't save the product photo.");
  }

  const [dbUser, budget] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: { stylePrefs: true } }),
    prisma.budget.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    }),
  ]);
  const primaryOwnerId = getPrimaryOwnerId(parseStylePrefs(dbUser?.stylePrefs));

  const priceCents = input.priceCents != null && input.priceCents > 0 ? input.priceCents : null;
  const nowIso = new Date().toISOString();

  const item = await prisma.wardrobeItem.create({
    data: {
      userId: user.id,
      name,
      brand: input.brand?.trim() || null,
      category: input.category?.trim() || NONE_CATEGORY,
      subcategory: null,
      colors: encode([]),
      priceCents,
      currency: input.currency || "USD",
      retailer: input.retailer?.trim() || null,
      productUrl: input.productUrl?.trim() || null,
      styleTags: encode([]),
      season: encode([]),
      owners: encode(resolveItemOwnerIds([], primaryOwnerId)),
      originalImagePath: saved.originalImagePath,
      isWishlist: true,
      budgetId: budget?.id ?? null,
      wishlistPriority: normalizePriority(input.priority),
      priceHistory: priceCents ? encode([{ cents: priceCents, at: nowIso }]) : null,
      priceCheckedAt: priceCents ? new Date() : null,
      notes: input.notes?.trim() || null,
    },
  });

  revalidatePath("/closet/wishlist");
  revalidatePath("/closet");
  return { ok: true, value: { itemId: item.id } };
}

/**
 * Add straight from a Google Shopping result. Goes through resolveSearchMatch
 * so the stored link points at the merchant rather than at Google.
 */
export async function addFromSearchMatch(
  match: ProductMatch,
  priority: number,
): Promise<ActionResult<{ itemId: string }>> {
  await requireUser();
  const product = await resolveSearchMatch(match);
  return addWishlistItem({
    name: product.name,
    brand: product.brand,
    priceCents: product.priceCents,
    currency: product.currency,
    retailer: product.retailer,
    productUrl: product.productUrl,
    imageUrl: product.imageUrl,
    priority,
  });
}

/* ----------------------------------------------------------- editing rows */

async function ownedWishlistItem(itemId: string, userId: string) {
  return prisma.wardrobeItem.findFirst({
    where: { id: itemId, userId },
    select: {
      id: true,
      priceCents: true,
      productUrl: true,
      originalImagePath: true,
      priceHistory: true,
      isWishlist: true,
    },
  });
}

export async function setPriority(itemId: string, priority: number): Promise<ActionResult> {
  const user = await requireUser();
  const item = await ownedWishlistItem(itemId, user.id);
  if (!item) return fail("Item not found.");

  await prisma.wardrobeItem.update({
    where: { id: item.id },
    data: { wishlistPriority: normalizePriority(priority) },
  });
  revalidatePath("/closet/wishlist");
  return { ok: true };
}

/**
 * Categorise a wishlist row. Items added from a link or a search arrive
 * uncategorised, and gap analysis can't judge them until they're placed.
 */
export async function setCategory(itemId: string, category: string): Promise<ActionResult> {
  const user = await requireUser();
  const item = await ownedWishlistItem(itemId, user.id);
  if (!item) return fail("Item not found.");

  await prisma.wardrobeItem.update({
    where: { id: item.id },
    data: { category: category.trim() || NONE_CATEGORY },
  });
  revalidatePath("/closet/wishlist");
  revalidatePath("/closet");
  return { ok: true };
}

export async function setPrice(itemId: string, dollars: number | null): Promise<ActionResult> {
  const user = await requireUser();
  const item = await ownedWishlistItem(itemId, user.id);
  if (!item) return fail("Item not found.");

  const cents = dollars == null ? null : Math.round(Number(dollars) * 100);
  if (cents != null && (!Number.isFinite(cents) || cents < 0)) {
    return fail("Enter a valid price.");
  }

  await prisma.wardrobeItem.update({
    where: { id: item.id },
    data: {
      priceCents: cents,
      // A hand-entered price is a fresh reading — record it so the drop
      // watcher compares against something the user actually saw.
      priceHistory: cents
        ? encode(appendPricePoint(parsePriceHistory(item.priceHistory), cents, new Date().toISOString()))
        : item.priceHistory,
    },
  });
  revalidatePath("/closet/wishlist");
  return { ok: true };
}

export async function markPurchased(
  itemId: string,
  paidDollars: number | null,
): Promise<ActionResult> {
  const user = await requireUser();
  const item = await ownedWishlistItem(itemId, user.id);
  if (!item) return fail("Item not found.");

  const paidCents = paidDollars == null ? null : Math.round(Number(paidDollars) * 100);
  if (paidCents != null && (!Number.isFinite(paidCents) || paidCents < 0)) {
    return fail("Enter what you actually paid.");
  }

  await prisma.wardrobeItem.update({
    where: { id: item.id },
    data: {
      isWishlist: false,
      purchasedAt: new Date(),
      purchasedCents: paidCents ?? item.priceCents,
    },
  });

  revalidatePath("/closet/wishlist");
  revalidatePath("/closet");
  return { ok: true };
}

/** Undo a purchase — puts the item back on the list and refunds the budget. */
export async function unmarkPurchased(itemId: string): Promise<ActionResult> {
  const user = await requireUser();
  const item = await prisma.wardrobeItem.findFirst({
    where: { id: itemId, userId: user.id },
    select: { id: true },
  });
  if (!item) return fail("Item not found.");

  await prisma.wardrobeItem.update({
    where: { id: item.id },
    data: { isWishlist: true, purchasedAt: null, purchasedCents: null },
  });

  revalidatePath("/closet/wishlist");
  revalidatePath("/closet");
  return { ok: true };
}

/**
 * Delete a wishlist row outright. Safe because a wishlist item is a thing you
 * don't own — there's no wear history or outfit to orphan. Purchased items go
 * through the normal closet delete instead.
 */
export async function removeWishlistItem(itemId: string): Promise<ActionResult> {
  const user = await requireUser();
  const item = await prisma.wardrobeItem.findFirst({
    where: { id: itemId, userId: user.id, isWishlist: true },
    select: { id: true, originalImagePath: true },
  });
  if (!item) return fail("Item not found, or it's already in your closet.");

  await prisma.wardrobeItem.delete({ where: { id: item.id } });
  await deleteUpload(item.originalImagePath).catch(() => {});

  revalidatePath("/closet/wishlist");
  revalidatePath("/closet");
  return { ok: true };
}

/* ------------------------------------------------------- price-drop watch */

export type PriceCheckResult = {
  checked: number;
  changed: number;
  skipped: number;
};

/**
 * Re-read prices for every wishlist item that has a store link. Sequential
 * with a small gap — this hits real retailers, and hammering them in parallel
 * is both rude and a good way to get rate-limited.
 */
export async function refreshPrices(): Promise<ActionResult<PriceCheckResult>> {
  const user = await requireUser();

  // Only items that came from a shop get watched — a hand-typed row has no
  // listing to re-read, and searching for every one of them would burn SerpAPI
  // credits on guesses.
  const items = await prisma.wardrobeItem.findMany({
    where: { userId: user.id, isWishlist: true, productUrl: { not: null } },
    select: {
      id: true,
      name: true,
      brand: true,
      productUrl: true,
      priceCents: true,
      priceHistory: true,
    },
  });

  let checked = 0;
  let changed = 0;
  let skipped = 0;

  for (const item of items) {
    const url = item.productUrl;
    if (!url) {
      skipped += 1;
      continue;
    }

    const cents = await recheckPriceCents(url, item.name, item.brand);
    checked += 1;

    if (cents == null) {
      skipped += 1;
      continue;
    }

    const history = parsePriceHistory(item.priceHistory);
    const next = appendPricePoint(history, cents, new Date().toISOString());
    const didChange = next.length !== history.length;

    await prisma.wardrobeItem.update({
      where: { id: item.id },
      data: {
        priceCents: cents,
        priceHistory: encode(next),
        priceCheckedAt: new Date(),
      },
    });

    if (didChange && item.priceCents !== cents) changed += 1;
  }

  revalidatePath("/closet/wishlist");
  return { ok: true, value: { checked, changed, skipped } };
}

/* ------------------------------------------------------------------ utils */

async function downloadImage(url: string, userId: string) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Wardrobe/1.0 (+https://github.com/benmcaulay/wardrobe)" },
    signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new UploadError("empty", "Couldn't download the product photo.");

  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_IMAGE_BYTES) {
    throw new UploadError("too_large", "That product photo is too large.");
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new UploadError("empty", "The product photo was empty.");
  if (buf.length > MAX_IMAGE_BYTES) {
    throw new UploadError("too_large", "That product photo is too large.");
  }

  return saveImageBuffer(buf, userId);
}
