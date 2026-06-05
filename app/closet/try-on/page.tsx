import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseColors, parseStringArray } from "@/lib/json";
import { CreditMark } from "@/components/credit-mark";
import { virtualTryOnUsesAppCredits } from "@/lib/services/virtualTryOn";
import { TryOnFlow, type ItemSummary, type OutfitSummary, type PersonPhotoSummary, type RecentTryOn } from "./try-on-flow";

export default async function TryOnPage() {
  const user = await requireUser();
  const [photos, items, outfits, dbUser, recent] = await Promise.all([
    prisma.personPhoto.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    }),
    prisma.wardrobeItem.findMany({
      where: { userId: user.id, isWishlist: false },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        brand: true,
        category: true,
        subcategory: true,
        colors: true,
        pattern: true,
        material: true,
        season: true,
        styleTags: true,
        originalImagePath: true,
        ghostImagePath: true,
      },
    }),
    prisma.outfit.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    }),
    prisma.user.findUnique({ where: { id: user.id }, select: { credits: true } }),
    prisma.virtualTryOn.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 6,
    }),
  ]);

  const itemSummaries: ItemSummary[] = items.map((i) => {
    const colorParts = parseColors(i.colors).flatMap((c) => {
      const hex = c.hex.replace(/^#/, "").toLowerCase();
      return [c.name, hex, `#${hex}`];
    });
    const styleTags = parseStringArray(i.styleTags);
    const seasons = parseStringArray(i.season);
    const searchHaystack = [
      i.name,
      i.brand ?? "",
      i.category,
      i.subcategory ?? "",
      i.pattern ?? "",
      i.material ?? "",
      ...colorParts,
      ...styleTags,
      ...seasons,
    ]
      .filter((s) => s.trim().length > 0)
      .join(" ")
      .toLowerCase();

    return {
      id: i.id,
      name: i.name,
      brand: i.brand,
      category: i.category,
      subcategory: i.subcategory,
      bestImagePath: i.ghostImagePath ?? i.originalImagePath,
      searchHaystack,
    };
  });

  const outfitSummaries: OutfitSummary[] = outfits.map((o) => ({
    id: o.id,
    name: o.name,
    itemIds: parseStringArray(o.itemIds),
  }));

  const photoSummaries: PersonPhotoSummary[] = photos.map((p) => ({
    id: p.id,
    imagePath: p.imagePath,
    label: p.label,
  }));

  const recentSummaries: RecentTryOn[] = recent.map((r) => ({
    id: r.id,
    resultImagePath: r.resultImagePath,
    createdAt: r.createdAt.toISOString(),
    itemIds: parseStringArray(r.itemIds),
  }));

  return (
    <main className="max-w-6xl mx-auto px-6 py-12">
      <nav className="text-xs text-ink-muted mb-4">
        <Link href="/closet" className="hover:text-ink">
          ← Closet
        </Link>
      </nav>
      <header className="mb-8 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-serif text-4xl tracking-tight">Virtual try-on</h1>
          <p className="text-ink-muted mt-2 max-w-xl">
            Upload up to 5 photos of yourself, pick one, then choose a saved
            outfit or any items from your closet — the AI agent will redress
            you in seconds.
          </p>
        </div>
        <Link
          href="/settings"
          className="rounded-full bg-paper-warm text-ink px-3 py-1 text-xs tracking-wide hover:bg-ink/5"
          title="Try-on credits"
        >
          <span className="inline-flex items-center gap-1">
            <CreditMark className="h-3.5 w-3.5" title="Credits" />
            {dbUser?.credits ?? 0}
          </span>
        </Link>
      </header>

      <TryOnFlow
        initialPhotos={photoSummaries}
        items={itemSummaries}
        outfits={outfitSummaries}
        credits={dbUser?.credits ?? 0}
        tryOnUsesAppCredits={virtualTryOnUsesAppCredits()}
        recent={recentSummaries}
      />
    </main>
  );
}
