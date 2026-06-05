import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { OutfitBuilder, type OutfitClosetItem, type SavedOutfit } from "./outfit-builder";

export default async function OutfitsPage() {
  const user = await requireUser();
  const [items, layouts] = await Promise.all([
    prisma.wardrobeItem.findMany({
      where: { userId: user.id, isWishlist: false },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        category: true,
        originalImagePath: true,
        ghostImagePath: true,
      },
    }),
    prisma.outfitLayout.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      take: 30,
      select: {
        id: true,
        name: true,
        frameHeight: true,
        pieces: true,
      },
    }),
  ]);

  const closetItems: OutfitClosetItem[] = items.map((item) => ({
    id: item.id,
    name: item.name,
    category: item.category,
    imagePath: item.ghostImagePath ?? item.originalImagePath,
  }));

  const savedOutfits: SavedOutfit[] = layouts.map((layout) => ({
    id: layout.id,
    name: layout.name,
    frameHeight: layout.frameHeight,
    pieces: parsePieces(layout.pieces),
  }));

  return (
    <main className="max-w-6xl mx-auto px-6 py-12">
      <nav className="text-xs text-ink-muted mb-6">
        <Link href="/closet" className="hover:text-ink">
          ← Closet
        </Link>
      </nav>
      <header className="mb-8">
        <h1 className="font-serif text-4xl tracking-tight">Build outfit</h1>
        <p className="text-ink-muted mt-2">
          Add pieces, drag them on the frame, resize each item, and adjust layer order.
        </p>
      </header>
      <OutfitBuilder items={closetItems} initialOutfits={savedOutfits} />
    </main>
  );
}

function parsePieces(raw: string): SavedOutfit["pieces"] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
