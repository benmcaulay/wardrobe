import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isNoneCategoryStored, NONE_CATEGORY } from "@/lib/categories";
import { SellSwiper, type SwipeItem } from "./sell-swiper";

export const dynamic = "force-dynamic";

export default async function SellPage() {
  const user = await requireUser();

  const [undecided, forSaleCount, listedCount] = await Promise.all([
    prisma.wardrobeItem.findMany({
      // Items the user hasn't triaged yet (no SaleListing row) and isn't a wishlist piece.
      where: { userId: user.id, isWishlist: false, saleListing: { is: null } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        brand: true,
        category: true,
        priceCents: true,
        currency: true,
        originalImagePath: true,
        ghostImagePath: true,
      },
    }),
    prisma.saleListing.count({ where: { userId: user.id, status: "for_sale" } }),
    prisma.saleListing.count({ where: { userId: user.id, status: "listed" } }),
  ]);

  const items: SwipeItem[] = undecided.map((item) => ({
    id: item.id,
    name: item.name,
    brand: item.brand,
    category: isNoneCategoryStored(item.category) ? NONE_CATEGORY : item.category,
    priceCents: item.priceCents,
    currency: item.currency || "USD",
    imagePath: item.ghostImagePath ?? item.originalImagePath,
  }));

  const readyCount = forSaleCount + listedCount;

  return (
    <main className="max-w-2xl mx-auto px-6 py-12">
      <nav className="text-xs text-ink-muted mb-6 flex items-center justify-between">
        <Link href="/closet" className="hover:text-ink">
          ← Closet
        </Link>
        <Link href="/closet/sell/listings" className="hover:text-ink">
          For sale{readyCount > 0 ? ` (${readyCount})` : ""} →
        </Link>
      </nav>

      <header className="mb-8 text-center">
        <h1 className="font-serif text-4xl tracking-tight">Sell or keep</h1>
        <p className="text-ink-muted mt-2">
          Swipe right to list a piece for sale, left to keep it. We&apos;ll draft the listing for
          you — you copy it into Depop, Poshmark, and the rest.
        </p>
      </header>

      <SellSwiper items={items} readyCount={readyCount} />
    </main>
  );
}
