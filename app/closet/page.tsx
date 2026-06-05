import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import {
  getCategoriesListFromPrefs,
  isNoneCategoryStored,
  NONE_CATEGORY,
  normalizeCategoryName,
} from "@/lib/categories";
import { prisma } from "@/lib/db";
import { parseColors, parseStringArray, parseStylePrefs } from "@/lib/json";
import { getStyleTagsListFromPrefs, normalizeStyleTagName } from "@/lib/preferences";
import { thumbnailUrl } from "@/lib/uploads";
import { CreditMark } from "@/components/credit-mark";
import { ClosetFilters, type ActiveFilters, type FilterOptions } from "@/components/closet-filters";
import { readClosetSort, sortWardrobeItems } from "@/lib/closet-sort";

type SearchParams = {
  q?: string;
  category?: string;
  brand?: string;
  color?: string;
  season?: string;
  tag?: string;
  wishlist?: string;
  sort?: string;
};

function readFilters(params: SearchParams): ActiveFilters {
  return {
    q: (params.q ?? "").trim(),
    category: params.category ?? "",
    brand: params.brand ?? "",
    color: params.color ?? "",
    season: params.season ?? "",
    tag: params.tag ?? "",
    wishlist: params.wishlist === "1",
    sort: readClosetSort(params.sort),
  };
}

// Escape the dynamic portion so a brand called `foo"bar` doesn't break the
// JSON-fragment match. JSON strings never contain an unescaped double quote.
const escapeForJsonFragment = (s: string) => s.replace(/"/g, "");

/** URL param for “uncategorized” filter (empty string in DB). */
const FILTER_CATEGORY_NONE = "__none__";

function buildWhere(userId: string, f: ActiveFilters): Prisma.WardrobeItemWhereInput {
  const where: Prisma.WardrobeItemWhereInput = { userId };
  if (f.category === FILTER_CATEGORY_NONE) {
    where.category = { in: ["", NONE_CATEGORY] };
  } else if (f.category) {
    where.category = f.category;
  }
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

function itemHasStyleTag(styleTagsJson: string, tag: string): boolean {
  const want = normalizeStyleTagName(tag);
  if (!want) return true;
  return parseStringArray(styleTagsJson).some((t) => normalizeStyleTagName(t) === want);
}

function readPrimaryGhostMeta(
  ghostViewsRaw: string | null,
  ghostImagePath: string | null,
): { mirror: boolean; thumbZoom: number } {
  if (!ghostViewsRaw || !ghostImagePath) return { mirror: false, thumbZoom: 1 };
  try {
    const parsed = JSON.parse(ghostViewsRaw) as Array<{
      imagePath?: string;
      mirror?: boolean;
      thumbZoom?: number;
    }>;
    const primary = parsed.find((v) => v.imagePath === ghostImagePath);
    if (!primary) return { mirror: false, thumbZoom: 1 };
    return {
      mirror: !!primary.mirror,
      thumbZoom: typeof primary.thumbZoom === "number" ? primary.thumbZoom : 1,
    };
  } catch {
    return { mirror: false, thumbZoom: 1 };
  }
}

export default async function ClosetPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const filters = readFilters(searchParams);
  const closetFiltersKey = [
    filters.q,
    filters.category,
    filters.brand,
    filters.color,
    filters.season,
    filters.tag,
    filters.wishlist ? "1" : "",
    filters.sort,
  ].join("|");

  const filteredWhere = buildWhere(user.id, filters);
  const tagFilter = filters.tag.trim();

  const [items, allForFacets, totalCount, dbUser] = await Promise.all([
    prisma.wardrobeItem.findMany({
      where: filteredWhere,
      orderBy: { createdAt: "desc" },
    }).then((rows) => {
      const matched = tagFilter
        ? rows.filter((r) => itemHasStyleTag(r.styleTags, tagFilter))
        : rows;
      return sortWardrobeItems(matched, filters.sort);
    }),
    prisma.wardrobeItem.findMany({
      where: { userId: user.id },
      select: { category: true, brand: true, colors: true, styleTags: true },
    }),
    prisma.wardrobeItem.count({ where: { userId: user.id } }),
    prisma.user.findUnique({ where: { id: user.id }, select: { credits: true, stylePrefs: true } }),
  ]);
  const credits = dbUser?.credits ?? 0;

  const prefs = parseStylePrefs(dbUser?.stylePrefs);
  const preferredCategories = getCategoriesListFromPrefs(prefs);
  const preferredTags = getStyleTagsListFromPrefs(prefs);
  const hasUncategorized = allForFacets.some((i) => isNoneCategoryStored(i.category));
  const usedNonEmpty = [
    ...new Set(
      allForFacets
        .map((i) => i.category.trim())
        .filter(Boolean)
        .filter((c) => !isNoneCategoryStored(c)),
    ),
  ].sort((a, b) => a.localeCompare(b));

  const categoryFilterOptions: FilterOptions["categories"] = [];
  const seenFilter = new Set<string>();
  function pushCatFilter(value: string, label: string) {
    if (seenFilter.has(value)) return;
    seenFilter.add(value);
    categoryFilterOptions.push({ value, label });
  }
  if (hasUncategorized) {
    pushCatFilter(FILTER_CATEGORY_NONE, NONE_CATEGORY);
  }
  for (const c of preferredCategories) {
    pushCatFilter(c, c);
  }
  for (const u of usedNonEmpty) {
    if (!preferredCategories.some((p) => normalizeCategoryName(p) === normalizeCategoryName(u))) {
      pushCatFilter(u, u);
    }
  }

  const tagFilterOptions: string[] = [];
  const seenTags = new Set<string>();
  function pushTagFilter(label: string) {
    const key = normalizeStyleTagName(label);
    if (!key || seenTags.has(key)) return;
    seenTags.add(key);
    tagFilterOptions.push(label.trim());
  }
  for (const t of preferredTags) {
    pushTagFilter(t);
  }
  for (const i of allForFacets) {
    for (const t of parseStringArray(i.styleTags)) {
      if (!preferredTags.some((p) => normalizeStyleTagName(p) === normalizeStyleTagName(t))) {
        pushTagFilter(t);
      }
    }
  }
  tagFilterOptions.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  const tagParamNorm = normalizeStyleTagName(filters.tag);
  const resolvedTag =
    filters.tag && tagParamNorm
      ? (tagFilterOptions.find((t) => normalizeStyleTagName(t) === tagParamNorm) ?? filters.tag)
      : "";

  const filtersForUi: ActiveFilters = { ...filters, tag: resolvedTag };
  const totalValueCents = items.reduce((sum, i) => sum + (i.priceCents ?? 0), 0);
  const totalValueFormatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(totalValueCents / 100);

  const options: FilterOptions = {
    categories: categoryFilterOptions,
    brands: [...new Set(allForFacets.map((i) => i.brand).filter((b): b is string => !!b))].sort(
      (a, b) => a.localeCompare(b),
    ),
    colors: [
      ...new Set(allForFacets.flatMap((i) => parseColors(i.colors).map((c) => c.name))),
    ].sort((a, b) => a.localeCompare(b)),
    tags: tagFilterOptions,
  };

  return (
    <main className="max-w-[1800px] mx-auto px-6 py-12">
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
              href="/closet/try-on"
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs tracking-wide bg-paper-warm text-ink hover:bg-ink/5 transition"
              title="Virtual try-on"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/icons/try-on.png"
                alt=""
                className="h-3.5 w-3.5 object-contain shrink-0"
                aria-hidden
              />
              Try on
            </Link>
            <Link
              href="/closet/outfits"
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs tracking-wide bg-paper-warm text-ink hover:bg-ink/5 transition"
              title="Outfit builder"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/icons/outfits.png"
                alt=""
                className="h-3.5 w-3.5 object-contain shrink-0"
                aria-hidden
              />
              Outfits
            </Link>
            <Link
              href="/closet/smartpakker"
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs tracking-wide bg-paper-warm text-ink hover:bg-ink/5 transition"
              title="Pack for a trip"
            >
              SmartPakker
            </Link>
            <Link
              href="/closet/sell"
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs tracking-wide bg-paper-warm text-ink hover:bg-ink/5 transition"
              title="Swipe to sell"
            >
              Sell
            </Link>
            <Link
              href="/settings"
              className={`rounded-full px-3 py-1 text-xs tracking-wide transition ${
                credits < 10
                  ? "bg-amber-100 text-amber-900 hover:bg-amber-200"
                  : "bg-paper-warm text-ink hover:bg-ink/5"
              }`}
              title={credits < 10 ? "Running low on credits" : "Ghost-mannequin credits"}
            >
              <span className="inline-flex items-center gap-1">
                <CreditMark className="h-3.5 w-3.5" title="tokens" />
                {credits}
              </span>
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

      {totalCount > 0 && (
        <ClosetFilters key={closetFiltersKey} options={options} initial={filtersForUi} />
      )}

      {totalCount === 0 ? (
        <EmptyCloset />
      ) : items.length === 0 ? (
        <NoResults />
      ) : (
        <ul className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-8 2xl:grid-cols-10 gap-4">
          {items.map((item) => {
            // Best available variant: ghost > original.
            const bestImage = item.ghostImagePath ?? item.originalImagePath;
            const isGhost = !!item.ghostImagePath;
            const primaryMeta = readPrimaryGhostMeta(item.ghostViews, item.ghostImagePath);
            const tileMeta = isGhost
              ? primaryMeta
              : { mirror: item.originalMirror ?? false, thumbZoom: item.originalThumbZoom ?? 1 };
            return (
              <li key={item.id}>
                <Link
                  href={`/closet/${item.id}`}
                  className="block rounded-2xl bg-white shadow-tile overflow-hidden aspect-square relative group focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={thumbnailUrl(bestImage)}
                    alt={item.name}
                    loading="lazy"
                    className="w-full h-full object-cover"
                    style={{
                      transform: `scale(${tileMeta.thumbZoom}) ${
                        tileMeta.mirror ? "scaleX(-1)" : ""
                      }`,
                    }}
                  />
                  {item.isWishlist && (
                    <div className="absolute top-2 left-2 right-2 flex items-start justify-between gap-1">
                      <span className="bg-white/90 text-ink text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full">
                        Wishlist
                      </span>
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-ink/70 to-transparent text-white opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition">
                    <div className="text-xs font-medium truncate">{item.name}</div>
                    <div className="text-[10px] text-white/80 truncate">{item.brand ?? "—"}</div>
                    <div className="text-[10px] text-white/70 truncate">
                      {isNoneCategoryStored(item.category) ? NONE_CATEGORY : item.category}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
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
