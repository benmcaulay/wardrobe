"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { decode, type Color, type Season } from "@/lib/json";
import { wornOnFromLocalDate, wornOnToISODate } from "@/lib/wear/rollup";
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
import {
  clampToFrame,
  computeFrameScale,
  toFrameSpace,
} from "@/lib/outfit-frame-scale";
import {
  saveOutfitComboLayout,
  saveOutfitLayerArrangement,
  saveOutfitLayerOrder,
  saveOutfitStartupRules,
  saveOutfitVisualLayers,
} from "@/lib/actions/outfitSlotDefaults";
import {
  builtinCategoryScale,
  combinationKey,
  layerIndexForCategories,
  layerSetKey,
  MAX_ITEM_SCALE,
  MIN_ITEM_SCALE,
  orderSlotsByLayer,
  resolveSlotLayout,
  spreadOverlappingSlots,
  type ComboLayout,
  type OutfitSlotDefaults,
} from "@/lib/outfit-slot-defaults";
import {
  SPIN_MODES,
  SPIN_MODE_HINTS,
  SPIN_MODE_LABELS,
  spinScoringOptions,
  type SpinMode,
} from "@/lib/outfit/spin-mode";
import { getSpinSignals } from "@/lib/actions/daily-outfit";
import type { ClimateBand } from "@/lib/services/weather";
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
  itemId?: string;
  locked?: boolean;
};

type Props = {
  items: RandomOutfitItem[];
  colorOptions: Color[];
  initialSlotDefaults: OutfitSlotDefaults;
  initialLayerOrder: string[];
  initialVisualLayers: string[][];
  initialComboLayouts: Record<string, ComboLayout>;
  initialLayerArrangements: Record<string, string[]>;
  initialAutoPopulateRules: boolean;
  initialStartupRules: CategoryRule[];
  /**
   * Bumped whenever something elsewhere on the page taught the model. A smart
   * spin reads a client-side copy of the affinity map, so it needs to know when
   * that copy is stale — otherwise you could train for ten minutes and keep
   * spinning against the model as it was when the page loaded.
   */
  signalsNonce: number;
  /**
   * Today's weather and picks, rendered inside this component's existing left
   * column rather than beside it. Passed in as a node so the builder doesn't
   * have to know anything about slates or forecasts — it just owns the column
   * they sit in.
   */
  sidebarFooter?: ReactNode;
  /**
   * Rendered full width *below* the builder's columns — the sidebar, the frame
   * and the rules stack. Today's picks go here rather than in the sidebar: they
   * are the page's most informative interaction, and 300px made them read as a
   * widget instead of a question.
   */
  footer?: ReactNode;
};

const BASE_PIECE_SIZE = 180;
const FRAME_WIDTH = 560;
const FRAME_HEIGHT = 960;
/**
 * Space kept below the canvas when fitting it to the viewport. Covers the
 * page's own bottom padding (py-12) so the whole studio lands inside the fold.
 */
const FRAME_GUTTER = 24;
const SLOT_ICON_SIZE = 72;

/** The caller's own calendar date, so the band is today's where *they* are. */
function localISODate(): string {
  return wornOnToISODate(wornOnFromLocalDate(new Date()));
}

export function RandomOutfitBuilder({
  items,
  colorOptions,
  initialSlotDefaults,
  initialLayerOrder,
  initialVisualLayers,
  initialComboLayouts,
  initialLayerArrangements,
  initialAutoPopulateRules,
  initialStartupRules,
  signalsNonce,
  sidebarFooter,
  footer,
}: Props) {
  // Carries the attributes the Layer 1 scorer reads, not just the ones the slot
  // rules need — see lib/outfit/compatibility.ts.
  const pickPool = useMemo(
    () =>
      items.map((i) => ({
        id: i.id,
        category: i.category,
        colors: i.colors,
        subcategory: i.subcategory,
        name: i.name,
        material: i.material,
        pattern: i.pattern,
        season: decode<Season[]>(i.season, []),
      })),
    [items],
  );

  const [categoryRules, setCategoryRules] = useState<CategoryRule[]>(
    initialAutoPopulateRules ? initialStartupRules : [],
  );
  const [autoPopulateRules, setAutoPopulateRules] = useState(initialAutoPopulateRules);
  const [colorRules, setColorRules] = useState<ColorRule[]>([]);
  const [multiSelect, setMultiSelect] = useState(false);
  const [draftCats, setDraftCats] = useState<string[]>([]);
  const [draftCount, setDraftCount] = useState(1);
  const [slots, setSlots] = useState<CanvasSlot[]>([]);
  const slotsRef = useRef(slots);
  slotsRef.current = slots;
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<{
    kind: "canvas";
    slotId: string;
    dx: number;
    dy: number;
    startX: number;
    startY: number;
  } | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [spinError, setSpinError] = useState<string | null>(null);
  /**
   * Which engine fills the open slots. Smart is the default — it's the whole
   * point of having trained a model — but random stays one tap away, because
   * "surprise me" is a real thing to want from a spin button and a ranked
   * generator can't do it.
   */
  const [spinMode, setSpinMode] = useState<SpinMode>("smart");
  const [affinity, setAffinity] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [band, setBand] = useState<ClimateBand | null>(null);
  const [signalsLoaded, setSignalsLoaded] = useState(false);
  const [previewItem, setPreviewItem] = useState<RandomOutfitItem | null>(null);
  const [layerOrder, setLayerOrder] = useState<string[]>(initialLayerOrder);
  const layerOrderRef = useRef(layerOrder);
  layerOrderRef.current = layerOrder;
  const [dragStackIndex, setDragStackIndex] = useState<number | null>(null);
  const [visualLayers, setVisualLayers] = useState<string[][]>(initialVisualLayers);
  const visualLayersRef = useRef(visualLayers);
  visualLayersRef.current = visualLayers;
  const [closetSearch, setClosetSearch] = useState("");
  const [dragCategory, setDragCategory] = useState<string | null>(null);
  const [visualLayersOpen, setVisualLayersOpen] = useState(false);
  const [comboLayouts, setComboLayouts] =
    useState<Record<string, ComboLayout>>(initialComboLayouts);
  const comboLayoutsRef = useRef(comboLayouts);
  comboLayoutsRef.current = comboLayouts;
  const [arrangements, setArrangements] =
    useState<Record<string, string[]>>(initialLayerArrangements);
  const arrangementsRef = useRef(arrangements);
  arrangementsRef.current = arrangements;
  const [outfitName, setOutfitName] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [slotDefaults, setSlotDefaults] = useState<OutfitSlotDefaults>(initialSlotDefaults);
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
      // Scale the mannequin to fill its column WIDTH (not the viewport height),
      // so it renders large and can extend past the fold — you scroll to see it.
      setFrameScale(
        computeFrameScale({
          frameWidth: FRAME_WIDTH,
          frameHeight: FRAME_HEIGHT,
          availableHeight: Number.POSITIVE_INFINITY,
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

  // Clicking anywhere that isn't a placed piece (or a control that acts on the
  // selection) clears it, so the selection outline doesn't linger on the frame.
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-outfit-slot]") || target.closest("[data-keep-selection]")) return;
      setSelectedSlotId(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  // Close the item preview popup on Escape.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPreviewItem(null);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
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
    setSlots((prev) =>
      syncSlotsWithRules(
        prev,
        categoryRules,
        slotDefaults,
        layerOrderRef.current,
        visualLayers.filter((l) => l.length > 0),
        comboLayoutsRef.current,
        arrangementsRef.current,
      ),
    );
  }, [categoryRules, slotDefaults, visualLayers]);

  // Lock in the left→right order the first time a multi-piece combination is
  // shown. Later spins/loads reuse it; only a drag (below) rewrites it.
  useEffect(() => {
    const layers = visualLayers.filter((l) => l.length > 0);
    if (layers.length === 0) return;
    const bands = new Set(
      slots.map((s) => layerIndexForCategories(s.categories, layers)).filter((i) => i >= 0),
    );
    const toSave: Record<string, string[]> = {};
    for (const idx of bands) {
      const order = layerOrderFromSlots(slots, layers, idx);
      if (order.length < 2) continue;
      const key = layerSetKey(order);
      if (arrangementsRef.current[key]) continue;
      toSave[key] = order;
    }
    if (Object.keys(toSave).length === 0) return;
    setArrangements((prev) => ({ ...prev, ...toSave }));
    for (const [k, v] of Object.entries(toSave)) void saveOutfitLayerArrangement(k, v);
  }, [slots, visualLayers]);

  // Persist the startup toggle and (while on) the current category rules, so the
  // selection comes back on next load. Skip the initial render.
  const startupSkipRef = useRef(true);
  useEffect(() => {
    if (startupSkipRef.current) {
      startupSkipRef.current = false;
      return;
    }
    void saveOutfitStartupRules(autoPopulateRules, autoPopulateRules ? categoryRules : []);
  }, [autoPopulateRules, categoryRules]);

  /**
   * Pull the learned affinity and today's band once, then again whenever the
   * model moves. Spinning itself stays local so the button feels immediate; see
   * getSpinSignals for why the model comes to the client rather than the other
   * way round.
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const signals = await getSpinSignals(localISODate());
        if (cancelled) return;
        setAffinity(new Map(Object.entries(signals.affinity)));
        setBand(signals.context.band);
      } catch {
        // A smart spin without signals still scores on compatibility, which is
        // strictly better than falling back to a shuffle the user didn't ask for.
      } finally {
        if (!cancelled) setSignalsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [signalsNonce]);

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
  const activeLayers = visualLayers.filter((l) => l.length > 0);
  const selected = slots.find((s) => s.id === selectedSlotId) ?? null;
  const selectedComboKey = selected ? comboKeyForSlot(selected, slots, activeLayers) : "";
  const selectedScale = selected
    ? comboLayouts[selectedComboKey]?.scale ?? builtinCategoryScale(selected.categories)
    : 1;

  const assignableItems = useMemo(() => {
    if (!selected) return items;
    return items.filter((item) =>
      itemMatchesCategories(
        { id: item.id, category: item.category, colors: item.colors },
        selected.categories,
      ),
    );
  }, [items, selected]);

  // Front-page-style text search over the closet list (name/brand/color/etc.).
  const searchedAssignable = useMemo(() => {
    const q = closetSearch.trim().toLowerCase();
    if (!q) return assignableItems;
    return assignableItems.filter((it) => {
      const hay = [
        it.name,
        it.brand ?? "",
        it.category,
        it.subcategory ?? "",
        it.pattern ?? "",
        it.material ?? "",
        it.notes ?? "",
        it.season,
        it.styleTags,
        ...it.colors.map((c) => c.name),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [assignableItems, closetSearch]);

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
      // The mode decides the order candidates are tried in, never which
      // combinations are legal: slot rules, colour rules and locked pieces bind
      // identically either way. Locked slots are already assigned before
      // scoring starts, so a smart spin scores the open ones *against what's
      // locked* — which is what makes it complete an outfit around a piece.
      const assignment = pickRandomOutfit(
        pickPool,
        slotInputs,
        colorRules,
        spinScoringOptions(spinMode, { affinity, band }),
      );
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

  // Drag-reorder the piece list (frontmost first). Reassigns z so the top of the
  // list is the frontmost image, then persists the category stack order.
  function reorderStack(from: number, to: number) {
    if (from === to) return;
    const ordered = slots.filter((s) => s.itemId).sort((a, b) => b.z - a.z);
    const ids = ordered.map((s) => s.id);
    const [moved] = ids.splice(from, 1);
    if (moved === undefined) return;
    ids.splice(to, 0, moved);

    const n = ids.length;
    const zById = new Map(ids.map((id, i) => [id, n - i])); // index 0 = frontmost = highest z
    setSlots((prev) => prev.map((s) => (zById.has(s.id) ? { ...s, z: zById.get(s.id)! } : s)));

    const byId = new Map(ordered.map((s) => [s.id, s]));
    const sigs: string[] = [];
    const seen = new Set<string>();
    for (const id of ids) {
      const sig = categoryListSignature(byId.get(id)?.categories ?? []);
      if (!sig || seen.has(sig)) continue;
      seen.add(sig);
      sigs.push(sig);
    }
    setLayerOrder(sigs);
    void saveOutfitLayerOrder(sigs);
  }

  // Size the selected piece for its current combination, live. Only pieces that
  // share the same combination key (normally just this one) resize.
  function resizeCombo(comboKey: string, scale: number) {
    if (!comboKey) return;
    setComboLayouts((prev) => ({ ...prev, [comboKey]: { ...prev[comboKey], scale } }));
    const layers = visualLayersRef.current.filter((l) => l.length > 0);
    setSlots((prev) =>
      prev.map((s) => (comboKeyForSlot(s, prev, layers) === comboKey ? { ...s, scale } : s)),
    );
  }

  // Persist the combination's size once the user finishes dragging the slider.
  function commitComboScale(comboKey: string) {
    if (!comboKey) return;
    const scale = comboLayoutsRef.current[comboKey]?.scale;
    if (scale != null) void saveOutfitComboLayout(comboKey, { scale });
  }

  // --- Visual layers (vertical bands) -------------------------------------
  function updateVisualLayers(next: string[][]) {
    setVisualLayers(next);
    void saveOutfitVisualLayers(next); // server drops empty layers on save
  }

  function addVisualLayer() {
    updateVisualLayers([...visualLayers, []]);
  }

  function assignCategoryToLayer(cat: string, layerIndex: number) {
    const key = normalizeCategoryName(cat);
    if (!key) return;
    const stripped = visualLayers.map((layer) =>
      layer.filter((c) => normalizeCategoryName(c) !== key),
    );
    if (layerIndex < 0 || layerIndex >= stripped.length) return;
    stripped[layerIndex] = [...stripped[layerIndex]!, key];
    updateVisualLayers(stripped);
  }

  function removeCategoryFromLayers(cat: string) {
    const key = normalizeCategoryName(cat);
    updateVisualLayers(visualLayers.map((layer) => layer.filter((c) => normalizeCategoryName(c) !== key)));
  }

  function removeVisualLayer(layerIndex: number) {
    updateVisualLayers(visualLayers.filter((_, i) => i !== layerIndex));
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
    if (!dragState) return;
    const { slotId, startX, startY } = dragState;
    setDragState(null);
    const slot = slotsRef.current.find((s) => s.id === slotId);
    // Only remember a genuine drag, not a click that happened to select a slot.
    if (!slot || (Math.abs(slot.x - startX) < 2 && Math.abs(slot.y - startY) < 2)) return;
    const layers = visualLayersRef.current.filter((l) => l.length > 0);
    const key = comboKeyForSlot(slot, slotsRef.current, layers);
    const pos = { x: slot.x, y: slot.y };
    setComboLayouts((prev) => ({ ...prev, [key]: { ...prev[key], ...pos } }));
    void saveOutfitComboLayout(key, pos);

    // A horizontal drag can reorder a multi-piece layer — relock the order.
    const bandIdx = layerIndexForCategories(slot.categories, layers);
    if (bandIdx < 0) return;
    const order = layerOrderFromSlots(slotsRef.current, layers, bandIdx);
    if (order.length < 2) return;
    const setKey = layerSetKey(order);
    if (arrangementsRef.current[setKey]?.join(",") === order.join(",")) return;
    setArrangements((prev) => ({ ...prev, [setKey]: order }));
    void saveOutfitLayerArrangement(setKey, order);
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
      startX: slot.x,
      startY: slot.y,
    });
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  // Pieces currently placed on the frame, plus their combined color palette —
  // shown beside the mannequin so the outfit reads at a glance.
  // Frontmost first (highest z at the top of the list).
  const placedPieces = slots
    .filter((s) => s.itemId)
    .sort((a, b) => b.z - a.z)
    .map((s) => ({ slot: s, item: itemsById.get(s.itemId!) }))
    .filter((p): p is { slot: CanvasSlot; item: RandomOutfitItem } => !!p.item);
  const paletteColors: Color[] = (() => {
    const seen = new Set<string>();
    const out: Color[] = [];
    for (const { item } of placedPieces) {
      for (const c of item.colors) {
        const key = c.name.trim().toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(c);
      }
    }
    return out;
  })();

  return (
    <>
    <div className="flex flex-col gap-8 md:flex-row md:flex-wrap md:items-start md:justify-evenly md:gap-y-8 md:gap-x-0">
        <div data-keep-selection className="w-full flex flex-row flex-wrap items-center justify-center gap-3 pt-2 md:w-[300px] md:shrink-0 md:flex-col md:flex-nowrap md:items-stretch md:sticky md:top-6 md:self-start md:max-h-[calc(100dvh-3rem)] md:overflow-y-auto md:pr-1">
          <button
            type="button"
            onClick={() => void spin()}
            disabled={!readyToSpin || spinning}
            aria-label={spinning ? "Spinning…" : "Spin outfit"}
            className="group relative mx-auto flex h-[156px] w-[156px] items-center justify-center rounded-full border-[1.5px] border-accent-soft bg-white text-ink transition hover:border-accent disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span
              aria-hidden
              className={`pointer-events-none absolute inset-0 rounded-full ${
                spinning
                  ? "animate-spin"
                  : "group-hover:animate-spin motion-reduce:group-hover:animate-none"
              }`}
            >
              {/* Comet trail — only while hovering (or spinning); a single dot at rest. */}
              <span
                className={`absolute inset-0 rounded-full transition-opacity duration-200 ${
                  spinning
                    ? "opacity-100"
                    : "opacity-0 group-hover:opacity-100 motion-reduce:group-hover:opacity-0"
                }`}
              >
                <span
                  className="absolute left-1/2 top-1/2 h-1.5 w-1.5 rounded-full bg-accent"
                  style={{ transform: "translate(-50%,-50%) rotate(-42deg) translateY(-78px)", opacity: 0.2 }}
                />
                <span
                  className="absolute left-1/2 top-1/2 h-2 w-2 rounded-full bg-accent"
                  style={{ transform: "translate(-50%,-50%) rotate(-30deg) translateY(-78px)", opacity: 0.35 }}
                />
                <span
                  className="absolute left-1/2 top-1/2 h-2.5 w-2.5 rounded-full bg-accent"
                  style={{ transform: "translate(-50%,-50%) rotate(-18deg) translateY(-78px)", opacity: 0.6 }}
                />
              </span>
              {/* Head dot — always visible. */}
              <span
                className="absolute left-1/2 top-1/2 h-[15px] w-[15px] rounded-full bg-accent"
                style={{ transform: "translate(-50%,-50%) translateY(-78px)" }}
              />
            </span>
            <span className="text-base font-medium tracking-wide">
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
          <div data-keep-selection className="w-full">
            <div
              role="radiogroup"
              aria-label="Spin engine"
              className="flex w-full rounded-full border border-ink/10 bg-paper-warm p-1"
            >
              {SPIN_MODES.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={spinMode === option}
                  onClick={() => setSpinMode(option)}
                  className={`flex-1 rounded-full px-3 py-1.5 text-xs tracking-wide transition ${
                    spinMode === option
                      ? "bg-ink text-paper shadow-sm"
                      : "text-ink-muted hover:text-ink"
                  }`}
                >
                  {SPIN_MODE_LABELS[option]}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] leading-snug text-ink-muted">
              {SPIN_MODE_HINTS[spinMode]}
              {spinMode === "smart" && !signalsLoaded ? " (loading what I know…)" : ""}
              {spinMode === "smart" && signalsLoaded && affinity.size === 0
                ? " Nothing learned yet — train me and this gets sharper."
                : ""}
            </p>
          </div>
          {spinError && (
            <p role="alert" className="text-xs text-red-700 text-center">
              {spinError}
            </p>
          )}
          {sidebarFooter ? (
            <div data-keep-selection className="w-full">
              {sidebarFooter}
            </div>
          ) : null}
          {spinHint && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-2 py-2 text-center">
              {spinHint}
            </p>
          )}
          {placedPieces.length > 0 && (
            <div className="w-full space-y-2.5 pt-1">
              {paletteColors.length > 0 && (
                <div className="flex h-7 w-full overflow-hidden rounded-lg border border-ink/10">
                  {paletteColors.map((c) => (
                    <div
                      key={c.name}
                      title={c.name}
                      className="flex-1"
                      style={{ backgroundColor: c.hex }}
                    />
                  ))}
                </div>
              )}
              <ul className="space-y-1.5 md:max-h-[440px] md:overflow-auto md:pr-1">
                {placedPieces.map(({ slot, item }, index) => (
                  <li
                    key={slot.id}
                    onDragOver={(e) => {
                      if (dragStackIndex !== null) e.preventDefault();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragStackIndex !== null) reorderStack(dragStackIndex, index);
                      setDragStackIndex(null);
                    }}
                    className={`flex items-center gap-1.5 rounded-lg border border-ink/10 bg-white p-1.5 transition ${
                      dragStackIndex === index ? "opacity-40" : ""
                    }`}
                  >
                    <button
                      type="button"
                      draggable
                      onDragStart={() => setDragStackIndex(index)}
                      onDragEnd={() => setDragStackIndex(null)}
                      aria-label="Drag to reorder layer"
                      title="Drag to reorder — top is frontmost"
                      className="shrink-0 flex h-7 w-5 items-center justify-center rounded text-ink-muted hover:bg-paper-warm cursor-grab active:cursor-grabbing touch-none select-none"
                    >
                      ⋮⋮
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewItem(item)}
                      title={`Preview ${item.name}`}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left rounded-md hover:bg-paper-warm/60 transition"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={processedImageUrls[item.id] ?? imageUrl(item.imagePath)}
                        alt=""
                        className="h-9 w-9 shrink-0 rounded object-cover bg-paper-warm"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{item.name}</p>
                        <p className="truncate text-xs capitalize text-ink-muted">{item.category}</p>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleSlotLock(slot.id)}
                      aria-label={slot.locked ? "Unlock piece" : "Lock piece"}
                      title={slot.locked ? "Locked — kept when you spin again" : "Lock this piece"}
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition ${
                        slot.locked
                          ? "border-accent bg-accent text-white"
                          : "border-ink/15 text-ink-muted hover:border-ink/30"
                      }`}
                    >
                      <svg
                        viewBox="0 0 16 16"
                        className="h-3.5 w-3.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        aria-hidden
                      >
                        <rect x="3.25" y="7" width="9.5" height="6.25" rx="1.5" />
                        <path d={slot.locked ? "M5.5 7V5.25a2.5 2.5 0 015 0V7" : "M5.5 7V5.25a2.5 2.5 0 014.9-.7"} />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="w-full rounded-2xl border border-ink/10 bg-white p-3 space-y-2 text-left">
            <div className="text-[11px] uppercase tracking-wide text-ink-muted">Your closet</div>
            <input
              type="search"
              value={closetSearch}
              onChange={(e) => setClosetSearch(e.target.value)}
              placeholder="Search name, brand, color, season, tags…"
              aria-label="Search closet"
              className="w-full rounded-full border border-ink/10 bg-paper px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/40"
            />
            <p className="text-xs text-ink-muted">
              {selected
                ? `Tap a piece to fill this slot (${formatCategoryList(selected.categories)}).`
                : "Select a slot on the frame, then tap a piece to assign it."}
            </p>
            <ul className="space-y-1 max-h-36 overflow-auto pr-1">
              {searchedAssignable.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    disabled={!selected}
                    onClick={() => void assignItemToSlot(item)}
                    className="w-full flex items-center gap-2 text-sm rounded-lg px-1.5 py-1.5 hover:bg-paper-warm disabled:opacity-50 disabled:hover:bg-transparent text-left"
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
            {searchedAssignable.length === 0 && (
              <p className="text-xs italic text-ink-muted">No pieces match.</p>
            )}
          </div>

          <div className="w-full rounded-2xl border border-ink/10 bg-white p-4 space-y-2 text-left">
            <div className="text-[11px] uppercase tracking-wide text-ink-muted">Save outfit</div>
            <div className="flex gap-2">
              <input
                type="text"
                value={outfitName}
                onChange={(e) => setOutfitName(e.target.value)}
                placeholder="Outfit name"
                className="flex-1 min-w-0 rounded-full border border-ink/10 px-3 py-1.5 text-sm bg-paper"
              />
              <button
                type="button"
                onClick={saveOutfit}
                disabled={!outfitName.trim() || !slots.some((s) => s.itemId) || pending}
                className="rounded-full bg-ink text-paper px-4 py-1.5 text-sm disabled:opacity-50"
              >
                {pending ? "Saving…" : "Save"}
              </button>
            </div>
            {saveError && <p className="text-[11px] text-red-700">{saveError}</p>}
          </div>
        </div>
        <section className="w-full md:w-[520px] xl:w-[560px] md:shrink-0 md:flex md:justify-center">
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
          {/* Mannequin silhouette (head + body) — only while the frame is empty,
              so a generated outfit sits on a clean backdrop with no outline. */}
          {!slots.some((s) => s.itemId) && (
            <div className="pointer-events-none absolute inset-x-0 top-12 bottom-10 flex flex-col items-center">
              <div className="h-28 w-28 rounded-full bg-ink/[0.07] border border-ink/15" />
              <div className="mt-4 w-48 flex-1 rounded-[90px] bg-ink/[0.06] border border-ink/15" />
            </div>
          )}
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
                    isSelected ? "ring-2 ring-ink" : ""
                  } ${item ? "" : "border-2 border-dashed border-ink/20 bg-white/80"}`}
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
      </section>

      <aside
        data-keep-selection
        className="w-full shrink-0 space-y-4 md:sticky md:top-6 md:w-[460px] md:overflow-y-auto md:pr-1"
        style={panelMaxHeight ? { maxHeight: panelMaxHeight } : undefined}
      >
        <div className="rounded-2xl border border-ink/10 bg-white p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] uppercase tracking-wide text-ink-muted">Category rules</div>
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
          <p className="text-sm text-ink-muted">
            Tap a category to include one. Turn on multi-select to combine categories (OR) or pick
            multiples.
          </p>

          {categoryOptions.length === 0 ? (
            <p className="text-sm text-ink-muted/80 italic">
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
                    draggable
                    onDragStart={() => setDragCategory(cat)}
                    onDragEnd={() => setDragCategory(null)}
                    onClick={() => toggleSimpleCategory(cat)}
                    disabled={locked}
                    title={locked ? "Managed in multi-select below" : "Tap to include · drag into a layer"}
                    className={`rounded-full px-2.5 py-1 text-xs uppercase tracking-wide border transition capitalize disabled:cursor-not-allowed ${
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
                    className="inline-flex items-center gap-1 rounded-full bg-ink text-paper pl-2.5 pr-1 py-1 text-xs uppercase tracking-wide capitalize"
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
              <div className="text-xs text-ink-muted">
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
                        className={`rounded-full px-2.5 py-1 text-xs uppercase tracking-wide border transition capitalize ${
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
                <span className="text-xs text-ink-muted shrink-0">How many</span>
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

          <label className="flex items-center justify-end gap-1.5 pt-1 text-[11px] text-ink-muted cursor-pointer select-none">
            Auto-populate on startup
            <input
              type="checkbox"
              checked={autoPopulateRules}
              onChange={(e) => setAutoPopulateRules(e.target.checked)}
              className="accent-ink"
            />
          </label>
        </div>

        <div className="rounded-2xl border border-ink/10 bg-white p-4 space-y-3">
          <button
            type="button"
            onClick={() => setVisualLayersOpen((o) => !o)}
            className="flex w-full items-center justify-between gap-2 text-left"
            aria-expanded={visualLayersOpen}
          >
            <span className="text-[11px] uppercase tracking-wide text-ink-muted">Visual layers</span>
            <span className="flex items-center gap-2 text-[11px] text-ink-muted">
              {!visualLayersOpen &&
                (() => {
                  const active = visualLayers.filter((l) => l.length > 0);
                  const cats = active.reduce((n, l) => n + l.length, 0);
                  return (
                    <span>
                      {cats === 0
                        ? "Not set up"
                        : `${active.length} layer${active.length === 1 ? "" : "s"} · ${cats} categor${
                            cats === 1 ? "y" : "ies"
                          }`}
                    </span>
                  );
                })()}
              <span
                aria-hidden
                className={`transition-transform ${visualLayersOpen ? "rotate-90" : ""}`}
              >
                ›
              </span>
            </span>
          </button>
          {visualLayersOpen && (
            <>
          <p className="text-sm text-ink-muted">
            Drag category chips into a layer to set how high or low they sit on the frame. Top layer
            = top of the body; items in the same layer sit side by side.
          </p>
          {visualLayers.length === 0 ? (
            <div
              onDragOver={(e) => {
                if (dragCategory) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragCategory) {
                  updateVisualLayers([[normalizeCategoryName(dragCategory)]]);
                  setDragCategory(null);
                }
              }}
              className={`rounded-xl border border-dashed p-4 text-center text-xs transition ${
                dragCategory ? "border-accent bg-accent-soft/20 text-ink" : "border-ink/20 text-ink-muted"
              }`}
            >
              Drag a category here to start the top layer.
            </div>
          ) : (
            <ul className="space-y-2">
              {visualLayers.map((layer, i) => (
                <li
                  key={i}
                  onDragOver={(e) => {
                    if (dragCategory) e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragCategory) {
                      assignCategoryToLayer(dragCategory, i);
                      setDragCategory(null);
                    }
                  }}
                  className={`rounded-xl border p-2 transition ${
                    dragCategory ? "border-accent bg-accent-soft/10" : "border-ink/10 bg-paper-warm/40"
                  }`}
                >
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="text-[11px] text-ink-muted">
                      Layer {i + 1}
                      {i === 0 ? " · top" : i === visualLayers.length - 1 ? " · bottom" : ""}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeVisualLayer(i)}
                      aria-label="Remove layer"
                      className="flex h-5 w-5 items-center justify-center rounded-full text-ink-muted hover:bg-ink/10"
                    >
                      ×
                    </button>
                  </div>
                  {layer.length === 0 ? (
                    <p className="text-xs italic text-ink-muted/70">Drop categories here</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {layer.map((cat) => (
                        <span
                          key={cat}
                          className="inline-flex items-center gap-1 rounded-full bg-ink pl-2.5 pr-1 py-1 text-xs uppercase tracking-wide capitalize text-paper"
                        >
                          {cat}
                          <button
                            type="button"
                            onClick={() => removeCategoryFromLayers(cat)}
                            aria-label={`Remove ${cat} from layer`}
                            className="flex h-4 w-4 items-center justify-center rounded-full hover:bg-paper/20"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {visualLayers.length > 0 && (
            <button
              type="button"
              onClick={addVisualLayer}
              className="w-full rounded-lg border border-dashed border-ink/20 py-2 text-xs text-ink-muted transition hover:border-ink/40 hover:text-ink"
            >
              + Add visual layer
            </button>
          )}
            </>
          )}
        </div>

        <div className="rounded-2xl border border-ink/10 bg-white p-4 space-y-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-muted">Color rules</div>
          <p className="text-sm text-ink-muted">
            Optional — counts items whose <span className="text-ink">primary color</span> (★ in the
            editor) matches, e.g. 2 black pieces.
          </p>
          {colorRules.length === 0 ? (
            <p className="text-sm text-ink-muted/80 italic">No color rules yet.</p>
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
            className="text-sm text-ink-muted hover:text-ink underline underline-offset-2 disabled:opacity-40"
          >
            + Add color rule
          </button>
        </div>

        {selected && (
          <div className="rounded-2xl border border-ink/10 bg-white p-4 space-y-3">
            <div className="text-[11px] uppercase tracking-wide text-ink-muted">Selected slot</div>
            <p className="text-sm truncate">
              <span className="capitalize">{formatCategoryList(selected.categories)}</span>
              {selected.itemId && (
                <span className="text-ink-muted">
                  {" · "}
                  {itemsById.get(selected.itemId)?.name}
                </span>
              )}
            </p>
            <label className="block text-[11px] uppercase tracking-wide text-ink-muted">Size</label>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={MIN_ITEM_SCALE}
                max={MAX_ITEM_SCALE}
                step={0.05}
                value={selectedScale}
                aria-label="Size for selected type"
                onChange={(e) => resizeCombo(selectedComboKey, Number(e.target.value))}
                onPointerUp={() => commitComboScale(selectedComboKey)}
                onKeyUp={() => commitComboScale(selectedComboKey)}
                onBlur={() => commitComboScale(selectedComboKey)}
                className="w-full accent-ink"
              />
              <span className="text-[11px] text-ink-muted tabular-nums shrink-0">
                {Math.round(selectedScale * 100)}%
              </span>
            </div>
            <p className="text-xs text-ink-muted">
              Saved for this exact combination of pieces.
            </p>
            <p className="text-xs text-ink-muted">
              Set vertical placement with the Visual layers box, layering by dragging the piece list;
              drag on the frame for fine tweaks.
            </p>
            <button
              type="button"
              onClick={() => removeSlot(selected.id)}
              className="rounded-full border border-red-200 text-red-700 px-3 py-1 text-xs"
            >
              Remove slot
            </button>
          </div>
        )}

      </aside>
    </div>

    {previewItem && (
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${previewItem.name} preview`}
        onClick={() => setPreviewItem(null)}
        className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4"
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="relative w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-ink/10 bg-paper p-5 shadow-tile"
        >
          <button
            type="button"
            onClick={() => setPreviewItem(null)}
            aria-label="Close preview"
            className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full border border-ink/15 bg-white text-ink-muted hover:text-ink hover:border-ink/30 transition"
          >
            ×
          </button>
          <div className="mx-auto aspect-square w-full max-w-[320px] overflow-hidden rounded-xl bg-paper-warm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={processedImageUrls[previewItem.id] ?? imageUrl(previewItem.imagePath)}
              alt={previewItem.name}
              className="h-full w-full object-contain"
              style={{
                transform: itemTileImageTransform({
                  thumbZoom: previewItem.thumbZoom,
                  mirror: previewItem.mirror,
                }),
              }}
            />
          </div>
          <div className="mt-4 space-y-1">
            <h2 className="font-serif text-2xl tracking-tight">{previewItem.name}</h2>
            {previewItem.brand && <p className="text-sm text-ink-muted">{previewItem.brand}</p>}
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Detail label="Category" value={previewItem.category} />
            {previewItem.subcategory && <Detail label="Subcategory" value={previewItem.subcategory} />}
            {previewItem.material && <Detail label="Material" value={previewItem.material} />}
            {previewItem.pattern && <Detail label="Pattern" value={previewItem.pattern} />}
          </dl>
          {previewItem.colors.length > 0 && (
            <div className="mt-3">
              <span className="text-xs uppercase tracking-wide text-ink-muted">Colors</span>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {previewItem.colors.map((c) => (
                  <span key={c.name} className="inline-flex items-center gap-1.5 text-sm capitalize">
                    <span
                      className="h-4 w-4 rounded-full border border-ink/15"
                      style={{ backgroundColor: c.hex }}
                    />
                    {c.name}
                  </span>
                ))}
              </div>
            </div>
          )}
          <a
            href={`/closet/${previewItem.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-5 inline-flex items-center gap-1 text-sm text-ink underline underline-offset-2 hover:text-ink-soft"
          >
            Open full details ↗
          </a>
        </div>
      </div>
    )}
    {footer ? <div className="mt-8">{footer}</div> : null}
    </>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="capitalize">{value}</dd>
    </div>
  );
}

/** The combination key for a slot given every slot currently in the outfit. */
function comboKeyForSlot(
  slot: { categories: string[] },
  allSlots: readonly { categories: string[] }[],
  layers: string[][],
): string {
  const idx = layerIndexForCategories(slot.categories, layers);
  const present =
    idx < 0
      ? [slot.categories[0] ?? ""]
      : allSlots
          .filter((s) => layerIndexForCategories(s.categories, layers) === idx)
          .map((s) => s.categories[0] ?? "");
  return combinationKey(slot.categories, present);
}

/** Left→right order of the categories placed in one visual layer, by their x. */
function layerOrderFromSlots(
  slots: readonly CanvasSlot[],
  layers: string[][],
  bandIdx: number,
): string[] {
  return [
    ...new Set(
      slots
        .filter((s) => layerIndexForCategories(s.categories, layers) === bandIdx)
        .slice()
        .sort((a, b) => a.x - b.x)
        .map((s) => normalizeCategoryName(s.categories[0] ?? ""))
        .filter(Boolean),
    ),
  ];
}

function syncSlotsWithRules(
  slots: CanvasSlot[],
  rules: CategoryRule[],
  defaults: OutfitSlotDefaults,
  layerOrder: string[],
  visualLayers: string[][],
  comboLayouts: Record<string, ComboLayout>,
  arrangements: Record<string, string[]>,
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
      // Reuse the existing slot's item/lock, but recompute its position from the
      // default so an unpinned piece reverts when the combination changes; a
      // saved combo layout re-pins it below.
      const existing = pool[used]!;
      const layout = resolveSlotLayout(existing.categories, used, defaults, visualLayers);
      synced.push({ ...existing, x: layout.x, y: layout.y });
    } else {
      const layout = resolveSlotLayout(req.categories, used, defaults, visualLayers);
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

  // Position + size are remembered per placed-together combination: the piece's
  // category plus the exact set of categories sharing its visual layer. Removing
  // a piece re-keys the survivors, so they revert to that smaller combination's
  // saved layout. A hand-placed piece is pinned and left out of the auto-spread.
  const pinnedIds = new Set<string>();
  const zStamped = synced.map((slot, i) => {
    const layout = comboLayouts[comboKeyForSlot(slot, synced, visualLayers)];
    const scale = layout?.scale ?? builtinCategoryScale(slot.categories);
    if (layout?.x != null && layout?.y != null) {
      pinnedIds.add(slot.id);
      return { ...slot, x: layout.x, y: layout.y, scale, z: i + 1 };
    }
    return { ...slot, scale, z: i + 1 };
  });
  const spread = spreadOverlappingSlots(
    zStamped.filter((s) => !pinnedIds.has(s.id)),
    FRAME_WIDTH,
    visualLayers,
    arrangements,
  );
  const spreadById = new Map(spread.map((s) => [s.id, s]));
  const positioned = zStamped.map((s) => spreadById.get(s.id) ?? s);
  // Layer by the saved stack order: frontmost signature gets the highest z.
  const frontToBack = orderSlotsByLayer(positioned, layerOrder);
  const total = frontToBack.length;
  return frontToBack.map((slot, i) => ({ ...slot, z: total - i }));
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
