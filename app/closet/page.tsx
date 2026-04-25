import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { thumbnailUrl } from "@/lib/uploads";
import { parseColors } from "@/lib/json";
import { ClosetFilters, type ActiveFilters, type FilterOptions } from "@/components/closet-filters";

type SearchParams = {
  q?: string;
  category?: string;
  brand?: string;
  color?: string;
  season?: string;
  wishlist?: string;
};

function readFilters(params: SearchParams): ActiveFilters {
  return {
    q: (params.q ?? "").trim(),
    category: params.category ?? "",
    brand: params.brand ?? "",
    color: params.color ?? "",
    season: params.season ?? "",
    wishlist: params.wishlist === "1",
  };
}

// Escape the dynamic portion so a brand called `foo"bar` doesn't break the
// JSON-fragment match. JSON strings never contain an unescaped double quote.
const escapeForJsonFragment = (s: string) => s.replace(/"/g, "");

function buildWhere(userId: string, f: ActiveFilters): Prisma.WardrobeItemWhereInput {
  const where: Prisma.WardrobeItemWhereInput = { userId };
  if (f.category) where.category = f.category;
  if (f.brand) where.brand = f.brand;
  if (f.wishlist) where.isWishlist = true;
  if (f.q) {
    where.OR = [
      { name: { contains: f.q } },
      { brand: { contains: f.q } },
      { styleTags: { contains: f.q } },
      { notes: { contains: f.q } },
    ];
  }
  if (f.color) {
    // colors is JSON: [{"hex":"#...","name":"sage"}, ...]
    where.colors = { contains: `"name":"${escapeForJsonFragment(f.color)}"` };
  }
  if (f.season) {
    // season is JSON: ["spring","summer",...]
    where.season = { contains: `"${escapeForJsonFragment(f.season)}"` };
  }
  return where;
}

export default async function ClosetPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const filters = readFilters(searchParams);

  const [items, allForFacets, totalCount, valueAgg, dbUser] = await Promise.all([
    prisma.wardrobeItem.findMany({
      where: buildWhere(user.id, filters),
      orderBy: { createdAt: "desc" },
    }),
    prisma.wardrobeItem.findMany({
      where: { userId: user.id },
      select: { brand: true, colors: true },
    }),
    prisma.wardrobeItem.count({ where: { userId: user.id } }),
    // Wardrobe value = sum of priceCents for owned items (wishlist excluded).
    prisma.wardrobeItem.aggregate({
      where: { userId: user.id, isWishlist: false },
      _sum: { priceCents: true },
    }),
    prisma.user.findUnique({ where: { id: user.id }, select: { credits: true } }),
  ]);
  const credits = dbUser?.credits ?? 0;
  const totalValueCents = valueAgg._sum.priceCents ?? 0;
  const totalValueFormatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(totalValueCents / 100);

  const options: FilterOptions = {
    brands: [...new Set(allForFacets.map((i) => i.brand).filter((b): b is string => !!b))].sort(
      (a, b) => a.localeCompare(b),
    ),
    colors: [
      ...new Set(allForFacets.flatMap((i) => parseColors(i.colors).map((c) => c.name))),
    ].sort((a, b) => a.localeCompare(b)),
  };

  return (
    <main className="max-w-6xl mx-auto px-6 py-12">
      <header className="mb-10 flex items-start justify-between gap-6 flex-wrap">
        <div>
          <p className="font-serif text-5xl md:text-6xl tracking-tight leading-none">
            {totalValueFormatted}
          </p>
          <p className="mt-2 text-[10px] uppercase tracking-[0.18em] text-ink-muted">
            Wardrobe value
          </p>
          <h1 className="sr-only">Closet</h1>
        </div>
        <div className="flex flex-col items-end gap-2 pt-2">
          <nav className="flex items-center gap-3 text-sm">
            <Link
              href="/settings"
              className={`rounded-full px-3 py-1 text-xs tracking-wide transition ${
                credits < 10
                  ? "bg-amber-100 text-amber-900 hover:bg-amber-200"
                  : "bg-paper-warm text-ink hover:bg-ink/5"
              }`}
              title={credits < 10 ? "Running low on credits" : "Ghost-mannequin credits"}
            >
              ✨ {credits}
            </Link>
            <Link href="/settings" className="text-ink-muted hover:text-ink">
              Settings
            </Link>
          </nav>
          <span className="text-xs text-ink-muted">
            {items.length === totalCount
              ? `${totalCount} ${totalCount === 1 ? "piece" : "pieces"} in closet`
              : `${items.length} of ${totalCount} shown`}
          </span>
        </div>
      </header>

      {totalCount > 0 && <ClosetFilters options={options} initial={filters} />}

      {totalCount === 0 ? (
        <EmptyCloset />
      ) : items.length === 0 ? (
        <NoResults />
      ) : (
        <ul className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                href={`/closet/${item.id}`}
                className="block rounded-2xl bg-white shadow-tile overflow-hidden aspect-square relative group focus-visible:ring-2 focus-visible:ring-accent"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={thumbnailUrl(item.originalImagePath)}
                  alt={item.name}
                  loading="lazy"
                  className="w-full h-full object-cover"
                />
                {item.isWishlist && (
                  <span className="absolute top-2 left-2 bg-white/90 text-ink text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full">
                    Wishlist
                  </span>
                )}
                <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-ink/70 to-transparent text-white opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition">
                  <div className="text-xs font-medium truncate">{item.name}</div>
                  <div className="text-[10px] text-white/80 truncate">{item.brand ?? "—"}</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Link
        href="/closet/add"
        aria-label="Add item"
        className="fixed bottom-8 right-8 rounded-full bg-ink text-paper w-14 h-14 flex items-center justify-center text-2xl shadow-tile hover:bg-ink-soft transition"
      >
        +
      </Link>
    </main>
  );
}

function EmptyCloset() {
  return (
    <div className="rounded-2xl border border-ink/10 bg-paper-warm p-12 text-center">
      <p className="font-serif text-2xl">Your closet is empty.</p>
      <p className="text-ink-muted mt-2">Let&apos;s fix that.</p>
      <Link
        href="/closet/add"
        className="inline-block mt-6 rounded-full bg-ink text-paper px-6 py-2 text-sm tracking-wide hover:bg-ink-soft transition"
      >
        Upload your first piece
      </Link>
    </div>
  );
}

function NoResults() {
  return (
    <div className="rounded-2xl border border-ink/10 bg-paper-warm p-10 text-center">
      <p className="font-serif text-xl">Nothing matches those filters.</p>
      <p className="text-ink-muted text-sm mt-1">Try loosening a few.</p>
    </div>
  );
}
