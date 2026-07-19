"use client";

import { useMemo, useState } from "react";
import {
  ClosetFilters,
  type ActiveFilters,
  type FilterOptions,
} from "@/components/closet-filters";
import { ClosetGrid, type ClosetGridItem } from "@/components/closet-grid";
import {
  filterSortClosetItems,
  type ClosetFilterableItem,
} from "@/lib/closet-item-filter";
import { NONE_CATEGORY } from "@/lib/categories";
import type { SortOrders } from "@/lib/closet-sort";

export type ClosetPageItem = ClosetFilterableItem &
  Omit<ClosetGridItem, "createdAt" | "name" | "brand" | "category" | "colors" | "season" | "isWishlist">;

type Props = {
  allItems: ClosetPageItem[];
  options: FilterOptions;
  initialFilters: ActiveFilters;
  sortOrders: SortOrders;
  totalCount: number;
};

export function ClosetFilteredView({
  allItems,
  options,
  initialFilters,
  sortOrders,
  totalCount,
}: Props) {
  const [filters, setFilters] = useState(initialFilters);

  const filtered = useMemo(
    () => filterSortClosetItems(allItems, filters, sortOrders),
    [allItems, filters, sortOrders],
  );

  const filteredGridItems = useMemo(
    () =>
      filtered.map((item) => {
        const {
          id,
          name,
          brand,
          category,
          colors,
          imagePath,
          thumbZoom,
          mirror,
          isWishlist,
          createdAt,
          priceCents,
          season,
        } = item;
        return {
          id,
          name,
          brand,
          category,
          colors,
          imagePath,
          thumbZoom,
          mirror,
          isWishlist,
          createdAt: typeof createdAt === "string" ? createdAt : createdAt.toISOString(),
          priceCents,
          season,
        } satisfies ClosetGridItem;
      }),
    [filtered],
  );

  const filteredValueFormatted = useMemo(() => {
    const cents = filteredGridItems.reduce((sum, i) => sum + (i.priceCents ?? 0), 0);
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(cents / 100);
  }, [filteredGridItems]);

  return (
    <>
      <div className="mb-10 flex items-start justify-between gap-6 flex-wrap">
        <div>
          <p className="font-serif text-5xl md:text-6xl tracking-tight leading-none">
            {filteredValueFormatted}
          </p>
          <p className="mt-2 text-[10px] uppercase tracking-[0.18em] text-ink-muted">
            Wardrobe value
          </p>
        </div>
        <p className="text-xs text-ink-muted pt-2">
          {filteredGridItems.length === totalCount
            ? `${totalCount} ${totalCount === 1 ? "piece" : "pieces"} in closet`
            : `${filteredGridItems.length} of ${totalCount} shown`}
        </p>
      </div>

      {totalCount > 0 && (
        <ClosetFilters options={options} filters={filters} onFiltersChange={setFilters} />
      )}

      {filteredGridItems.length === 0 ? (
        <div className="rounded-2xl border border-ink/10 bg-paper-warm p-10 text-center">
          <p className="font-serif text-xl">Nothing matches those filters.</p>
          <p className="text-ink-muted text-sm mt-1">Try loosening a few.</p>
        </div>
      ) : (
        <ClosetGrid
          items={filteredGridItems}
          sort={filters.sort}
          sortOrders={sortOrders}
          noneCategoryLabel={NONE_CATEGORY}
        />
      )}
    </>
  );
}
