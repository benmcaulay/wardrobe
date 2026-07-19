import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getCategoriesListFromPrefs, isNoneCategoryStored, NONE_CATEGORY, normalizeCategoryName } from "@/lib/categories";
import { getColorsListFromPrefs } from "@/lib/colors";
import { prisma } from "@/lib/db";
import { parseColors, parseStringArray, parseStylePrefs } from "@/lib/json";
import { getStyleTagsListFromPrefs, normalizeStyleTagName } from "@/lib/preferences";
import { CreditMark } from "@/components/credit-mark";
import { ClosetFilteredView, type ClosetPageItem } from "@/components/closet-filtered-view";
import type { FilterOptions } from "@/components/closet-filters";
import {
  FILTER_CATEGORY_NONE,
  readFiltersFromSearchParams,
} from "@/lib/closet-item-filter";

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
  const filters = readFiltersFromSearchParams(searchParams);

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { credits: true, stylePrefs: true },
  });
  const credits = dbUser?.credits ?? 0;
  const prefs = parseStylePrefs(dbUser?.stylePrefs);
  const preferredCategories = getCategoriesListFromPrefs(prefs);
  const preferredColors = getColorsListFromPrefs(prefs);
  const preferredTags = getStyleTagsListFromPrefs(prefs);
  const sortOrders = {
    categoryOrder: preferredCategories,
    colorOrder: preferredColors.map((c) => c.name),
    closetGroupOrders: prefs.closetGroupOrders,
  };

  const [allItems, allForFacets, totalCount] = await Promise.all([
    prisma.wardrobeItem.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    }),
    prisma.wardrobeItem.findMany({
      where: { userId: user.id },
      select: { category: true, brand: true, colors: true, styleTags: true },
    }),
    prisma.wardrobeItem.count({ where: { userId: user.id } }),
  ]);

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

  const usedColorNames = [
    ...new Set(allForFacets.flatMap((i) => parseColors(i.colors).map((c) => c.name))),
  ];
  const colorFilterOptions: string[] = [];
  const seenColors = new Set<string>();
  function pushColorFilter(name: string) {
    const key = name.trim().toLowerCase();
    if (!key || seenColors.has(key)) return;
    seenColors.add(key);
    colorFilterOptions.push(name.trim());
  }
  for (const c of preferredColors) {
    if (usedColorNames.some((u) => u.trim().toLowerCase() === c.name.trim().toLowerCase())) {
      pushColorFilter(c.name);
    }
  }
  for (const u of usedColorNames) {
    if (!preferredColors.some((p) => p.name.trim().toLowerCase() === u.trim().toLowerCase())) {
      pushColorFilter(u);
    }
  }

  const tagParamNorm = normalizeStyleTagName(filters.tag);
  const resolvedTag =
    filters.tag && tagParamNorm
      ? (tagFilterOptions.find((t) => normalizeStyleTagName(t) === tagParamNorm) ?? filters.tag)
      : "";

  const filtersForUi = { ...filters, tag: resolvedTag };

  const options: FilterOptions = {
    categories: categoryFilterOptions,
    brands: [...new Set(allForFacets.map((i) => i.brand).filter((b): b is string => !!b))].sort(
      (a, b) => a.localeCompare(b),
    ),
    colors: colorFilterOptions,
    tags: tagFilterOptions,
  };

  const pageItems: ClosetPageItem[] = allItems.map((item) => {
    const bestImage = item.ghostImagePath ?? item.originalImagePath;
    const isGhost = !!item.ghostImagePath;
    const primaryMeta = readPrimaryGhostMeta(item.ghostViews, item.ghostImagePath);
    const tileMeta = isGhost
      ? primaryMeta
      : { mirror: item.originalMirror ?? false, thumbZoom: item.originalThumbZoom ?? 1 };
    return {
      id: item.id,
      name: item.name,
      brand: item.brand,
      category: item.category,
      subcategory: item.subcategory,
      pattern: item.pattern,
      material: item.material,
      styleTags: item.styleTags,
      notes: item.notes,
      season: item.season,
      colors: item.colors,
      isWishlist: item.isWishlist,
      createdAt: item.createdAt,
      imagePath: bestImage,
      thumbZoom: tileMeta.thumbZoom,
      mirror: tileMeta.mirror,
      priceCents: item.priceCents,
    };
  });

  return (
    <main className="max-w-[1800px] mx-auto px-6 py-12">
      <header className="mb-2 flex items-start justify-end gap-6 flex-wrap">
        <div className="flex flex-col items-end gap-2 pt-2 ml-auto">
          <nav className="flex items-center gap-3 text-sm">
            <Link
              href="/closet/scan"
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs tracking-wide bg-paper-warm text-ink hover:bg-ink/5 transition"
              title="Scan camera roll for garments"
            >
              Scan roll
            </Link>
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
              Trip Packing Assistant
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
        </div>
        <h1 className="sr-only">Closet</h1>
      </header>

      {totalCount === 0 ? (
        <EmptyCloset />
      ) : (
        <ClosetFilteredView
          allItems={pageItems}
          options={options}
          initialFilters={filtersForUi}
          sortOrders={sortOrders}
          totalCount={totalCount}
        />
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
