import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isNoneCategoryStored, NONE_CATEGORY } from "@/lib/categories";
import { parseColors, parseStringArray } from "@/lib/json";
import { sanitizeMarketplaceIds } from "@/lib/marketplaces";
import { buildListingDraft, isItemCondition, type ItemCondition } from "@/lib/sale-listing";
import { ListingsClient, type Listing } from "./listings-client";

export const dynamic = "force-dynamic";

export default async function ListingsPage() {
  const user = await requireUser();

  const rows = await prisma.saleListing.findMany({
    where: { userId: user.id, status: { in: ["for_sale", "listed", "sold"] } },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    select: {
      itemId: true,
      status: true,
      askingCents: true,
      soldPriceCents: true,
      currency: true,
      condition: true,
      updatedAt: true,
      title: true,
      description: true,
      marketplaces: true,
      item: {
        select: {
          name: true,
          brand: true,
          category: true,
          subcategory: true,
          colors: true,
          material: true,
          pattern: true,
          styleTags: true,
          priceCents: true,
          originalImagePath: true,
          ghostImagePath: true,
        },
      },
    },
  });

  const listings: Listing[] = rows.map((row) => {
    const condition: ItemCondition | null =
      row.condition && isItemCondition(row.condition) ? row.condition : null;
    const itemInput = {
      name: row.item.name,
      brand: row.item.brand,
      category: row.item.category,
      subcategory: row.item.subcategory,
      colors: parseColors(row.item.colors),
      material: row.item.material,
      pattern: row.item.pattern,
      styleTags: parseStringArray(row.item.styleTags),
    };
    // Fall back to a generated draft if the row hasn't got one yet.
    const draft = buildListingDraft(itemInput, { condition });
    return {
      itemId: row.itemId,
      status: row.status,
      askingCents: row.askingCents,
      soldPriceCents: row.soldPriceCents,
      updatedAtMs: row.updatedAt.getTime(),
      currency: row.currency || "USD",
      condition,
      title: row.title ?? draft.title,
      description: row.description ?? draft.description,
      marketplaces: sanitizeMarketplaceIds(parseStringArray(row.marketplaces)),
      retailCents: row.item.priceCents,
      categoryLabel: isNoneCategoryStored(row.item.category) ? NONE_CATEGORY : row.item.category,
      imagePath: row.item.ghostImagePath ?? row.item.originalImagePath,
      item: itemInput,
    };
  });

  return (
    <main className="max-w-4xl mx-auto px-6 py-12">
      <nav className="text-xs text-ink-muted mb-6 flex items-center justify-between">
        <Link href="/closet/sell" className="hover:text-ink">
          ← Keep swiping
        </Link>
        <Link href="/closet" className="hover:text-ink">
          Closet →
        </Link>
      </nav>

      <header className="mb-8">
        <h1 className="font-serif text-4xl tracking-tight">For sale</h1>
        <p className="text-ink-muted mt-2">
          Tweak each draft, set your price, then open the marketplace and paste it in. No public
          API lets us post for you — but everything here is copy-ready.
        </p>
      </header>

      <ListingsClient initial={listings} />
    </main>
  );
}
