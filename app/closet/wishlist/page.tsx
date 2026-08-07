import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getCategoriesListFromPrefs, isNoneCategoryStored, NONE_CATEGORY } from "@/lib/categories";
import { parseStylePrefs } from "@/lib/json";
import { computeBudgetSummary } from "@/lib/wishlist/budget";
import { analyzeCloset } from "@/lib/wishlist/gaps";
import { detectPriceDrop, parsePriceHistory } from "@/lib/wishlist/price-watch";
import { WishlistClient, type BudgetView, type WishlistRow } from "./wishlist-client";

export const dynamic = "force-dynamic";

export default async function WishlistPage() {
  const user = await requireUser();

  const [dbUser, budget, wishlistItems, purchasedItems, ownedItems, soldAgg] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: { stylePrefs: true } }),
    prisma.budget.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
    prisma.wardrobeItem.findMany({
      where: { userId: user.id, isWishlist: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.wardrobeItem.findMany({
      where: { userId: user.id, purchasedAt: { not: null } },
      orderBy: { purchasedAt: "desc" },
    }),
    prisma.wardrobeItem.findMany({
      where: { userId: user.id, isWishlist: false },
      select: { category: true },
    }),
    prisma.saleListing.aggregate({
      where: { userId: user.id, status: "sold" },
      _sum: { soldPriceCents: true },
    }),
  ]);

  const prefs = parseStylePrefs(dbUser?.stylePrefs);
  const categories = getCategoriesListFromPrefs(prefs);

  const salesCents = budget?.fundedBySales ? (soldAgg._sum.soldPriceCents ?? 0) : 0;

  const gapReport = analyzeCloset({
    owned: ownedItems.map((i) => ({ category: displayCategory(i.category) })),
    wishlist: wishlistItems.map((i) => ({ id: i.id, category: displayCategory(i.category) })),
    categories,
  });

  const toRow = (item: (typeof wishlistItems)[number]): WishlistRow => {
    const history = parsePriceHistory(item.priceHistory);
    const drop = detectPriceDrop(history);
    return {
      id: item.id,
      name: item.name,
      brand: item.brand,
      category: displayCategory(item.category),
      imagePath: item.originalImagePath,
      priceCents: item.priceCents,
      currency: item.currency,
      retailer: item.retailer,
      productUrl: item.productUrl,
      wishlistPriority: item.wishlistPriority,
      purchasedAt: item.purchasedAt ? item.purchasedAt.toISOString() : null,
      purchasedCents: item.purchasedCents,
      priceCheckedAt: item.priceCheckedAt ? item.priceCheckedAt.toISOString() : null,
      priceDrop: drop,
      verdict: gapReport.verdicts[item.id] ?? "neutral",
    };
  };

  const rows = wishlistItems.map(toRow);
  const purchased = purchasedItems.map(toRow);

  const summary = computeBudgetSummary({
    potCents: budget?.amountCents ?? 0,
    salesCents,
    items: [...wishlistItems, ...purchasedItems].map((i) => ({
      id: i.id,
      priceCents: i.priceCents,
      purchasedAt: i.purchasedAt,
      purchasedCents: i.purchasedCents,
      wishlistPriority: i.wishlistPriority,
    })),
  });

  const budgetView: BudgetView | null = budget
    ? {
        id: budget.id,
        name: budget.name,
        amountCents: budget.amountCents,
        currency: budget.currency,
        fundedBySales: budget.fundedBySales,
      }
    : null;

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      {/* pr-28 clears the fixed menu trigger (app/closet/layout.tsx). */}
      <nav className="mb-6 flex items-center justify-between pr-28 text-xs text-ink-muted">
        <Link href="/closet" className="hover:text-ink">
          ← Closet
        </Link>
      </nav>

      <header className="mb-10">
        <h1 className="font-serif text-5xl tracking-tight">Wishlist</h1>
        <p className="mt-2 max-w-xl text-ink-muted">
          What you want, what it costs, and whether the money reaches. Paste a store link and
          we&apos;ll pull the price and the photo straight from the shop.
        </p>
      </header>

      <WishlistClient
        budget={budgetView}
        summary={summary}
        rows={rows}
        purchased={purchased}
        gaps={gapReport}
        categories={categories}
      />
    </main>
  );
}

function displayCategory(stored: string): string {
  return isNoneCategoryStored(stored) ? NONE_CATEGORY : stored.trim();
}
