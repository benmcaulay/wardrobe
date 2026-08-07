import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getCategoriesListFromPrefs, isNoneCategoryStored, NONE_CATEGORY, normalizeCategoryName } from "@/lib/categories";
import { getColorsListFromPrefs } from "@/lib/colors";
import { prisma } from "@/lib/db";
import { parseColors, parseStringArray, parseStylePrefs } from "@/lib/json";
import { getStyleTagsListFromPrefs, normalizeStyleTagName } from "@/lib/preferences";
import {
  getOwnersFromPrefs,
  getPrimaryOwnerId,
  resolveItemOwnerIds,
  SHARED_OWNER_FILTER,
} from "@/lib/owners";
import { AddItemFab } from "@/components/add-item-fab";
import { ClosetFilteredView, type ClosetPageItem } from "@/components/closet-filtered-view";
import type { FilterOptions } from "@/components/closet-filters";
import {
  FILTER_CATEGORY_NONE,
  readFiltersFromSearchParams,
} from "@/lib/closet-item-filter";
import { readClosetSort } from "@/lib/closet-sort";
import {
  clearHiddenFilterValues,
  getHiddenFiltersFromPrefs,
} from "@/lib/closet-filter-visibility";

type SearchParams = {
  q?: string;
  category?: string;
  brand?: string;
  color?: string;
  season?: string;
  tag?: string;
  owner?: string;
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
  const rawFilters = readFiltersFromSearchParams(searchParams);

  // Credits are read by the layout for the drawer's badge, not here.
  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { stylePrefs: true },
  });
  const prefs = parseStylePrefs(dbUser?.stylePrefs);
  // A hidden control must not keep filtering — otherwise a stale value would
  // silently narrow the closet with no visible way to clear it.
  const hiddenFilters = getHiddenFiltersFromPrefs(prefs);
  // No explicit ?sort= means "open how I left it last time". An explicit param
  // still wins, so shared/bookmarked links keep their own ordering.
  const withSavedSort =
    searchParams.sort === undefined
      ? { ...rawFilters, sort: readClosetSort(prefs.defaultClosetSort) }
      : rawFilters;
  const filters = clearHiddenFilterValues(withSavedSort, hiddenFilters);
  const preferredCategories = getCategoriesListFromPrefs(prefs);
  const preferredColors = getColorsListFromPrefs(prefs);
  const preferredTags = getStyleTagsListFromPrefs(prefs);
  const ownersList = getOwnersFromPrefs(prefs);
  const primaryOwnerId = getPrimaryOwnerId(prefs);
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

  const ownerFilterOptions = ownersList.map((o) => ({ value: o.id, label: o.name }));
  // Only keep the owner param if it's a known owner or the "shared" sentinel.
  const validOwnerValues = new Set([...ownersList.map((o) => o.id), SHARED_OWNER_FILTER]);
  const resolvedOwner = validOwnerValues.has(filters.owner) ? filters.owner : "";

  const filtersForUi = { ...filters, tag: resolvedTag, owner: resolvedOwner };

  const options: FilterOptions = {
    categories: categoryFilterOptions,
    brands: [...new Set(allForFacets.map((i) => i.brand).filter((b): b is string => !!b))].sort(
      (a, b) => a.localeCompare(b),
    ),
    colors: colorFilterOptions,
    tags: tagFilterOptions,
    owners: ownerFilterOptions,
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
      owners: JSON.stringify(resolveItemOwnerIds(parseStringArray(item.owners), primaryOwnerId)),
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
      {/* Navigation lives in the drawer (app/closet/layout.tsx). The trigger is
          fixed to the top-right, so leave room for it. */}
      <header className="mb-2 pr-28">
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
        hiddenFilters={hiddenFilters}
          totalCount={totalCount}
        />
      )}

      <AddItemFab />
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
