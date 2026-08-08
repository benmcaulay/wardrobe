import { normalizeCategoryName } from "@/lib/categories";
import { categoryListSignature } from "@/lib/outfit-random";

export type OutfitSlotDefault = {
  x: number;
  y: number;
  scale: number;
};

export type OutfitSlotDefaults = Record<string, OutfitSlotDefault>;

const FRAME_WIDTH = 560;
const FRAME_HEIGHT = 960;

/** Stable key for a slot's category rule (OR list). */
export function outfitSlotDefaultKey(categories: readonly string[]): string {
  return categoryListSignature(categories);
}

/** Built-in placement when the user has not saved a default yet. */
export function builtinSlotLayout(
  categories: readonly string[],
  index: number,
  frameWidth = FRAME_WIDTH,
  frameHeight = FRAME_HEIGHT,
): OutfitSlotDefault {
  const c = (categories[0] ?? "").trim().toLowerCase();
  let x = frameWidth / 2;
  let y = frameHeight / 2;
  if (c.includes("hat") || c.includes("cap")) y = frameHeight * 0.12;
  else if (c.includes("top") || c.includes("shirt")) y = frameHeight * 0.28;
  else if (c.includes("outer") || c.includes("jacket")) y = frameHeight * 0.26;
  else if (c.includes("dress")) y = frameHeight * 0.38;
  else if (c.includes("bottom") || c.includes("pant") || c.includes("short")) y = frameHeight * 0.42;
  else if (c.includes("shoe") || c.includes("boot")) y = frameHeight * 0.78;
  x += index * 36;
  return { x, y, scale: 1 };
}

export function resolveSlotLayout(
  categories: readonly string[],
  index: number,
  defaults: OutfitSlotDefaults,
  visualLayers: readonly string[][] = [],
  frameWidth = FRAME_WIDTH,
  frameHeight = FRAME_HEIGHT,
): OutfitSlotDefault {
  const base = (() => {
    const key = outfitSlotDefaultKey(categories);
    const saved = key ? defaults[key] : undefined;
    if (saved) return { x: saved.x + index * 36, y: saved.y, scale: saved.scale };
    return builtinSlotLayout(categories, index, frameWidth, frameHeight);
  })();
  // Visual layers own the vertical position for any assigned category.
  const bandY = visualLayerYFor(categories, visualLayers, frameHeight);
  return bandY == null ? base : { ...base, y: bandY };
}

/** Which body region a slot's category occupies — used to spread same-region pieces. */
export function outfitRegion(categories: readonly string[]): string {
  const c = (categories[0] ?? "").trim().toLowerCase();
  if (/(hat|cap|beanie)/.test(c)) return "head";
  if (/(shoe|boot|sneaker|sandal|heel|loafer)/.test(c)) return "feet";
  if (/(bottom|pant|short|skirt|jean|trouser|legging|chino|jogger|sweatpant)/.test(c)) return "bottom";
  if (/dress/.test(c)) return "dress";
  if (/(top|shirt|tee|polo|sweater|hoodie|jacket|outer|blouse|cardigan|vest|coat)/.test(c)) return "top";
  return "other";
}

/** Which visual-layer band a slot's first category belongs to, or -1. */
function slotBandIndex(categories: readonly string[], layers: readonly string[][]): number {
  if (layers.length === 0) return -1;
  const key = normalizeCategoryName(categories[0] ?? "");
  if (!key) return -1;
  return layers.findIndex((layer) => layer.some((c) => normalizeCategoryName(c) === key));
}

/**
 * Offset slots that occupy the same vertical position so they sit beside each
 * other instead of stacking directly on top.
 *
 * When visual layers are defined they are the source of truth for grouping: two
 * pieces spread sideways only when they share a *layer*. A jacket in the top
 * layer and a shirt in a lower layer live in different bands, so they keep their
 * own heights (no more pulling the shirt up to the jacket). Without visual
 * layers we fall back to body region, so the built-in layout still keeps a
 * shirt + jacket from landing directly on top of each other.
 */
export function spreadOverlappingSlots<
  T extends { id: string; categories: string[]; x: number; y: number },
>(slots: T[], frameWidth = FRAME_WIDTH, layers: readonly string[][] = []): T[] {
  const byGroup = new Map<string, T[]>();
  for (const s of slots) {
    const band = slotBandIndex(s.categories, layers);
    const key = band >= 0 ? `band:${band}` : `region:${outfitRegion(s.categories)}`;
    const list = byGroup.get(key) ?? [];
    list.push(s);
    byGroup.set(key, list);
  }

  const centerX = frameWidth / 2;
  const overrides = new Map<string, { x: number; y: number }>();
  for (const [key, group] of byGroup) {
    if (key === "region:other" || group.length < 2) continue;
    const n = group.length;
    const step = Math.min(190, (frameWidth - 80) / n);
    const avgY = group.reduce((sum, s) => sum + s.y, 0) / n;
    group.forEach((s, i) => {
      const x = centerX + (i - (n - 1) / 2) * step;
      overrides.set(s.id, { x: Math.min(frameWidth - 90, Math.max(90, x)), y: avgY });
    });
  }

  if (overrides.size === 0) return slots;
  return slots.map((s) => (overrides.has(s.id) ? { ...s, ...overrides.get(s.id)! } : s));
}

export function sanitizeOutfitSlotDefaults(raw: unknown): OutfitSlotDefaults {
  if (!raw || typeof raw !== "object") return {};
  const out: OutfitSlotDefaults = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!key || typeof value !== "object" || value == null) continue;
    const v = value as Record<string, unknown>;
    const x = typeof v.x === "number" && Number.isFinite(v.x) ? v.x : null;
    const y = typeof v.y === "number" && Number.isFinite(v.y) ? v.y : null;
    const scale = typeof v.scale === "number" && Number.isFinite(v.scale) ? v.scale : null;
    if (x == null || y == null || scale == null) continue;
    out[key] = {
      x: Math.min(FRAME_WIDTH, Math.max(0, x)),
      y: Math.min(FRAME_HEIGHT, Math.max(0, y)),
      scale: Math.min(2.2, Math.max(0.5, scale)),
    };
  }
  return out;
}

/**
 * Clean persisted visual layers — an ordered (top→bottom) list of layers, each
 * a list of normalized category names. A category appears in at most one layer;
 * empty layers are dropped.
 */
export function sanitizeVisualLayers(raw: unknown): string[][] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const layer of raw) {
    if (!Array.isArray(layer)) continue;
    const cats: string[] = [];
    for (const c of layer) {
      if (typeof c !== "string") continue;
      const key = normalizeCategoryName(c);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      cats.push(key);
    }
    if (cats.length > 0) out.push(cats);
  }
  return out;
}

/**
 * Vertical position (y) for a slot from the visual layers: the slot's first
 * category decides which band it sits in. Returns null when the category isn't
 * assigned to any layer (caller falls back to the built-in placement).
 */
export function visualLayerYFor(
  categories: readonly string[],
  layers: readonly string[][],
  frameHeight = FRAME_HEIGHT,
): number | null {
  if (layers.length === 0) return null;
  const key = normalizeCategoryName(categories[0] ?? "");
  if (!key) return null;
  const index = layers.findIndex((layer) => layer.some((c) => normalizeCategoryName(c) === key));
  if (index < 0) return null;
  // Even bands across a usable vertical range (leave head/foot margins).
  const top = frameHeight * 0.12;
  const bottom = frameHeight * 0.88;
  const n = layers.length;
  if (n === 1) return (top + bottom) / 2;
  return top + ((bottom - top) * index) / (n - 1);
}

/** Bounds for a placed-piece size multiplier. */
export const DEFAULT_ITEM_SCALE = 1;
export const MIN_ITEM_SCALE = 0.5;
export const MAX_ITEM_SCALE = 5;

/** Clamp a single scale multiplier to the allowed range (falls back to 1). */
export function clampItemScale(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return DEFAULT_ITEM_SCALE;
  return Math.min(MAX_ITEM_SCALE, Math.max(MIN_ITEM_SCALE, raw));
}

/**
 * Built-in size multiplier for a category before any user override. Jackets and
 * pants are large garments that read better rendered twice as big by default.
 */
export function builtinCategoryScale(categories: readonly string[]): number {
  const c = (categories[0] ?? "").trim().toLowerCase();
  if (c.includes("jacket") || c.includes("pant")) return 2;
  return DEFAULT_ITEM_SCALE;
}

/** Clean a persisted per-category scale map (category signature → multiplier). */
export function sanitizeCategoryScales(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!key || typeof value !== "number" || !Number.isFinite(value)) continue;
    out[key] = clampItemScale(value);
  }
  return out;
}

/**
 * The sorted, normalized categories that share a visual layer with this slot's
 * category (the category itself included). Empty when it isn't in any layer.
 */
export function layerMembership(
  categories: readonly string[],
  layers: readonly string[][],
): string[] {
  const key = normalizeCategoryName(categories[0] ?? "");
  if (!key) return [];
  const layer = layers.find((l) => l.some((c) => normalizeCategoryName(c) === key));
  if (!layer) return [];
  return [...new Set(layer.map((c) => normalizeCategoryName(c)).filter(Boolean))].sort();
}

/**
 * Key for a remembered drag position: the slot's own category rule plus the
 * exact set of categories sharing its visual layer. A shirt alone in a layer and
 * a shirt beside a jacket get different keys, so each layout is remembered
 * separately and unseen combinations fall back to the default placement.
 */
export function slotPositionKey(
  categories: readonly string[],
  layers: readonly string[][],
): string {
  return `${categoryListSignature(categories)}@${layerMembership(categories, layers).join(",")}`;
}

/** Clean persisted per-configuration drag positions (key → {x, y}). */
export function sanitizeLayerPositions(raw: unknown): Record<string, { x: number; y: number }> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, { x: number; y: number }> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!key || typeof value !== "object" || value == null) continue;
    const v = value as Record<string, unknown>;
    const x = typeof v.x === "number" && Number.isFinite(v.x) ? v.x : null;
    const y = typeof v.y === "number" && Number.isFinite(v.y) ? v.y : null;
    if (x == null || y == null) continue;
    out[key] = {
      x: Math.min(FRAME_WIDTH, Math.max(0, x)),
      y: Math.min(FRAME_HEIGHT, Math.max(0, y)),
    };
  }
  return out;
}

/** Clean a persisted layer order — a list of category signatures, frontmost first. */
export function sanitizeLayerOrder(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const s = v.trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/**
 * Sort slots frontmost → backmost by their category signature's position in the
 * saved layer order. Signatures without a saved position keep their relative
 * order at the back.
 */
export function orderSlotsByLayer<T extends { categories: string[] }>(
  slots: readonly T[],
  layerOrder: readonly string[],
): T[] {
  const rank = new Map(layerOrder.map((sig, i) => [sig, i]));
  return slots
    .map((slot, i) => ({ slot, i }))
    .sort((a, b) => {
      const ra = rank.get(categoryListSignature(a.slot.categories)) ?? Number.POSITIVE_INFINITY;
      const rb = rank.get(categoryListSignature(b.slot.categories)) ?? Number.POSITIVE_INFINITY;
      return ra - rb || a.i - b.i;
    })
    .map((e) => e.slot);
}

/** Human label for a slot's categories (first category when single). */
export function slotCategoryLabel(categories: readonly string[]): string {
  const trimmed = categories.map((c) => c.trim()).filter(Boolean);
  if (trimmed.length === 0) return "Slot";
  if (trimmed.length === 1) return trimmed[0]!;
  return trimmed.join(" / ");
}

export function itemMatchesSlotCategories(
  itemCategory: string,
  slotCategories: readonly string[],
): boolean {
  if (slotCategories.length === 0) return false;
  const itemKey = normalizeCategoryName(itemCategory);
  return slotCategories.some((c) => normalizeCategoryName(c) === itemKey);
}
