import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseColors, parseSeasons, parseStringArray } from "@/lib/json";
import type { Category, ItemFormValue } from "@/lib/types";
import { EditForm } from "./edit-form";
import { ImageCarousel } from "./image-carousel";

function formatDate(d: Date) {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default async function ItemDetailPage({ params }: { params: { itemId: string } }) {
  const user = await requireUser();
  const [item, dbUser] = await Promise.all([
    prisma.wardrobeItem.findFirst({ where: { id: params.itemId, userId: user.id } }),
    prisma.user.findUnique({ where: { id: user.id }, select: { credits: true } }),
  ]);
  if (!item) notFound();

  const initial: ItemFormValue = {
    name: item.name,
    brand: item.brand ?? "",
    category: item.category as Category,
    subcategory: item.subcategory ?? "",
    colors: parseColors(item.colors),
    priceCents: item.priceCents,
    currency: item.currency,
    material: item.material ?? "",
    pattern: item.pattern ?? "",
    styleTags: parseStringArray(item.styleTags),
    season: parseSeasons(item.season),
    notes: item.notes ?? "",
    isWishlist: item.isWishlist,
  };

  return (
    <main className="max-w-6xl mx-auto px-6 py-12">
      <nav className="text-xs text-ink-muted mb-6">
        <Link href="/closet" className="hover:text-ink">
          ← Closet
        </Link>
      </nav>

      <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-10 items-start">
        <div className="space-y-4 md:sticky md:top-6">
          <ImageCarousel
            itemId={item.id}
            originalPath={item.originalImagePath}
            ghostPath={item.ghostImagePath}
            credits={dbUser?.credits ?? 0}
          />
          <dl className="grid grid-cols-2 gap-4 text-xs">
            <div>
              <dt className="uppercase tracking-wide text-ink-muted">Worn</dt>
              <dd className="mt-1 text-sm">
                {item.timesWorn} {item.timesWorn === 1 ? "time" : "times"}
              </dd>
            </div>
            <div>
              <dt className="uppercase tracking-wide text-ink-muted">Last worn</dt>
              <dd className="mt-1 text-sm">
                {item.lastWornAt ? formatDate(item.lastWornAt) : "—"}
              </dd>
            </div>
          </dl>
        </div>

        <div>
          <EditForm itemId={item.id} initial={initial} />
        </div>
      </div>
    </main>
  );
}
