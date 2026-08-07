"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { Color } from "@/lib/json";
import { isNoneCategoryStored, normalizeCategoryName } from "@/lib/categories";
import { imageUrl, thumbnailUrl } from "@/lib/image-paths";
import {
  categoryListSignature,
  diagnoseOutfitFill,
  formatCategoryList,
  itemMatchesCategories,
  pickRandomOutfit,
  type CategoryRule,
  type ColorRule,
  type OutfitFillIssue,
} from "@/lib/outfit-random";
import { CategorySlotIcon } from "@/components/category-slot-icon";
import { itemTileImageTransform } from "@/lib/item-tile-meta";
import { OUTFIT_PIECE_IMG_CLASS, resolveOutfitPieceDisplayUrl } from "@/lib/outfit-piece-image";
import { swapLayerOrder } from "@/lib/outfit-layer";
import {
  clampToFrame,
  computeFrameScale,
  toFrameSpace,
} from "@/lib/outfit-frame-scale";
import { saveOutfitSlotDefault } from "@/lib/actions/outfitSlotDefaults";
import {
  resolveSlotLayout,
  slotCategoryLabel,
  type OutfitSlotDefaults,
} from "@/lib/outfit-slot-defaults";
import { saveOutfitLayout } from "./actions";

export type RandomOutfitItem = {
  id: string;
  name: string;
  brand: string | null;
  category: string;
  subcategory: string | null;
  pattern: string | null;
  material: string | null;
  notes: string | null;
  season: string;
  styleTags: string;
  imagePath: string;
  colors: Color[];
  thumbZoom: number;
  mirror: boolean;
};

type CanvasSlot = {
  id: string;
  categories: string[];
  x: number;
  y: number;
  scale: number;
  z: number;
  mirror?: boolean;
  scaleTouched?: boolean;
  itemId?: string;
  locked?: boolean;
};

type Props = {
  items: RandomOutfitItem[];
  colorOptions: Color[];
  initialSlotDefaults: OutfitSlotDefaults;
};

const BASE_PIECE_SIZE = 180;
const FRAME_WIDTH = 560;
const FRAME_HEIGHT = 960;
/**
 * Space kept below the canvas when fitting it to the viewport. Covers the
 * page's own bottom padding (py-12) so the whole studio lands inside the fold.
 */
const FRAME_GUTTER = 48;
const SLOT_ICON_SIZE = 72;

export function RandomOutfitBuilder({ items, colorOptions, initialSlotDefaults }: Props) {
  const pickPool = useMemo(
    () => items.map((i) => ({ id: i.id, category: i.category, colors: i.colors })),
    [items],
  );

  const [categoryRules, setCategoryRules] = useState<CategoryRule[]>([]);
  const [colorRules, setColorRules] = useState<ColorRule[]>([]);
  const [multiSelect, setMultiSelect] = useState(false);
  const [draftCats, setDraftCats] = useState<string[]>([]);
  const [draftCount, setDraftCount] = useState(1);
  const [slots, setSlots] = useState<CanvasSlot[]>([]);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<{
    kind: "canvas";
    slotId: string;
    dx: number;
    dy: number;
  } | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [spinError, setSpinError] = useState<string | null>(null);
  const [outfitName, setOutfitName] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [slotDefaults, setSlotDefaults] = useState<OutfitSlotDefaults>(initialSlotDefaults);
  const [defaultSaveMessage, setDefaultSaveMessage] = useState<string | null>(null);
  const [defaultSavePending, setDefaultSavePending] = useState(false);
  const [processedImageUrls, setProcessedImageUrls] = useState<Record<string, string>>({});
  const processedImageUrlsRef = useRef(processedImageUrls);
  processedImageUrlsRef.current = processedImageUrls;
  const urlRegistryRef = useRef<string[]>([]);
  const frameRef = useRef<HTMLDivElement>(null);
  const frameSlotRef = useRef<HTMLDivElement>(null);
  // The canvas is a fixed logical space; we scale it to fit rather than resize
  // it, so saved piece coordinates keep meaning what they meant.
  const [frameScale, setFrameScale] = useState(1);
  // Height left for the side panel below the page header. A flat
  // `100dvh - gutter` overflows, because the panel starts partway down.
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
          frameHeight: FRAME_HEIGHT,
          availableHeight: available,
          availableWidth: slot.parentElement?.clientWidth ?? 0,
        }),
      );
      // Only cage the panel once the columns sit side by side (Tailwind md).
      const wide = window.matchMedia("(min-width: 768px)").matches;
      setPanelMaxHeight(wide ? Math.max(320, available) : null);
    }
    // Measure on the next frame: a resize fires before layout has settled, so
    // reading immediately can capture the previous viewport's geometry.
    let raf = 0;
    function schedule() {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    }

    schedule();
    window.addEventListener("resize", schedule);
    // documentElement's box tracks the viewport and is independent of
    // frameScale, so observing it can't feed back into itself.
    const observer = new ResizeObserver(schedule);
    observer.observe(document.documentElement);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", schedule);
      observer.disconnect();
    };
  }, []);
  const spinLockRef = useRef(false);
  const spinSeqRef = useRef(0);

  useEffect(() => {
    return () => {
      for (const url of urlRegistryRef.current) URL.revokeObjectURL(url);
    };
  }, []);

  useEffect(() => {
    setSlotDefaults(initialSlotDefaults);
  }, [initialSlotDefaults]);

  useEffect(() => {
    setSlots((prev) => syncSlotsWithRules(prev, categoryRules, slotDefaults));
  }, [categoryRules, slotDefaults]);

  const itemsById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const categoryOptions = useMemo(() => {
    const labels = new Map<string, string>();
    for (const item of items) {
      if (isNoneCategoryStored(item.category)) continue;
      const key = normalizeCategoryName(item.category);
      if (!key || labels.has(key)) continue;
      labels.set(key, item.category.trim());
    }
    return [...labels.values()].sort((a, b) => a.localeCompare(b));
  }, [items]);

  const colorNameOptions = useMemo(() => {
    const fromItems = [
      ...new Set(items.flatMap((i) => i.colors.map((c) => c.name)).filter(Boolean)),
    ];
    const merged = colorOptions.map((c) => c.name);
    for (const c of fromItems) {
      if (!merged.some((m) => m.toLowerCase() === c.toLowerCase())) merged.push(c);
    }
    return merged.sort((a, b) => a.localeCompare(b));
  }, [items, colorOptions]);

  const slotInputs = useMemo(
    () =>
      slots.map((s) => ({
        id: s.id,
        categories: s.categories,
        lockedItemId: s.locked && s.itemId ? s.itemId : undefined,
      })),
    [slots],
  );

  const fillIssue = useMemo(
    () => diagnoseOutfitFill(pickPool, slotInputs, categoryRules, colorRules),
    [pickPool, slotInputs, categoryRules, colorRules],
  );

  const readyToSpin = fillIssue === null;
  const spinHint = fillIssue && fillIssue.kind !== "no_combo" ? formatFillIssue(fillIssue) : null;
  const selected = slots.find((s) => s.id === selectedSlotId) ?? null;

  const assignableItems = useMemo(() => {
    if (!selected) return items;
    return items.filter((item) =>
      itemMatchesCategories(
        { id: item.id, category: item.category, colors: item.colors },
        selected.categories,
      ),
    );
  }, [items, selected]);

  async function ensurePieceUrl(item: RandomOutfitItem): Promise<string> {
    if (processedImageUrlsRef.current[item.id]) return processedImageUrlsRef.current[item.id]!;
    const out = await resolveOutfitPieceDisplayUrl(item.imagePath);
    if (out.startsWith("blob:")) urlRegistryRef.current.push(out);
    setProcessedImageUrls((prev) => ({ ...prev, [item.id]: out }));
    return out;
  }

  async function assignItemToSlot(item: RandomOutfitItem) {
    if (!selected) return;
    if (
      !itemMatchesCategories(
        { id: item.id, category: item.category, colors: item.colors },
        selected.categories,
      )
    ) {
      return;
    }
    await ensurePieceUrl(item);
    setSlots((prev) =>
      prev.map((s) =>
        s.id === selected.id
          ? { ...s, itemId: item.id, mirror: item.mirror, locked: false }
          : s,
      ),
    );
    setSpinError(null);
  }

  async function saveSelectedSlotDefault() {
    if (!selected) return;
    setDefaultSaveMessage(null);
    setDefaultSavePending(true);
    const layout = { x: selected.x, y: selected.y, scale: selected.scale };
    const res = await saveOutfitSlotDefault(selected.categories, layout);
    setDefaultSavePending(false);
    if (!res.ok) {
      setDefaultSaveMessage(res.error);
      return;
    }
    const key = categoryListSignature(selected.categories);
    setSlotDefaults((prev) => ({ ...prev, [key]: layout }));
    setDefaultSaveMessage(`Saved default for ${slotCategoryLabel(selected.categories)}.`);
  }

  function applyDefaultLayoutToSlot(slotId: string) {
    setSlots((prev) => {
      const target = prev.find((s) => s.id === slotId);
      if (!target) return prev;
      const sig = categoryListSignature(target.categories);
      let index = 0;
      for (const slot of prev) {
        if (slot.id === slotId) break;
        if (categoryListSignature(slot.categories) === sig) index += 1;
      }
      const layout = resolveSlotLayout(target.categories, index, slotDefaults);
      return prev.map((s) =>
        s.id === slotId
          ? { ...s, x: layout.x, y: layout.y, scale: layout.scale, scaleTouched: false }
          : s,
      );
    });
  }

  // Tap a chip in the single row: add a one-of rule, or remove it. Categories
  // that belong to a multi-select rule (OR-group or count > 1) are locked here
  // and managed in the multi-select list instead.
  function toggleSimpleCategory(cat: string) {
    setCategoryRules((prev) => {
      const key = normalizeCategoryName(cat);
      const idx = prev.findIndex((r) => r.categories.some((c) => normalizeCategoryName(c) === key));
      if (idx >= 0) {
        const r = prev[idx]!;
        if (r.categories.length === 1 && r.count === 1) return prev.filter((_, i) => i !== idx);
        return prev; // in a multi-select rule — locked
      }
      return [...prev, { categories: [cat], count: 1 }];
    });
    setSpinError(null);
  }

  function toggleDraftCategory(cat: string) {
    const key = normalizeCategoryName(cat);
    setDraftCats((prev) =>
      prev.some((c) => normalizeCategoryName(c) === key)
        ? prev.filter((c) => normalizeCategoryName(c) !== key)
        : [...prev, cat],
    );
  }

  function addMultiSelectRule() {
    if (draftCats.length === 0) return;
    setCategoryRules((prev) => [...prev, { categories: draftCats, count: Math.max(1, draftCount) }]);
    setDraftCats([]);
    setDraftCount(1);
    setSpinError(null);
  }

  function removeCategoryRule(index: number) {
    setCategoryRules((prev) => prev.filter((_, i) => i !== index));
    setSpinError(null);
  }

  function addColorRule() {
    const name = colorNameOptions[0] ?? "black";
    setColorRules((prev) => [...prev, { colorName: name, count: 1 }]);
  }

  function updateColorRule(index: number, patch: Partial<ColorRule>) {
    setColorRules((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function removeColorRule(index: number) {
    setColorRules((prev) => prev.filter((_, i) => i !== index));
  }

  function removeSlot(id: string) {
    setSlots((prev) => prev.filter((s) => s.id !== id));
    if (selectedSlotId === id) setSelectedSlotId(null);
  }

  async function spin() {
    if (!readyToSpin || spinLockRef.current) return;
    spinLockRef.current = true;
    const seq = ++spinSeqRef.current;
    setSpinning(true);
    setSpinError(null);
    try {
      const assignment = pickRandomOutfit(pickPool, slotInputs, colorRules);
      if (!assignment) {
        const after = diagnoseOutfitFill(pickPool, slotInputs, categoryRules, colorRules);
        setSpinError(
          after?.kind === "no_combo"
            ? "No combination satisfies your color rules together. Try loosening them or unlock a slot."
            : "Could not build an outfit — check the message below your rules.",
        );
        return;
      }

      const urlUpdates: Record<string, string> = {};
      for (const itemId of new Set(assignment.values())) {
        const item = itemsById.get(itemId);
        if (!item || processedImageUrlsRef.current[item.id] || urlUpdates[item.id]) continue;
        const out = await resolveOutfitPieceDisplayUrl(item.imagePath);
        if (seq !== spinSeqRef.current) return;
        if (out.startsWith("blob:")) urlRegistryRef.current.push(out);
        urlUpdates[item.id] = out;
      }

      if (seq !== spinSeqRef.current) return;

      if (Object.keys(urlUpdates).length > 0) {
        setProcessedImageUrls((prev) => ({ ...prev, ...urlUpdates }));
      }
      setSlots((prev) =>
        prev.map((s) => {
          if (s.locked && s.itemId) return s;
          const nextId = assignment.get(s.id);
          if (!nextId) return { ...s, itemId: undefined, mirror: undefined };
          const item = itemsById.get(nextId);
          return {
            ...s,
            itemId: nextId,
            mirror: item?.mirror ?? false,
          };
        }),
      );
    } finally {
      spinLockRef.current = false;
      if (seq === spinSeqRef.current) setSpinning(false);
    }
  }

  function clearItems() {
    setSlots((prev) =>
      prev.map((s) => (s.locked ? s : { ...s, itemId: undefined, mirror: undefined })),
    );
    setSpinError(null);
  }

  function toggleSlotLock(slotId: string) {
    setSlots((prev) =>
      prev.map((s) => {
        if (s.id !== slotId) return s;
        const locked = !s.locked;
        return locked && !s.itemId ? s : { ...s, locked };
      }),
    );
  }

  function moveSlotLayer(dir: -1 | 1) {
    if (!selected) return;
    setSlots((prev) => swapLayerOrder(prev, selected.id, dir) ?? prev);
  }

  function saveOutfit() {
    const name = outfitName.trim();
    const filled = slots.filter((s) => s.itemId);
    if (!name || filled.length === 0) return;
    setSaveError(null);
    startTransition(async () => {
      const pieces = filled.map((s) => ({
        id: s.id,
        itemId: s.itemId!,
        x: s.x,
        y: s.y,
        scale: s.scale,
        z: s.z,
      }));
      const res = await saveOutfitLayout({ name, frameHeight: FRAME_HEIGHT, pieces });
      if (!res.ok) {
        setSaveError(res.error);
        return;
      }
      setOutfitName("");
    });
  }

  function handleFramePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragState || !frameRef.current) return;
    const rect = frameRef.current.getBoundingClientRect();
    const local = toFrameSpace(e.clientX, e.clientY, rect, frameScale);
    const { x, y } = clampToFrame(
      local.x - dragState.dx,
      local.y - dragState.dy,
      FRAME_WIDTH,
      FRAME_HEIGHT,
    );
    setSlots((prev) =>
      prev.map((s) => (s.id === dragState.slotId ? { ...s, x, y } : s)),
    );
  }

  function handleFramePointerUp() {
    if (dragState) setDragState(null);
  }

  function handleFrameBackgroundPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest("[data-outfit-slot]")) return;
    setSelectedSlotId(null);
    (document.activeElement as HTMLElement | null)?.blur();
  }

  function startCanvasDrag(e: React.PointerEvent<HTMLButtonElement>, slot: CanvasSlot) {
    if (!frameRef.current) return;
    const frameRect = frameRef.current.getBoundingClientRect();
    const localDown = toFrameSpace(e.clientX, e.clientY, frameRect, frameScale);
    setSelectedSlotId(slot.id);
    setDragState({
      kind: "canvas",
      slotId: slot.id,
      dx: localDown.x - slot.x,
      dy: localDown.y - slot.y,
    });
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  return (
    <div className="flex flex-col items-start gap-8 md:flex-row">
      <section className="w-full md:flex-1 md:min-w-0">
        <div className="flex flex-col items-center gap-5 md:flex-row md:items-center md:justify-center md:gap-6">
        <div className="flex flex-row flex-wrap items-center justify-center gap-3 md:flex-col md:items-stretch md:w-[132px]">
          <button
            type="button"
            onClick={() => void spin()}
            disabled={!readyToSpin || spinning}
            aria-label={spinning ? "Spinning…" : "Spin outfit"}
            className="group relative mx-auto flex h-[104px] w-[104px] items-center justify-center rounded-full border-2 border-dashed border-ink/30 bg-white text-ink transition hover:border-ink/50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span
              aria-hidden
              className={`pointer-events-none absolute inset-0 rounded-full ${
                spinning
                  ? "animate-spin"
                  : "group-hover:animate-spin motion-reduce:group-hover:animate-none"
              }`}
            >
              <span className="absolute left-1/2 top-0 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent" />
            </span>
            <span className="text-sm font-medium tracking-wide">
              {spinning ? "Spinning…" : "Spin"}
            </span>
          </button>
          {slots.some((s) => s.itemId) && (
            <button
              type="button"
              onClick={clearItems}
              className="rounded-full border border-ink/15 px-5 py-2 text-sm hover:bg-paper-warm transition"
            >
              Clear items
            </button>
          )}
          {spinError && (
            <p role="alert" className="text-xs text-red-700 text-center">
              {spinError}
            </p>
          )}
          {spinHint && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-2 py-2 text-center">
              {spinHint}
            </p>
          )}
        </div>
        {/* Reserves the on-screen footprint of the scaled canvas so the page
            doesn't leave a gap the size of the unscaled frame. */}
        <div
          ref={frameSlotRef}
          // overflow-hidden matters: transform:scale() shrinks the frame
          // visually but not its layout box, so without clipping the full
          // unscaled height still stretches the page.
          className="overflow-hidden"
          style={{ width: FRAME_WIDTH * frameScale, height: FRAME_HEIGHT * frameScale }}
        >
        <div
          ref={frameRef}
          className="relative surface-canvas rounded-2xl border border-ink/10 overflow-hidden shadow-tile"
          style={{
            width: FRAME_WIDTH,
            height: FRAME_HEIGHT,
            transform: `scale(${frameScale})`,
            transformOrigin: "top left",
          }}
          onPointerDown={handleFrameBackgroundPointerDown}
          onPointerMove={handleFramePointerMove}
          onPointerUp={handleFramePointerUp}
          onPointerLeave={handleFramePointerUp}
        >
          <div className="absolute inset-0 bg-gradient-to-b from-paper-warm to-paper" />
          {/* Mannequin silhouette (head + body) so the empty frame reads as a figure. */}
          <div className="pointer-events-none absolute inset-x-0 top-12 bottom-10 flex flex-col items-center">
            <div className="h-28 w-28 rounded-full bg-ink/[0.07] ring-1 ring-ink/15" />
            <div className="mt-4 w-48 flex-1 rounded-[90px] bg-ink/[0.06] ring-1 ring-ink/15" />
          </div>
          {slots
            .slice()
            .sort((a, b) => a.z - b.z)
            .map((slot) => {
              const item = slot.itemId ? itemsById.get(slot.itemId) : null;
              const isSelected = slot.id === selectedSlotId;
              const size = item ? BASE_PIECE_SIZE * slot.scale : SLOT_ICON_SIZE;
              const mirror = slot.mirror ?? item?.mirror ?? false;
              const thumbZoom = item?.thumbZoom ?? 1;
              return (
                <button
                  key={slot.id}
                  type="button"
                  data-outfit-slot
                  onPointerDown={(e) => startCanvasDrag(e, slot)}
                  className={`absolute -translate-x-1/2 -translate-y-1/2 touch-none overflow-hidden rounded-xl outline-none focus:outline-none ${
                    isSelected ? "ring-1 ring-ink/30" : ""
                  } ${item ? "" : "border-2 border-dashed border-ink/20 bg-white/80"} ${
                    slot.locked ? "ring-2 ring-accent/50" : ""
                  }`}
                  style={{ left: slot.x, top: slot.y, zIndex: slot.z, width: size, height: size }}
                >
                  {item ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      key={item.id}
                      src={processedImageUrls[item.id] ?? imageUrl(item.imagePath)}
                      alt={item.name}
                      className={OUTFIT_PIECE_IMG_CLASS}
                      style={{
                        transform: itemTileImageTransform({ thumbZoom, mirror }),
                      }}
                      draggable={false}
                    />
                  ) : (
                    <CategorySlotIcon categories={slot.categories} />
                  )}
                </button>
              );
            })}
        </div>

        </div>
        </div>
      </section>

      <aside
        className="w-full shrink-0 space-y-4 md:sticky md:top-6 md:w-[380px] md:overflow-y-auto md:pr-1"
        style={panelMaxHeight ? { maxHeight: panelMaxHeight } : undefined}
      >
        <div className="rounded-2xl border border-ink/10 bg-white p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[10px] uppercase tracking-wide text-ink-muted">Category rules</div>
            <label className="flex items-center gap-1.5 text-[11px] text-ink-muted cursor-pointer select-none">
              Multi-select
              <input
                type="checkbox"
                checked={multiSelect}
                onChange={(e) => setMultiSelect(e.target.checked)}
                className="accent-ink"
              />
            </label>
          </div>
          <p className="text-xs text-ink-muted">
            Tap a category to include one. Turn on multi-select to combine categories (OR) or pick
            multiples.
          </p>

          {categoryOptions.length === 0 ? (
            <p className="text-xs text-ink-muted/80 italic">
              Your closet has no categorized pieces yet.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {categoryOptions.map((cat) => {
                const key = normalizeCategoryName(cat);
                const rule = categoryRules.find((r) =>
                  r.categories.some((c) => normalizeCategoryName(c) === key),
                );
                const active = !!rule;
                const locked = !!rule && !(rule.categories.length === 1 && rule.count === 1);
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => toggleSimpleCategory(cat)}
                    disabled={locked}
                    title={locked ? "Managed in multi-select below" : undefined}
                    className={`rounded-full px-2.5 py-1 text-[10px] uppercase tracking-wide border transition capitalize disabled:cursor-not-allowed ${
                      active
                        ? "bg-ink text-paper border-ink"
                        : "bg-paper border-ink/10 text-ink-muted hover:border-ink/25"
                    } ${locked ? "opacity-60" : ""}`}
                  >
                    {cat}
                    {rule && rule.count > 1 ? ` ×${rule.count}` : ""}
                  </button>
                );
              })}
            </div>
          )}

          {categoryRules.some((r) => r.categories.length > 1 || r.count !== 1) && (
            <div className="flex flex-wrap gap-1.5">
              {categoryRules.map((rule, idx) =>
                rule.categories.length > 1 || rule.count !== 1 ? (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1 rounded-full bg-ink text-paper pl-2.5 pr-1 py-1 text-[10px] uppercase tracking-wide capitalize"
                  >
                    {rule.categories.join(" / ")}
                    {rule.count > 1 ? ` ×${rule.count}` : ""}
                    <button
                      type="button"
                      onClick={() => removeCategoryRule(idx)}
                      className="w-4 h-4 rounded-full hover:bg-paper/20"
                      aria-label="Remove rule"
                    >
                      ×
                    </button>
                  </span>
                ) : null,
              )}
            </div>
          )}

          {multiSelect && (
            <div className="rounded-xl border border-ink/10 bg-paper-warm/50 p-2.5 space-y-2">
              <div className="text-[10px] text-ink-muted">
                Pick categories to combine (matches any — “or”), then how many.
              </div>
              <div className="flex flex-wrap gap-1.5">
                {categoryOptions
                  .filter((cat) => {
                    const key = normalizeCategoryName(cat);
                    const claimed = categoryRules.some((r) =>
                      r.categories.some((c) => normalizeCategoryName(c) === key),
                    );
                    return !claimed;
                  })
                  .map((cat) => {
                    const on = draftCats.some(
                      (c) => normalizeCategoryName(c) === normalizeCategoryName(cat),
                    );
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => toggleDraftCategory(cat)}
                        className={`rounded-full px-2.5 py-1 text-[10px] uppercase tracking-wide border transition capitalize ${
                          on
                            ? "bg-accent text-white border-accent"
                            : "bg-white border-ink/10 text-ink-muted hover:border-ink/25"
                        }`}
                      >
                        {cat}
                      </button>
                    );
                  })}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-ink-muted shrink-0">How many</span>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={draftCount}
                  onChange={(e) => setDraftCount(Math.max(1, Math.min(5, Number(e.target.value) || 1)))}
                  className="w-12 rounded-full border border-ink/10 px-2 py-1.5 text-xs text-center bg-paper"
                  aria-label="How many"
                />
                <button
                  type="button"
                  onClick={addMultiSelectRule}
                  disabled={draftCats.length === 0}
                  className="ml-auto rounded-full bg-ink text-paper px-3 py-1.5 text-xs hover:bg-ink-soft transition disabled:opacity-40"
                >
                  Add rule
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-ink/10 bg-white p-4 space-y-3">
          <div className="text-[10px] uppercase tracking-wide text-ink-muted">Color rules</div>
          <p className="text-xs text-ink-muted">
            Optional — counts items whose <span className="text-ink">primary color</span> (★ in the
            editor) matches, e.g. 2 black pieces.
          </p>
          {colorRules.length === 0 ? (
            <p className="text-xs text-ink-muted/80 italic">No color rules yet.</p>
          ) : (
            <ul className="space-y-2">
              {colorRules.map((rule, idx) => (
                <li key={idx} className="flex items-center gap-2">
                  <select
                    value={rule.colorName}
                    onChange={(e) => updateColorRule(idx, { colorName: e.target.value })}
                    className="flex-1 min-w-0 rounded-full border border-ink/10 px-2 py-1.5 text-xs bg-paper capitalize"
                  >
                    {colorNameOptions.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={1}
                    max={5}
                    value={rule.count}
                    onChange={(e) =>
                      updateColorRule(idx, { count: Math.max(1, Number(e.target.value) || 1) })
                    }
                    className="w-12 rounded-full border border-ink/10 px-2 py-1.5 text-xs text-center bg-paper"
                    aria-label="Count"
                  />
                  <button
                    type="button"
                    onClick={() => removeColorRule(idx)}
                    className="w-7 h-7 rounded-full text-ink-muted hover:bg-ink/10"
                    aria-label="Remove color rule"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={addColorRule}
            disabled={colorNameOptions.length === 0}
            className="text-xs text-ink-muted hover:text-ink underline underline-offset-2 disabled:opacity-40"
          >
            + Add color rule
          </button>
        </div>

        {selected && (
          <div className="rounded-2xl border border-ink/10 bg-white p-4 space-y-3">
            <div className="text-[10px] uppercase tracking-wide text-ink-muted">Selected slot</div>
            <p className="text-sm capitalize">{formatCategoryList(selected.categories)}</p>
            {selected.itemId && (
              <p className="text-xs text-ink-muted truncate">
                {itemsById.get(selected.itemId)?.name}
              </p>
            )}
            <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
              <input
                type="checkbox"
                className="accent-ink"
                checked={!!selected.locked}
                disabled={!selected.itemId}
                onChange={() => toggleSlotLock(selected.id)}
              />
              <span>
                Lock piece{" "}
                <span className="text-ink-muted">(keeps this item when you spin again)</span>
              </span>
            </label>
            <label className="block text-[10px] uppercase tracking-wide text-ink-muted">Size</label>
            <input
              type="range"
              min={0.5}
              max={2.2}
              step={0.05}
              value={selected.scale}
              onChange={(e) => {
                const scale = Number(e.target.value);
                setSlots((prev) =>
                  prev.map((s) =>
                    s.id === selected.id ? { ...s, scale, scaleTouched: true } : s,
                  ),
                );
              }}
              className="w-full accent-ink"
            />
            <label className="block text-[10px] uppercase tracking-wide text-ink-muted">Layer</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => moveSlotLayer(-1)}
                className="rounded-full border border-ink/15 px-3 py-1 text-xs hover:bg-paper-warm"
              >
                Send back
              </button>
              <button
                type="button"
                onClick={() => moveSlotLayer(1)}
                className="rounded-full border border-ink/15 px-3 py-1 text-xs hover:bg-paper-warm"
              >
                Bring forward
              </button>
            </div>
            <p className="text-[10px] text-ink-muted">
              Drag the slot on the frame to adjust placement, then save as the default for this
              category.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void saveSelectedSlotDefault()}
                disabled={defaultSavePending}
                className="rounded-full border border-ink/15 px-3 py-1 text-xs hover:bg-paper-warm disabled:opacity-50"
              >
                {defaultSavePending ? "Saving…" : `Save default for ${slotCategoryLabel(selected.categories)}`}
              </button>
              <button
                type="button"
                onClick={() => applyDefaultLayoutToSlot(selected.id)}
                className="rounded-full border border-ink/15 px-3 py-1 text-xs hover:bg-paper-warm"
              >
                Reset to default
              </button>
            </div>
            {defaultSaveMessage && (
              <p className="text-[11px] text-ink-muted">{defaultSaveMessage}</p>
            )}
            <button
              type="button"
              onClick={() => removeSlot(selected.id)}
              className="rounded-full border border-red-200 text-red-700 px-3 py-1 text-xs"
            >
              Remove slot
            </button>
          </div>
        )}

        <div className="rounded-2xl border border-ink/10 bg-white p-3 max-h-64 overflow-auto">
          <div className="text-[10px] uppercase tracking-wide text-ink-muted mb-2">Your closet</div>
          {selected ? (
            <p className="text-xs text-ink-muted mb-2">
              Tap a piece to fill this slot ({formatCategoryList(selected.categories)}).
            </p>
          ) : (
            <p className="text-xs text-ink-muted mb-2">Select a slot on the frame to assign a piece.</p>
          )}
          <ul className="space-y-1">
            {assignableItems.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  disabled={!selected}
                  onClick={() => void assignItemToSlot(item)}
                  className="w-full flex items-center gap-2 text-xs rounded-lg px-1 py-1 hover:bg-paper-warm disabled:opacity-50 disabled:hover:bg-transparent text-left"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={thumbnailUrl(item.imagePath)}
                    alt=""
                    className="w-8 h-8 rounded object-cover bg-paper-warm flex-shrink-0"
                    style={{
                      transform: itemTileImageTransform({
                        thumbZoom: item.thumbZoom,
                        mirror: item.mirror,
                      }),
                    }}
                  />
                  <span className="truncate flex-1">{item.name}</span>
                  <span className="text-ink-muted capitalize shrink-0">{item.category}</span>
                </button>
              </li>
            ))}
          </ul>
          {selected && assignableItems.length === 0 && (
            <p className="text-xs text-ink-muted italic mt-2">No closet pieces match this slot.</p>
          )}
        </div>

        <div className="rounded-2xl border border-ink/10 bg-white p-4 space-y-2">
          <div className="text-[10px] uppercase tracking-wide text-ink-muted">Save spin</div>
          <div className="flex gap-2">
            <input
              type="text"
              value={outfitName}
              onChange={(e) => setOutfitName(e.target.value)}
              placeholder="Outfit name"
              className="flex-1 rounded-full border border-ink/10 px-3 py-1.5 text-xs bg-paper"
            />
            <button
              type="button"
              onClick={saveOutfit}
              disabled={!outfitName.trim() || !slots.some((s) => s.itemId) || pending}
              className="rounded-full bg-ink text-paper px-3 py-1.5 text-xs disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
          {saveError && <p className="text-[11px] text-red-700">{saveError}</p>}
        </div>
      </aside>
    </div>
  );
}

function syncSlotsWithRules(
  slots: CanvasSlot[],
  rules: CategoryRule[],
  defaults: OutfitSlotDefaults,
): CanvasSlot[] {
  const required: { categories: string[]; sig: string }[] = [];
  for (const rule of rules) {
    const cats = rule.categories.map((c) => c.trim()).filter(Boolean);
    if (cats.length === 0) continue;
    const sig = categoryListSignature(cats);
    const n = Math.max(0, Math.floor(rule.count));
    for (let i = 0; i < n; i++) {
      required.push({ categories: [...cats], sig });
    }
  }

  const poolBySig = new Map<string, CanvasSlot[]>();
  for (const slot of slots) {
    const sig = categoryListSignature(slot.categories);
    if (!sig) continue;
    if (!poolBySig.has(sig)) poolBySig.set(sig, []);
    poolBySig.get(sig)!.push(slot);
  }

  const usedBySig = new Map<string, number>();
  const synced: CanvasSlot[] = [];

  for (const req of required) {
    const used = usedBySig.get(req.sig) ?? 0;
    const pool = poolBySig.get(req.sig) ?? [];
    if (used < pool.length) {
      synced.push(pool[used]!);
    } else {
      const layout = resolveSlotLayout(req.categories, used, defaults);
      synced.push({
        id: crypto.randomUUID(),
        categories: req.categories,
        x: layout.x,
        y: layout.y,
        scale: layout.scale,
        z: synced.length + 1,
      });
    }
    usedBySig.set(req.sig, used + 1);
  }

  return synced.map((slot, i) => ({ ...slot, z: i + 1 }));
}

function formatFillIssue(issue: OutfitFillIssue): string {
  switch (issue.kind) {
    case "no_rules":
      return "Add at least one category rule to get started.";
    case "empty_closet":
      return "Your closet has no categorized pieces to pick from.";
    case "missing_category":
      return `Need ${issue.need} ${issue.category} piece${issue.need === 1 ? "" : "s"} but only ${issue.have} in your closet.`;
    case "missing_color":
      return `Need ${issue.need} item${issue.need === 1 ? "" : "s"} with primary color “${issue.colorName}” but only ${issue.have} in your closet. Tag primary colors with ★ in the editor.`;
    case "slots_mismatch":
      return "Category slots are out of sync — adjust your rules and try again.";
    case "no_combo":
      return "No combination satisfies all rules — try loosening color rules.";
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
