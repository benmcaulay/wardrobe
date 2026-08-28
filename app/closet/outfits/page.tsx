import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getColorsListFromPrefs } from "@/lib/colors";
import { prisma } from "@/lib/db";
import { getCategoriesListFromPrefs } from "@/lib/categories";
import { getCategoryParentsFromPrefs } from "@/lib/category-tree";
import { readItemTileMeta } from "@/lib/item-tile-meta";
import { parseColors, parseStylePrefs } from "@/lib/json";
import { sanitizeCategoryRules } from "@/lib/outfit-random";
import {
  sanitizeComboLayouts,
  sanitizeLayerArrangements,
  sanitizeLayerOrder,
  sanitizeOutfitSlotDefaults,
  sanitizeVisualLayers,
} from "@/lib/outfit-slot-defaults";
import { readTemperatureUnit } from "@/lib/temperature";
import { getDailyContext } from "@/lib/actions/daily-outfit";
import { listPendingWears } from "@/lib/actions/wear-confirm";
import { listStyleNotes } from "@/lib/actions/style-notes";
import { OutfitStudio } from "./outfit-studio";
import type { SavedOutfit } from "./outfit-builder";
import type { RandomOutfitItem } from "./random-outfit-builder";

// Reads today's forecast and the preference log, so this page can't be static.
export const dynamic = "force-dynamic";

/**
 * `?items`, `?returnTo` and `?returnLabel` let another surface hand a look over
 * for arranging and get the user back afterwards — the trip planner's "Edit
 * this look" uses all three. The look opens on the default tab, the Smart
 * Generator, so it arrives on this page as the user knows it.
 *
 * `?tab` still selects a tab, for a link that wants one specifically.
 *
 * Only relative paths are honoured for `returnTo`: it ends up in an href, and
 * accepting an absolute URL from a query string is an open redirect.
 */
export default async function OutfitsPage({
  searchParams,
}: {
  searchParams?: { tab?: string; items?: string; returnTo?: string; returnLabel?: string };
}) {
  const user = await requireUser();
  const [items, layouts, dbUser, dailyContext, pending, notes] = await Promise.all([
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
    // Rendered with the server's idea of "today"; the weather card re-pulls on
    // mount with the user's own date, the only clock that can answer it.
    getDailyContext(),
    listPendingWears(),
    listStyleNotes(),
  ]);

  const prefs = parseStylePrefs(dbUser?.stylePrefs);
  const colorOptions = getColorsListFromPrefs(prefs);
  const categoryList = getCategoriesListFromPrefs(prefs);
  const categoryParents = getCategoryParentsFromPrefs(prefs);
  const outfitSlotDefaults = sanitizeOutfitSlotDefaults(prefs.outfitSlotDefaults);
  const outfitLayerOrder = sanitizeLayerOrder(prefs.outfitLayerOrder);
  const outfitVisualLayers = sanitizeVisualLayers(prefs.outfitVisualLayers);
  const outfitComboLayouts = sanitizeComboLayouts(prefs.outfitComboLayouts);
  const outfitLayerArrangements = sanitizeLayerArrangements(prefs.outfitLayerArrangements);
  const outfitAutoPopulateRules = !!prefs.outfitAutoPopulateRules;
  const outfitStartupRules = outfitAutoPopulateRules
    ? sanitizeCategoryRules(prefs.outfitStartupRules)
    : [];

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
        initialTab={searchParams?.tab === "compose" || searchParams?.tab === "train" ? searchParams.tab : "generate"}
        initialPieceIds={(searchParams?.items ?? "")
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean)}
        returnTo={
          searchParams?.returnTo?.startsWith("/") && !searchParams.returnTo.startsWith("//")
            ? searchParams.returnTo
            : null
        }
        returnLabel={searchParams?.returnLabel ?? "Back"}
        items={closetItems}
        categoryList={categoryList}
        categoryParents={categoryParents}
        colorOptions={colorOptions}
        initialOutfits={savedOutfits}
        outfitSlotDefaults={outfitSlotDefaults}
        outfitLayerOrder={outfitLayerOrder}
        outfitVisualLayers={outfitVisualLayers}
        outfitComboLayouts={outfitComboLayouts}
        outfitLayerArrangements={outfitLayerArrangements}
        outfitAutoPopulateRules={outfitAutoPopulateRules}
        outfitStartupRules={outfitStartupRules}
        initialContext={dailyContext}
        initialPending={pending}
        initialNotes={notes}
        temperatureUnit={readTemperatureUnit(prefs.temperatureUnit)}
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
