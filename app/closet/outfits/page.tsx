import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getColorsListFromPrefs } from "@/lib/colors";
import { prisma } from "@/lib/db";
import { readItemTileMeta } from "@/lib/item-tile-meta";
import { parseColors, parseStylePrefs } from "@/lib/json";
import {
  sanitizeLayerOrder,
  sanitizeOutfitSlotDefaults,
  sanitizeVisualLayers,
} from "@/lib/outfit-slot-defaults";
import { OutfitStudio } from "./outfit-studio";
import type { SavedOutfit } from "./outfit-builder";
import type { RandomOutfitItem } from "./random-outfit-builder";

export default async function OutfitsPage() {
  const user = await requireUser();
  const [items, layouts, dbUser] = await Promise.all([
    prisma.wardrobeItem.findMany({
      where: { userId: user.id, isWishlist: false },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        brand: true,
        category: true,
        subcategory: true,
        pattern: true,
        material: true,
        notes: true,
        season: true,
        styleTags: true,
        colors: true,
        originalImagePath: true,
        ghostImagePath: true,
        ghostViews: true,
        originalMirror: true,
        originalThumbZoom: true,
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
    prisma.user.findUnique({
      where: { id: user.id },
      select: { stylePrefs: true },
    }),
  ]);

  const prefs = parseStylePrefs(dbUser?.stylePrefs);
  const colorOptions = getColorsListFromPrefs(prefs);
  const outfitSlotDefaults = sanitizeOutfitSlotDefaults(prefs.outfitSlotDefaults);
  const outfitLayerOrder = sanitizeLayerOrder(prefs.outfitLayerOrder);
  const outfitVisualLayers = sanitizeVisualLayers(prefs.outfitVisualLayers);

  const closetItems: RandomOutfitItem[] = items.map((item) => {
    const tile = readItemTileMeta(item);
    return {
      id: item.id,
      name: item.name,
      brand: item.brand,
      category: item.category,
      subcategory: item.subcategory,
      pattern: item.pattern,
      material: item.material,
      notes: item.notes,
      season: item.season,
      styleTags: item.styleTags,
      imagePath: item.ghostImagePath ?? item.originalImagePath,
      colors: parseColors(item.colors),
      thumbZoom: tile.thumbZoom,
      mirror: tile.mirror,
    };
  });

  const savedOutfits: SavedOutfit[] = layouts.map((layout) => ({
    id: layout.id,
    name: layout.name,
    frameHeight: layout.frameHeight,
    pieces: parsePieces(layout.pieces),
  }));

  return (
    <main className="max-w-[1800px] mx-auto px-6 py-12">
      <nav className="text-xs text-ink-muted mb-6">
        <Link href="/closet" className="hover:text-ink">
          ← Closet
        </Link>
      </nav>
      <OutfitStudio
        items={closetItems}
        colorOptions={colorOptions}
        initialOutfits={savedOutfits}
        outfitSlotDefaults={outfitSlotDefaults}
        outfitLayerOrder={outfitLayerOrder}
        outfitVisualLayers={outfitVisualLayers}
      />
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
