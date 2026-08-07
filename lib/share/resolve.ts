/**
 * Turn a share token into exactly the data the public page may render.
 *
 * This is the security boundary for sharing, so it is deliberately narrow:
 *
 *  - Only the *thumbnail* path is ever surfaced, never `originalImagePath`,
 *    never a ghost render, never an extra context shot.
 *  - Only name, brand, colours and (for the wishlist) price/retailer/link go
 *    out. Notes, owners, wear counts, dHash and sourceData stay private.
 *  - `allowedItemIds` is the allow-list the image route checks, so a token for
 *    one item can't be used to fetch a different item's thumbnail.
 */

import { prisma } from "@/lib/db";
import { parseColors, parseStringArray, type Color } from "@/lib/json";
import { thumbnailPathFor } from "@/lib/image-paths";
import { isShareKind, type ShareKind } from "./kinds";
import { isValidShareTokenFormat } from "./token";

export type SharedItem = {
  id: string;
  name: string;
  brand: string | null;
  category: string;
  colors: Color[];
  /** Present only on wishlist shares. */
  priceCents: number | null;
  currency: string;
  retailer: string | null;
  productUrl: string | null;
};

export type ResolvedShare = {
  token: string;
  kind: ShareKind;
  title: string;
  note: string | null;
  ownerName: string | null;
  items: SharedItem[];
  /** Ids whose thumbnails this token may fetch. */
  allowedItemIds: Set<string>;
};

export type ShareLookup =
  | { status: "ok"; share: ResolvedShare }
  | { status: "not-found" }
  | { status: "revoked" };

function toSharedItem(item: {
  id: string;
  name: string;
  brand: string | null;
  category: string;
  colors: string;
  priceCents: number | null;
  currency: string;
  retailer: string | null;
  productUrl: string | null;
}): SharedItem {
  return {
    id: item.id,
    name: item.name,
    brand: item.brand,
    category: item.category,
    colors: parseColors(item.colors),
    priceCents: item.priceCents,
    currency: item.currency,
    retailer: item.retailer,
    productUrl: item.productUrl,
  };
}

const ITEM_SELECT = {
  id: true,
  name: true,
  brand: true,
  category: true,
  colors: true,
  priceCents: true,
  currency: true,
  retailer: true,
  productUrl: true,
} as const;

export async function resolveShare(rawToken: string): Promise<ShareLookup> {
  const token = rawToken.trim();
  if (!isValidShareTokenFormat(token)) return { status: "not-found" };

  const link = await prisma.shareLink.findUnique({
    where: { token },
    select: {
      token: true,
      kind: true,
      targetId: true,
      note: true,
      revokedAt: true,
      userId: true,
      user: { select: { name: true } },
    },
  });

  if (!link || !isShareKind(link.kind)) return { status: "not-found" };
  if (link.revokedAt) return { status: "revoked" };

  const ownerName = link.user?.name?.trim() || null;
  const base = { token: link.token, note: link.note, ownerName };

  if (link.kind === "item") {
    if (!link.targetId) return { status: "not-found" };
    const item = await prisma.wardrobeItem.findFirst({
      where: { id: link.targetId, userId: link.userId },
      select: ITEM_SELECT,
    });
    if (!item) return { status: "not-found" };
    return {
      status: "ok",
      share: {
        ...base,
        kind: "item",
        title: item.name,
        items: [toSharedItem(item)],
        allowedItemIds: new Set([item.id]),
      },
    };
  }

  if (link.kind === "outfit") {
    if (!link.targetId) return { status: "not-found" };
    const outfit = await prisma.outfit.findFirst({
      where: { id: link.targetId, userId: link.userId },
      select: { name: true, itemIds: true },
    });
    if (!outfit) return { status: "not-found" };

    const ids = parseStringArray(outfit.itemIds);
    // Re-query by owner so a doctored itemIds blob can't pull in someone
    // else's garment.
    const items = await prisma.wardrobeItem.findMany({
      where: { id: { in: ids }, userId: link.userId },
      select: ITEM_SELECT,
    });
    // Preserve the outfit's own ordering.
    const byId = new Map(items.map((i) => [i.id, i]));
    const ordered = ids.map((id) => byId.get(id)).filter((i): i is NonNullable<typeof i> => !!i);

    return {
      status: "ok",
      share: {
        ...base,
        kind: "outfit",
        title: outfit.name,
        items: ordered.map(toSharedItem),
        allowedItemIds: new Set(ordered.map((i) => i.id)),
      },
    };
  }

  // Wishlist: everything still on the list, cheapest intent first.
  const items = await prisma.wardrobeItem.findMany({
    where: { userId: link.userId, isWishlist: true },
    orderBy: [{ wishlistPriority: "asc" }, { createdAt: "desc" }],
    select: ITEM_SELECT,
  });

  return {
    status: "ok",
    share: {
      ...base,
      kind: "wishlist",
      title: ownerName ? `${ownerName}'s wishlist` : "Wishlist",
      items: items.map(toSharedItem),
      allowedItemIds: new Set(items.map((i) => i.id)),
    },
  };
}

/**
 * Thumbnail storage key for an item a token is allowed to see.
 * Returns null when the item isn't part of the share.
 */
export async function resolveShareThumbnailKey(
  token: string,
  itemId: string,
): Promise<string | null> {
  const lookup = await resolveShare(token);
  if (lookup.status !== "ok") return null;
  if (!lookup.share.allowedItemIds.has(itemId)) return null;

  const item = await prisma.wardrobeItem.findUnique({
    where: { id: itemId },
    select: { originalImagePath: true },
  });
  if (!item) return null;
  return thumbnailPathFor(item.originalImagePath);
}

/** Public image URL for an item inside a share. */
export function shareThumbUrl(token: string, itemId: string): string {
  return `/api/share/${encodeURIComponent(token)}/thumb/${encodeURIComponent(itemId)}`;
}
