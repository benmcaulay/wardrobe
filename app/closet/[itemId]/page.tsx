import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { imageUrl, thumbnailUrl } from "@/lib/uploads";
import { parseColors, parseSeasons, parseStringArray } from "@/lib/json";
import type { Category, ItemFormValue } from "@/lib/types";
import { EditForm } from "./edit-form";

function formatDate(d: Date) {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default async function ItemDetailPage({ params }: { params: { itemId: string } }) {
  const user = await requireUser();
  const item = await prisma.wardrobeItem.findFirst({
    where: { id: params.itemId, userId: user.id },
  });
  if (!item) notFound();

  const tryOns = await prisma.tryOnGeneration.findMany({
    where: { itemId: item.id, userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  const initial: ItemFormValue = {
    name: item.name,
    brand: item.brand ?? "",
    category: item.category as Category,
    subcategory: item.subcategory ?? "",
    colors: parseColors(item.colors),
    priceCents: item.priceCents,
    currency: item.currency,
    retailer: item.retailer ?? "",
    productUrl: item.productUrl ?? "",
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
          <div className="rounded-2xl overflow-hidden bg-paper-warm aspect-square shadow-tile">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl(item.originalImagePath)}
              alt={item.name}
              className="w-full h-full object-cover"
            />
          </div>
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

      <section className="mt-16">
        <h2 className="font-serif text-2xl tracking-tight mb-4">Try-on history</h2>
        {tryOns.length === 0 ? (
          <p className="text-ink-muted text-sm">
            You haven&apos;t generated any try-ons yet.{" "}
            <Link href={`/try-on/${item.id}`} className="underline">
              Try this one on
            </Link>
            .
          </p>
        ) : (
          <ul className="grid grid-cols-3 md:grid-cols-5 gap-3">
            {tryOns.map((t) => (
              <li key={t.id} className="rounded-xl overflow-hidden bg-paper-warm aspect-square shadow-tile">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={thumbnailUrl(t.resultImagePath)}
                  alt="Try-on result"
                  className="w-full h-full object-cover"
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
