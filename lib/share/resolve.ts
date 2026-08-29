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
 *
 * The `space` kind is the narrowest of all: no items, no thumbnails, no
 * `allowedItemIds` — just counts. See `SharedSpace`.
 */

import { prisma } from "@/lib/db";
import { parseColors, parseStringArray, type Color } from "@/lib/json";
import { thumbnailPathFor } from "@/lib/image-paths";
import { loadSpaceSnapshot } from "@/lib/server/space-ledger";
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

/**
 * The space ledger, as much of it as may leave the account.
 *
 * Counts and rail inches only. **Money is deliberately excluded** — a shared
 * link is a URL anybody can forward, and "I made $2,340 selling clothes this
 * year" is the single most sensitive number this app holds. The private page
 * shows it; this type has no field for it, so no future edit to the public page
 * can leak it by reaching one field further.
 *
 * Per-month counts go out because the shape of the year is the interesting part
 * and a count of garments identifies nobody.
 */
export type SharedSpace = {
  /** Trailing months, oldest first. */
  months: { startMs: number; in: number; out: number }[];
  allTime: { in: number; out: number; railInches: number };
  /** Pieces currently in the closet, for scale. */
  ownedCount: number;
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
  /** Present only on `space` shares. */
  space?: SharedSpace;
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

  if (link.kind === "space") {
    const snapshot = await loadSpaceSnapshot(link.userId);
    return {
      status: "ok",
      share: {
        ...base,
        kind: "space",
        title: ownerName ? `${ownerName}'s year of space` : "A year of space",
        // Nothing to show and nothing to fetch: the empty allow-list means the
        // thumbnail route refuses every id for this token.
        items: [],
        allowedItemIds: new Set<string>(),
        space: {
          months: snapshot.months.map((m) => ({ startMs: m.startMs, in: m.in, out: m.out })),
          allTime: {
            in: snapshot.allTime.in.count,
            out: snapshot.allTime.out.count,
            railInches: snapshot.allTime.rail.inches,
          },
          ownedCount: snapshot.ownedCount,
        },
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
