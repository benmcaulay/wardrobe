"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ClosetFilterKey } from "@/lib/closet-filter-visibility";
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
import { fadeUp, springSoft } from "@/lib/ui-motion";

export type ClosetPageItem = ClosetFilterableItem &
  Omit<ClosetGridItem, "createdAt" | "name" | "brand" | "category" | "colors" | "season" | "isWishlist">;

type Props = {
  allItems: ClosetPageItem[];
  options: FilterOptions;
  initialFilters: ActiveFilters;
  sortOrders: SortOrders;
  totalCount: number;
  hiddenFilters?: readonly ClosetFilterKey[];
};

export function ClosetFilteredView({
  allItems,
  options,
  initialFilters,
  sortOrders,
  totalCount,
  hiddenFilters,
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

  const reduce = useReducedMotion();

  return (
    <>
      <motion.div
        className="mb-10 flex items-start justify-between gap-6 flex-wrap"
        variants={fadeUp}
        initial={reduce ? false : "hidden"}
        animate="show"
      >
        <div>
          <motion.p
            key={filteredValueFormatted}
            className="font-serif text-5xl md:text-6xl tracking-tight leading-none"
            initial={reduce ? false : { opacity: 0.55, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={springSoft}
          >
            {filteredValueFormatted}
          </motion.p>
          <p className="mt-2 text-[10px] uppercase tracking-[0.18em] text-ink-muted">
            Wardrobe value
          </p>
        </div>
        {/* mt-14 drops this clear of the fixed menu trigger (app/closet/layout.tsx). */}
        <p className="mt-14 text-xs text-ink-muted">
          {filteredGridItems.length === totalCount
            ? `${totalCount} ${totalCount === 1 ? "piece" : "pieces"} in closet`
            : `${filteredGridItems.length} of ${totalCount} shown`}
        </p>
      </motion.div>

      {totalCount > 0 && (
        <ClosetFilters
          options={options}
          filters={filters}
          onFiltersChange={setFilters}
          hiddenFilters={hiddenFilters}
        />
      )}

      <AnimatePresence mode="wait">
        {filteredGridItems.length === 0 ? (
          <motion.div
            key="empty"
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="rounded-2xl border border-ink/10 bg-paper-warm p-10 text-center"
          >
            <p className="font-serif text-xl">Nothing matches those filters.</p>
            <p className="text-ink-muted text-sm mt-1">Try loosening a few.</p>
          </motion.div>
        ) : (
          <motion.div
            key={`${filters.sort}-${filteredGridItems.length}-${filters.q}-${filters.categories.join(",")}-${filters.colors.join(",")}-${filters.tag}-${filters.owner}-${filters.brand}-${filters.season}`}
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <ClosetGrid
              items={filteredGridItems}
              sort={filters.sort}
              sortOrders={sortOrders}
              noneCategoryLabel={NONE_CATEGORY}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
