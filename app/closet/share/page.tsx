import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getCategoriesListFromPrefs } from "@/lib/categories";
import { getColorsListFromPrefs } from "@/lib/colors";
import { parseStringArray, parseStylePrefs } from "@/lib/json";
import { readClosetSort, sortWardrobeItems } from "@/lib/closet-sort";
import { readItemTileMeta } from "@/lib/item-tile-meta";
import { isShareKind } from "@/lib/share/kinds";
import { ShareClient, type ShareLinkRow, type ShareTarget } from "./share-client";

export const dynamic = "force-dynamic";

export default async function SharePage() {
  const user = await requireUser();

  const [dbUser, items, outfits, links, wishlistCount] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: { stylePrefs: true } }),
    prisma.wardrobeItem.findMany({
      where: { userId: user.id, isWishlist: false },
      select: {
        id: true,
        name: true,
        brand: true,
        category: true,
        colors: true,
        season: true,
        priceCents: true,
        createdAt: true,
        originalImagePath: true,
        originalThumbZoom: true,
        originalMirror: true,
        ghostImagePath: true,
        ghostViews: true,
      },
    }),
    prisma.outfit.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, itemIds: true },
    }),
    prisma.shareLink.findMany({
      where: { userId: user.id },
      orderBy: [{ revokedAt: "asc" }, { createdAt: "desc" }],
    }),
    prisma.wardrobeItem.count({ where: { userId: user.id, isWishlist: true } }),
  ]);

  const prefs = parseStylePrefs(dbUser?.stylePrefs);

  // Match the closet exactly: same saved sort, same category/colour orderings.
  const sorted = sortWardrobeItems(items, readClosetSort(prefs.defaultClosetSort), {
    categoryOrder: getCategoriesListFromPrefs(prefs),
    colorOrder: getColorsListFromPrefs(prefs).map((c) => c.name),
    closetGroupOrders: prefs.closetGroupOrders,
  });

  const itemTargets: ShareTarget[] = sorted.map((i) => {
    // Prefer the ghost render — that's the white-background cutout the closet
    // grid shows — and carry its framing so the crop matches tile for tile.
    const meta = readItemTileMeta(i);
    return {
      id: i.id,
      label: i.name,
      sublabel: i.brand,
      imagePath: i.ghostImagePath ?? i.originalImagePath,
      thumbZoom: meta.thumbZoom,
      mirror: meta.mirror,
    };
  });

  const outfitTargets: ShareTarget[] = outfits.map((o) => ({
    id: o.id,
    label: o.name,
    sublabel: `${parseStringArray(o.itemIds).length} pieces`,
    imagePath: null,
    thumbZoom: 1,
    mirror: false,
  }));

  // Give each row a human name so the list reads as things, not tokens.
  const itemNames = new Map(items.map((i) => [i.id, i.name]));
  const outfitNames = new Map(outfits.map((o) => [o.id, o.name]));

  const linkRows: ShareLinkRow[] = links
    .filter((l) => isShareKind(l.kind))
    .map((l) => ({
      id: l.id,
      token: l.token,
      kind: l.kind as ShareLinkRow["kind"],
      targetId: l.targetId,
      title:
        l.kind === "wishlist"
          ? "Wishlist"
          : l.kind === "item"
            ? (itemNames.get(l.targetId ?? "") ?? "Item")
            : (outfitNames.get(l.targetId ?? "") ?? "Outfit"),
      note: l.note,
      revoked: l.revokedAt != null,
      createdAt: l.createdAt.toISOString(),
    }));

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <nav className="mb-6 flex items-center justify-between pr-28 text-xs text-ink-muted">
        <Link href="/closet" className="hover:text-ink">
          ← Closet
        </Link>
      </nav>

      <header className="mb-10">
        <h1 className="font-serif text-5xl tracking-tight">Share</h1>
        <p className="mt-2 max-w-xl text-ink-muted">
          Send a piece, an outfit, or your wishlist to anyone. Links are unlisted, never expire,
          and you can switch one off at any moment. Only the thumbnail and the basics travel —
          never your original photos.
        </p>
      </header>

      <ShareClient
        items={itemTargets}
        outfits={outfitTargets}
        links={linkRows}
        wishlistCount={wishlistCount}
      />
    </main>
  );
}
