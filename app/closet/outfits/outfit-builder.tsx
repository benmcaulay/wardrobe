"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { builtinSlotLayout } from "@/lib/outfit-slot-defaults";
import { isNoneCategoryStored, NONE_CATEGORY } from "@/lib/categories";
import {
  MultiSelectFilter,
  type ActiveFilters,
} from "@/components/closet-filters";
import {
  FILTER_CATEGORY_NONE,
  filterClosetItems,
  type ClosetFilterableItem,
} from "@/lib/closet-item-filter";
import { encode, type Color } from "@/lib/json";
import { imageUrl, thumbnailUrl } from "@/lib/image-paths";
import { itemTileImageTransform } from "@/lib/item-tile-meta";
import { OUTFIT_PIECE_IMG_CLASS, resolveOutfitPieceDisplayUrl } from "@/lib/outfit-piece-image";
import { swapLayerOrder } from "@/lib/outfit-layer";
import {
  clampToFrame,
  computeFrameScale,
  toFrameSpace,
} from "@/lib/outfit-frame-scale";
import { SEASONS } from "@/lib/types";
import { deleteOutfitLayout, saveOutfitLayout } from "./actions";
import type { RandomOutfitItem } from "./random-outfit-builder";

export type OutfitClosetItem = RandomOutfitItem;

type PlacedPiece = {
  id: string;
  itemId: string;
  x: number;
  y: number;
  scale: number;
  z: number;
};

type SavedOutfit = {
  id: string;
  name: string;
  frameHeight: number;
  pieces: PlacedPiece[];
};

type Props = {
  items: OutfitClosetItem[];
  colorOptions: Color[];
  initialOutfits: SavedOutfit[];
  /**
   * Item ids to open with, handed over from elsewhere — the trip planner's
   * "Edit this look" passes the pieces of one day's outfit so they can be
   * arranged here. Seeded once on mount; afterwards the canvas is the user's.
   */
  initialPieceIds?: string[];
};
export type { SavedOutfit };
const BASE_PIECE_SIZE = 180;
const FRAME_WIDTH = 560;
const FRAME_MIN_HEIGHT = 520;
const FRAME_MAX_HEIGHT = 1200;
/** Space kept below the canvas when fitting it to the viewport (page py-12). */
const FRAME_GUTTER = 48;

const EMPTY_FILTERS: ActiveFilters = {
  q: "",
  categories: [],
  brand: "",
  colors: [],
  season: "",
  tag: "",
  owner: "",
  sort: "newest",
};

function toFilterable(item: OutfitClosetItem): ClosetFilterableItem {
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
    colors: encode(item.colors),
    owners: "[]", // outfit builder never filters by owner
    isWishlist: false,
    createdAt: new Date(0),
  };
}

export function OutfitBuilder({ items, colorOptions, initialOutfits, initialPieceIds }: Props) {
  const [pieces, setPieces] = useState<PlacedPiece[]>([]);
  const [selectedPieceId, setSelectedPieceId] = useState<string | null>(null);
  const [frameHeight, setFrameHeight] = useState(1000);
  const frameSlotRef = useRef<HTMLDivElement>(null);
  // Scale the fixed logical canvas to fit rather than resizing it — saved
  // pieces store absolute coordinates in that space.
  const [frameScale, setFrameScale] = useState(1);
  const [panelMaxHeight, setPanelMaxHeight] = useState<number | null>(null);

  useEffect(() => {
    function measure() {
      const slot = frameSlotRef.current;
      if (!slot) return;
      const top = slot.getBoundingClientRect().top + window.scrollY;
      const available = window.innerHeight - top - FRAME_GUTTER;
      setFrameScale(
        computeFrameScale({
          frameWidth: FRAME_WIDTH,
          frameHeight,
          availableHeight: available,
          availableWidth: slot.parentElement?.clientWidth ?? 0,
        }),
      );
      const wide = window.matchMedia("(min-width: 768px)").matches;
      setPanelMaxHeight(wide ? Math.max(320, available) : null);
    }
    let raf = 0;
    function schedule() {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    }
    schedule();
    window.addEventListener("resize", schedule);
    const observer = new ResizeObserver(schedule);
    observer.observe(document.documentElement);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", schedule);
      observer.disconnect();
    };
    // frameHeight is user-adjustable, so the fit has to follow it.
  }, [frameHeight]);
  const [filters, setFilters] = useState<ActiveFilters>(EMPTY_FILTERS);
  const [outfitName, setOutfitName] = useState("");
  const [savedOutfits, setSavedOutfits] = useState<SavedOutfit[]>(initialOutfits);
  const [dragState, setDragState] = useState<{ pieceId: string; dx: number; dy: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [processedImageUrls, setProcessedImageUrls] = useState<Record<string, string>>({});
  const urlRegistryRef = useRef<string[]>([]);

  useEffect(() => {
    return () => {
      for (const url of urlRegistryRef.current) URL.revokeObjectURL(url);
    };
  }, []);

  const itemsById = useMemo(() => {
    const map = new Map<string, OutfitClosetItem>();
    for (const item of items) map.set(item.id, item);
    return map;
  }, [items]);

  const filterableItems = useMemo(() => items.map(toFilterable), [items]);

  const filteredItems = useMemo(() => {
    const ids = new Set(filterClosetItems(filterableItems, filters).map((i) => i.id));
    return items.filter((item) => ids.has(item.id));
  }, [items, filterableItems, filters]);

  const { hasUncategorized, namedCategories, colorNames, brands, tags } = useMemo(() => {
    const hasUncategorized = items.some((item) => isNoneCategoryStored(item.category));
    const namedCategories = [
      ...new Set(
        items
          .map((item) => item.category.trim())
          .filter(Boolean)
          .filter((c) => !isNoneCategoryStored(c)),
      ),
    ].sort((a, b) => a.localeCompare(b));
    const fromItems = [
      ...new Set(items.flatMap((i) => i.colors.map((c) => c.name.trim()).filter(Boolean))),
    ];
    const fromPrefs = colorOptions.map((c) => c.name.trim()).filter(Boolean);
    const colorNames = [...new Set([...fromPrefs, ...fromItems])].sort((a, b) =>
      a.localeCompare(b),
    );
    const brands = [
      ...new Set(items.map((i) => i.brand?.trim()).filter((b): b is string => !!b)),
    ].sort((a, b) => a.localeCompare(b));
    const tags = [
      ...new Set(
        items.flatMap((i) => {
          try {
            const parsed = JSON.parse(i.styleTags) as unknown;
            return Array.isArray(parsed)
              ? parsed.map((t) => String(t).trim()).filter(Boolean)
              : [];
          } catch {
            return [];
          }
        }),
      ),
    ].sort((a, b) => a.localeCompare(b));
    return { hasUncategorized, namedCategories, colorNames, brands, tags };
  }, [items, colorOptions]);

  const categoryOptions = useMemo(() => {
    const opts = namedCategories.map((c) => ({ value: c, label: c }));
    if (hasUncategorized) {
      opts.unshift({ value: FILTER_CATEGORY_NONE, label: NONE_CATEGORY });
    }
    return opts;
  }, [namedCategories, hasUncategorized]);

  const activeFilterCount =
    (filters.q.trim() ? 1 : 0) +
    (filters.categories.length > 0 ? 1 : 0) +
    (filters.brand ? 1 : 0) +
    (filters.colors.length > 0 ? 1 : 0) +
    (filters.season ? 1 : 0) +
    (filters.tag ? 1 : 0);

  const selected = pieces.find((piece) => piece.id === selectedPieceId) ?? null;

  function nextZ(): number {
    return pieces.length === 0 ? 1 : Math.max(...pieces.map((p) => p.z)) + 1;
  }

  async function getProcessedUrl(item: OutfitClosetItem): Promise<string> {
    if (processedImageUrls[item.id]) return processedImageUrls[item.id]!;
    const out = await resolveOutfitPieceDisplayUrl(item.imagePath);
    if (out.startsWith("blob:")) urlRegistryRef.current.push(out);
    setProcessedImageUrls((prev) => ({ ...prev, [item.id]: out }));
    return out;
  }

  async function addPiece(item: OutfitClosetItem, placement?: { x: number; y: number }) {
    await getProcessedUrl(item);
    const id = crypto.randomUUID();
    const piece: PlacedPiece = {
      id,
      itemId: item.id,
      x: placement?.x ?? FRAME_WIDTH / 2,
      y: placement?.y ?? frameHeight / 2,
      scale: 1,
      z: nextZ(),
    };
    setPieces((prev) => [...prev, piece]);
    setSelectedPieceId(id);
  }

  /**
   * Seed the canvas from a handed-over look.
   *
   * Runs after mount rather than in the initial state because placing a piece
   * needs its processed (background-removed) image, which is async.
   *
   * The guard records the id list only once the loop *finishes*. Marking it up
   * front looked equivalent and was not: in development React mounts, cleans
   * up, and mounts again, so the first pass was cancelled after a single piece
   * and the second pass skipped itself — one garment on the canvas instead of
   * four. Clearing the canvas first makes the retry idempotent rather than
   * additive.
   */
  const seededIds = useRef<string | null>(null);
  useEffect(() => {
    const ids = initialPieceIds ?? [];
    const key = ids.join(",");
    if (key === "" || seededIds.current === key) return;

    let cancelled = false;
    void (async () => {
      const chosen = ids
        .map((id) => items.find((item) => item.id === id))
        .filter((item): item is OutfitClosetItem => item !== undefined);
      if (chosen.length === 0) return;

      /*
       * Build the whole canvas locally, then commit it in one setPieces.
       *
       * Adding piece by piece looked simpler and raced: the development
       * double-mount cancels the first pass mid-loop, and a setPieces it had
       * already issued landed after the second pass had cleared the canvas —
       * leaving the same garment on the frame twice. One atomic write cannot
       * interleave, so a cancelled pass leaves no trace at all.
       *
       * Each piece goes to its category's slot rather than the frame centre,
       * which is what a manual add uses. A handed-over look should arrive
       * looking like the look, not as four garments stacked on one spot.
       */
      const usedPerCategory = new Map<string, number>();
      const placed: PlacedPiece[] = [];
      for (const [i, item] of chosen.entries()) {
        if (cancelled) return;
        await getProcessedUrl(item);
        const category = item.category ?? "";
        const index = usedPerCategory.get(category) ?? 0;
        usedPerCategory.set(category, index + 1);
        const slot = builtinSlotLayout([category], index, FRAME_WIDTH, frameHeight);
        placed.push({
          id: crypto.randomUUID(),
          itemId: item.id,
          x: slot.x,
          y: slot.y,
          scale: 1,
          z: i + 1,
        });
      }
      if (cancelled) return;
      setPieces(placed);
      setSelectedPieceId(null);
      seededIds.current = key;
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPieceIds, items]);

  function updateSelectedScale(scale: number) {
    if (!selected) return;
    setPieces((prev) => prev.map((p) => (p.id === selected.id ? { ...p, scale } : p)));
  }

  function moveLayer(dir: -1 | 1) {
    if (!selected) return;
    setPieces((prev) => swapLayerOrder(prev, selected.id, dir) ?? prev);
  }

  function removeSelected() {
    if (!selected) return;
    setPieces((prev) => prev.filter((p) => p.id !== selected.id));
    setSelectedPieceId(null);
  }

  function saveOutfit() {
    const name = outfitName.trim();
    if (!name || pieces.length === 0) return;
    setError(null);
    startTransition(async () => {
      const res = await saveOutfitLayout({ name, frameHeight, pieces });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const record: SavedOutfit = {
        id: res.id,
        name,
        frameHeight,
        pieces,
      };
      setSavedOutfits((prev) => [record, ...prev].slice(0, 30));
      setOutfitName("");
    });
  }

  function loadOutfit(outfit: SavedOutfit) {
    setFrameHeight(outfit.frameHeight);
    setPieces(outfit.pieces);
    setSelectedPieceId(outfit.pieces[0]?.id ?? null);
    for (const piece of outfit.pieces) {
      const item = itemsById.get(piece.itemId);
      if (item) void getProcessedUrl(item);
    }
  }

  function removeOutfit(outfitId: string) {
    setError(null);
    startTransition(async () => {
      const res = await deleteOutfitLayout(outfitId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSavedOutfits((prev) => prev.filter((o) => o.id !== outfitId));
    });
  }

  function handlePiecePointerDown(
    e: React.PointerEvent<HTMLButtonElement>,
    piece: PlacedPiece,
  ) {
    const target = e.currentTarget;
    const rect = target.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const rx = rect.width * 0.25;
    const ry = rect.height * 0.25;
    const withinReducedHitbox =
      ((px - cx) * (px - cx)) / (rx * rx) + ((py - cy) * (py - cy)) / (ry * ry) <= 1;
    if (!withinReducedHitbox) return;

    const frame = target.parentElement;
    if (!frame) return;
    const frameRect = frame.getBoundingClientRect();

    setSelectedPieceId(piece.id);
    // Store drag offset in frame-local coordinates to avoid initial jump.
    const localDown = toFrameSpace(e.clientX, e.clientY, frameRect, frameScale);
    setDragState({
      pieceId: piece.id,
      dx: localDown.x - piece.x,
      dy: localDown.y - piece.y,
    });
    target.setPointerCapture(e.pointerId);
  }

  function handleCanvasPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragState) return;
    const frameRect = e.currentTarget.getBoundingClientRect();
    const local = toFrameSpace(e.clientX, e.clientY, frameRect, frameScale);
    const { x, y } = clampToFrame(
      local.x - dragState.dx,
      local.y - dragState.dy,
      FRAME_WIDTH,
      frameHeight,
    );
    setPieces((prev) =>
      prev.map((piece) => (piece.id === dragState.pieceId ? { ...piece, x, y } : piece)),
    );
  }

  function handleCanvasPointerUp() {
    setDragState(null);
  }

  function handleCanvasBackgroundPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest("[data-outfit-piece]")) return;
    setSelectedPieceId(null);
    (document.activeElement as HTMLElement | null)?.blur();
  }

  return (
    <div className="flex flex-col items-start gap-8 md:flex-row">
      <section className="w-full md:flex-1 md:min-w-0">
        {savedOutfits.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {savedOutfits.map((outfit) => (
              <div key={outfit.id} className="flex items-center rounded-full border border-ink/10 bg-white pr-1">
                <button
                  type="button"
                  onClick={() => loadOutfit(outfit)}
                  className="px-3 py-1 text-xs hover:text-ink"
                >
                  {outfit.name}
                </button>
                <button
                  type="button"
                  onClick={() => removeOutfit(outfit.id)}
                  className="w-5 h-5 rounded-full text-xs text-ink-muted hover:bg-ink/10 hover:text-ink"
                  aria-label={`Delete ${outfit.name}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="mb-3 flex items-center gap-3">
          <label className="text-xs text-ink-muted">Frame height</label>
          <input
            type="range"
            min={FRAME_MIN_HEIGHT}
            max={FRAME_MAX_HEIGHT}
            value={frameHeight}
            onChange={(e) => setFrameHeight(Number(e.target.value))}
            className="w-56 accent-ink"
          />
          <span className="text-xs text-ink-muted">{frameHeight}px</span>
        </div>

        <div
          ref={frameSlotRef}
          // overflow-hidden: transform:scale() shrinks the frame visually but
          // not its layout box, which would otherwise stretch the page.
          className="overflow-hidden"
          style={{ width: FRAME_WIDTH * frameScale, height: frameHeight * frameScale }}
        >
        <div
          className="relative surface-canvas rounded-2xl border border-ink/10 overflow-hidden shadow-tile"
          style={{
            width: FRAME_WIDTH,
            height: frameHeight,
            transform: `scale(${frameScale})`,
            transformOrigin: "top left",
          }}
          onPointerDown={handleCanvasBackgroundPointerDown}
          onPointerMove={handleCanvasPointerMove}
          onPointerUp={handleCanvasPointerUp}
          onPointerLeave={handleCanvasPointerUp}
        >
          <div className="absolute inset-0 bg-gradient-to-b from-paper-warm/70 to-white" />
          <div
            className="absolute left-1/2 -translate-x-1/2 bottom-8 w-40 rounded-full border border-ink/10 bg-paper/70"
            style={{ height: Math.max(220, frameHeight * 0.7) }}
          />
          {pieces
            .slice()
            .sort((a, b) => a.z - b.z)
            .map((piece) => {
              const item = itemsById.get(piece.itemId);
              if (!item) return null;
              const src = processedImageUrls[item.id] ?? imageUrl(item.imagePath);
              const size = BASE_PIECE_SIZE * piece.scale;
              const isSelected = piece.id === selectedPieceId;
              return (
                <button
                  key={piece.id}
                  type="button"
                  data-outfit-piece
                  onPointerDown={(e) => handlePiecePointerDown(e, piece)}
                  className={`absolute -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl outline-none focus:outline-none ${
                    isSelected ? "ring-1 ring-ink/30" : ""
                  }`}
                  style={{ left: piece.x, top: piece.y, zIndex: piece.z, width: size, height: size }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    key={item.id}
                    src={src}
                    alt={item.name}
                    className={OUTFIT_PIECE_IMG_CLASS}
                    style={{
                      transform: itemTileImageTransform({
                        thumbZoom: item.thumbZoom,
                        mirror: item.mirror,
                      }),
                    }}
                    draggable={false}
                  />
                </button>
              );
            })}
        </div>
        <p className="text-[11px] text-ink-muted mt-2">
          Near-white pixels (`#f0f0f0` and above) are made transparent for cleaner layering.
        </p>
        </div>
      </section>

      <aside
        className="w-full shrink-0 space-y-3 md:sticky md:top-6 md:w-[300px] md:overflow-y-auto md:pr-1"
        style={panelMaxHeight ? { maxHeight: panelMaxHeight } : undefined}
      >
        <div className="rounded-2xl border border-ink/10 bg-white p-3 space-y-2">
          <div className="text-[10px] uppercase tracking-wide text-ink-muted">Outfit</div>
          <div className="flex gap-2">
            <input
              type="text"
              value={outfitName}
              onChange={(e) => setOutfitName(e.target.value)}
              placeholder="Outfit name"
              className="w-full rounded-full border border-ink/10 px-3 py-1.5 text-xs bg-paper"
            />
            <button
              type="button"
              onClick={saveOutfit}
              disabled={!outfitName.trim() || pieces.length === 0 || pending}
              className="rounded-full bg-ink text-paper px-3 py-1.5 text-xs disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
          {error && <p className="text-[11px] text-red-700">{error}</p>}
          {selected ? (
            <div className="space-y-2 pt-1">
              <label className="block text-[10px] uppercase tracking-wide text-ink-muted">
                Piece size
              </label>
              <input
                type="range"
                min={0.5}
                max={2.2}
                step={0.05}
                value={selected.scale}
                onChange={(e) => updateSelectedScale(Number(e.target.value))}
                className="w-full accent-ink"
              />
              <label className="block text-[10px] uppercase tracking-wide text-ink-muted pt-1">
                Layer
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => moveLayer(-1)}
                  className="rounded-full border border-ink/15 px-3 py-1 text-xs"
                >
                  Send back
                </button>
                <button
                  type="button"
                  onClick={() => moveLayer(1)}
                  className="rounded-full border border-ink/15 px-3 py-1 text-xs"
                >
                  Bring forward
                </button>
                <button
                  type="button"
                  onClick={removeSelected}
                  className="rounded-full border border-red-200 text-red-700 px-3 py-1 text-xs"
                >
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-ink-muted">Select a piece on the frame to edit it.</p>
          )}
        </div>

        <div className="rounded-2xl border border-ink/10 bg-paper-warm p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-wide text-ink-muted">Your closet</div>
            <button
              type="button"
              onClick={() => {
                setPieces([]);
                setSelectedPieceId(null);
              }}
              className="text-[10px] text-ink-muted hover:text-ink"
            >
              Clear canvas
            </button>
          </div>

          <div className="relative">
            <input
              type="text"
              inputMode="search"
              enterKeyHint="search"
              value={filters.q}
              onChange={(e) => setFilters((prev) => ({ ...prev, q: e.target.value }))}
              placeholder="Search name, brand, color, tags…"
              aria-label="Search closet for outfit pieces"
              className="w-full rounded-full border border-ink/10 bg-white px-3 py-1.5 pr-8 text-xs focus:outline-none focus:border-ink/40"
            />
            {filters.q && (
              <button
                type="button"
                onClick={() => setFilters((prev) => ({ ...prev, q: "" }))}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink text-sm leading-none"
              >
                ×
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5">
            <MultiSelectFilter
              label="Category"
              selected={filters.categories}
              options={categoryOptions}
              onChange={(categories) => setFilters((prev) => ({ ...prev, categories }))}
              disabled={categoryOptions.length === 0}
            />
            <MultiSelectFilter
              label="Color"
              selected={filters.colors}
              options={colorNames.map((c) => ({ value: c, label: c }))}
              onChange={(colors) => setFilters((prev) => ({ ...prev, colors }))}
              disabled={colorNames.length === 0}
              formatLabel={(s) => s.charAt(0).toUpperCase() + s.slice(1)}
            />
            <label className="relative">
              <span className="sr-only">Brand</span>
              <select
                value={filters.brand}
                onChange={(e) => setFilters((prev) => ({ ...prev, brand: e.target.value }))}
                disabled={brands.length === 0}
                className={`appearance-none rounded-full border px-3 py-1.5 pr-7 text-xs cursor-pointer transition ${
                  filters.brand
                    ? "bg-ink text-paper border-ink"
                    : "bg-white border-ink/10 text-ink hover:border-ink/30"
                } disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                <option value="">Brand</option>
                {brands.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
              <span
                className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px]"
                aria-hidden
              >
                ▾
              </span>
            </label>
            <label className="relative">
              <span className="sr-only">Season</span>
              <select
                value={filters.season}
                onChange={(e) => setFilters((prev) => ({ ...prev, season: e.target.value }))}
                className={`appearance-none rounded-full border px-3 py-1.5 pr-7 text-xs cursor-pointer transition ${
                  filters.season
                    ? "bg-ink text-paper border-ink"
                    : "bg-white border-ink/10 text-ink hover:border-ink/30"
                }`}
              >
                <option value="">Season</option>
                {SEASONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <span
                className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px]"
                aria-hidden
              >
                ▾
              </span>
            </label>
            <label className="relative">
              <span className="sr-only">Tag</span>
              <select
                value={filters.tag}
                onChange={(e) => setFilters((prev) => ({ ...prev, tag: e.target.value }))}
                disabled={tags.length === 0}
                className={`appearance-none rounded-full border px-3 py-1.5 pr-7 text-xs cursor-pointer transition ${
                  filters.tag
                    ? "bg-ink text-paper border-ink"
                    : "bg-white border-ink/10 text-ink hover:border-ink/30"
                } disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                <option value="">Tag</option>
                {tags.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <span
                className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px]"
                aria-hidden
              >
                ▾
              </span>
            </label>
            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={() => setFilters(EMPTY_FILTERS)}
                className="text-[10px] text-ink-muted hover:text-ink underline underline-offset-2 px-1"
              >
                Clear ({activeFilterCount})
              </button>
            )}
          </div>

          <p className="text-[10px] text-ink-muted">
            {filteredItems.length} of {items.length} pieces
          </p>

          <ul className="space-y-2 max-h-[480px] overflow-auto pr-1">
            {filteredItems.length === 0 ? (
              <li className="text-xs text-ink-muted px-1 py-2">No pieces match these filters.</li>
            ) : (
              filteredItems.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => void addPiece(item)}
                    className="w-full rounded-xl bg-white border border-ink/10 hover:border-ink/25 p-2 flex items-center gap-2 text-left"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={thumbnailUrl(item.imagePath)}
                      alt=""
                      className="w-10 h-10 rounded object-cover bg-paper-warm flex-shrink-0 pointer-events-none"
                      style={{
                        transform: itemTileImageTransform({
                          thumbZoom: item.thumbZoom,
                          mirror: item.mirror,
                        }),
                      }}
                    />
                    <span className="min-w-0">
                      <span className="text-xs block truncate">{item.name}</span>
                      <span className="text-[10px] text-ink-muted">
                        {isNoneCategoryStored(item.category) ? NONE_CATEGORY : item.category}
                        {item.colors.length > 0
                          ? ` · ${item.colors.map((c) => c.name).join(", ")}`
                          : ""}
                      </span>
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      </aside>
    </div>
  );
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
