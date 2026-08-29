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
import { ClosetRail, type RailViewItem } from "@/components/closet-rail";
import {
  filterSortClosetItems,
  type ClosetFilterableItem,
} from "@/lib/closet-item-filter";
import { NONE_CATEGORY } from "@/lib/categories";
import type { SortOrders } from "@/lib/closet-sort";
import { fadeUp, springSoft } from "@/lib/ui-motion";

export type ClosetPageItem = ClosetFilterableItem &
  Omit<ClosetGridItem, "createdAt" | "name" | "brand" | "category" | "colors" | "season" | "isWishlist"> & {
    /** For the rail's time axis. Null means no wear has ever been logged. */
    lastWornAtMs: number | null;
  };

/** Grid to find a piece; rail to see the shape of the closet. */
type Layout = "grid" | "rail";

type Props = {
  allItems: ClosetPageItem[];
  options: FilterOptions;
  initialFilters: ActiveFilters;
  sortOrders: SortOrders;
  totalCount: number;
  hiddenFilters?: readonly ClosetFilterKey[];
  /** Server clock, so the rail's axis is identical on both sides of hydration. */
  nowMs: number;
};

export function ClosetFilteredView({
  allItems,
  options,
  initialFilters,
  sortOrders,
  totalCount,
  hiddenFilters,
  nowMs,
}: Props) {
  const [filters, setFilters] = useState(initialFilters);
  const [layout, setLayout] = useState<Layout>("grid");

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

  const railItems = useMemo<RailViewItem[]>(
    () =>
      filtered.map((item) => ({
        id: item.id,
        name: item.name,
        imagePath: item.imagePath,
        thumbZoom: item.thumbZoom,
        mirror: item.mirror,
        lastWornAtMs: item.lastWornAtMs,
      })),
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
        <div className="mt-14 flex items-center gap-3">
          <p className="text-xs text-ink-muted">
            {filteredGridItems.length === totalCount
              ? `${totalCount} ${totalCount === 1 ? "piece" : "pieces"} in closet`
              : `${filteredGridItems.length} of ${totalCount} shown`}
          </p>
          <div className="flex rounded-full bg-paper-warm p-0.5 text-xs">
            <LayoutButton active={layout === "grid"} onClick={() => setLayout("grid")}>
              Grid
            </LayoutButton>
            <LayoutButton active={layout === "rail"} onClick={() => setLayout("rail")}>
              Rail
            </LayoutButton>
          </div>
        </div>
      </motion.div>

      {totalCount > 0 && (
        <ClosetFilters
          options={options}
          filters={filters}
          onFiltersChange={setFilters}
          hiddenFilters={hiddenFilters}
        />
      )}

      {/*
        The results block below is keyed on the filters so a new query
        cross-fades — but deliberately NOT on the result count. The count used
        to be in that key, which meant any change to the number of tiles
        remounted the whole grid: a piece leaving the closet destroyed and
        rebuilt ClosetGrid, taking its vacancy state with it, so the hole it is
        supposed to hold open (lib/space/vacancy.ts) could never render. Every
        filter that can change the count is already in the key, so the count was
        redundant for the cross-fade as well as harmful.
      */}
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
            key={`${filters.sort}-${filters.q}-${filters.categories.join(",")}-${filters.colors.join(",")}-${filters.tag}-${filters.owner}-${filters.brand}-${filters.season}`}
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {layout === "rail" ? (
              <ClosetRail items={railItems} nowMs={nowMs} />
            ) : (
              <ClosetGrid
                items={filteredGridItems}
                sort={filters.sort}
                sortOrders={sortOrders}
                noneCategoryLabel={NONE_CATEGORY}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function LayoutButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-3 py-1 transition ${
        active ? "bg-surface text-ink shadow-tile" : "text-ink-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
