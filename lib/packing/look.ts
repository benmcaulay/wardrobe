/**
 * Assemble a day's outfit on the outfit canvas.
 *
 * The trip page plans what you'll wear each day as a list of item ids. That's
 * enough to check the maths and useless to look at. This turns a day into
 * placed artwork using the *same* rules the outfits tab uses, so a look in the
 * packing carousel sits the way it would if you'd built it by hand: the user's
 * saved slot defaults, their visual layers, their per-combination positions and
 * sizes, their stacking order.
 *
 * All of that lives in `lib/outfit-slot-defaults.ts` and is reused rather than
 * reimplemented — an outfit that composed differently in two places would be a
 * worse bug than no carousel at all. What's here is the ordering of those
 * calls, extracted from the builder's canvas sync so both can share it, plus
 * the frame constants.
 *
 * Pure: no DOM, no React. The carousel just reads the numbers.
 */

import { categoryListSignature } from "@/lib/outfit-random";
import { categoryAncestryPath, type CategoryParents } from "@/lib/category-tree";
import {
  builtinCategoryScale,
  combinationKey,
  layerIndexForCategories,
  orderSlotsByLayer,
  resolveSlotLayout,
  spreadOverlappingSlots,
  type ComboLayout,
  type OutfitSlotDefaults,
} from "@/lib/outfit-slot-defaults";

/**
 * The canvas coordinate space. Fixed, because every saved position is an
 * absolute point inside it — see lib/outfit-frame-scale.ts.
 */
export const LOOK_FRAME_WIDTH = 560;
export const LOOK_FRAME_HEIGHT = 960;

/** Everything needed to place one garment. */
export type LookPiece = {
  id: string;
  category: string;
};

/** A garment, placed. `z` is frontmost-highest, as the canvas expects. */
export type PlacedPiece = {
  id: string;
  category: string;
  x: number;
  y: number;
  scale: number;
  z: number;
};

export type LookLayoutPrefs = {
  slotDefaults: OutfitSlotDefaults;
  visualLayers: string[][];
  comboLayouts: Record<string, ComboLayout>;
  layerArrangements: Record<string, string[]>;
  layerOrder: string[];
  /**
   * The category tree, as data rather than a resolver.
   *
   * A nested category has to inherit the built-in size of the category it sits
   * under, or the carousel draws the same look at a different size than the
   * builder. That needs the ancestry — but these prefs are built in a server
   * component and handed to a client one, and a function cannot cross that
   * boundary ("Functions cannot be passed directly to Client Components").
   * So the tree travels as plain data and the resolver is built here.
   */
  categoryParents?: CategoryParents;
  categoryList?: string[];
};

export const EMPTY_LOOK_PREFS: LookLayoutPrefs = {
  slotDefaults: {},
  visualLayers: [],
  comboLayouts: {},
  layerArrangements: {},
  layerOrder: [],
};

/**
 * The combination key for a piece, given everything else in the look.
 *
 * Mirrors the builder's `comboKeyForSlot`: a piece is keyed by its own category
 * plus the exact set of categories sharing its visual layer, so a shirt worn
 * alone and a shirt worn under a jacket remember different positions.
 */
function comboKeyFor(
  piece: LookPiece,
  all: readonly LookPiece[],
  visualLayers: string[][],
): string {
  const index = layerIndexForCategories([piece.category], visualLayers);
  const present =
    index < 0
      ? [piece.category]
      : all
          .filter((p) => layerIndexForCategories([p.category], visualLayers) === index)
          .map((p) => p.category);
  return combinationKey([piece.category], present);
}

/**
 * Place every piece of one look.
 *
 * The order of operations matters and matches the builder exactly:
 *
 *   1. Resolve each piece from the saved slot default (or the built-in), with a
 *      per-signature index so two shirts don't land on the same spot.
 *   2. Apply the saved combination layout. A piece with a saved x *and* y is
 *      "pinned" — the user put it there by hand — and is excluded from step 3.
 *   3. Spread the unpinned pieces that share a layer sideways.
 *   4. Stack by the saved layer order, frontmost first.
 */
export function composeLook(
  pieces: readonly LookPiece[],
  prefs: LookLayoutPrefs = EMPTY_LOOK_PREFS,
): PlacedPiece[] {
  if (pieces.length === 0) return [];
  const {
    slotDefaults,
    visualLayers,
    comboLayouts,
    layerArrangements,
    layerOrder,
    categoryParents,
    categoryList,
  } = prefs;

  const ancestryOf = categoryParents
    ? (category: string) => categoryAncestryPath(category, categoryParents, categoryList ?? [])
    : undefined;

  // 1. Base placement, counting repeats of the same category signature.
  const usedBySignature = new Map<string, number>();
  const base = pieces.map((piece, i) => {
    const categories = [piece.category];
    const signature = categoryListSignature(categories);
    const used = usedBySignature.get(signature) ?? 0;
    usedBySignature.set(signature, used + 1);
    const layout = resolveSlotLayout(
      categories,
      used,
      slotDefaults,
      visualLayers,
      LOOK_FRAME_WIDTH,
      LOOK_FRAME_HEIGHT,
    );
    return {
      id: piece.id,
      category: piece.category,
      categories,
      x: layout.x,
      y: layout.y,
      scale: layout.scale,
      z: i + 1,
    };
  });

  // 2. Saved per-combination position and size.
  const pinned = new Set<string>();
  const laid = base.map((slot, i) => {
    const saved = comboLayouts[comboKeyFor(slot, pieces, visualLayers)];
    const scale = saved?.scale ?? builtinCategoryScale(slot.categories, ancestryOf);
    if (saved?.x != null && saved?.y != null) {
      pinned.add(slot.id);
      return { ...slot, x: saved.x, y: saved.y, scale, z: i + 1 };
    }
    return { ...slot, scale, z: i + 1 };
  });

  // 3. Spread only what the user hasn't placed themselves.
  const spread = spreadOverlappingSlots(
    laid.filter((s) => !pinned.has(s.id)),
    LOOK_FRAME_WIDTH,
    visualLayers,
    layerArrangements,
  );
  const spreadById = new Map(spread.map((s) => [s.id, s]));
  const positioned = laid.map((s) => spreadById.get(s.id) ?? s);

  // 4. Stack. `orderSlotsByLayer` returns frontmost first, so invert to z.
  const frontToBack = orderSlotsByLayer(positioned, layerOrder);
  const total = frontToBack.length;
  return frontToBack.map((slot, i) => ({
    id: slot.id,
    category: slot.category,
    x: slot.x,
    y: slot.y,
    scale: slot.scale,
    z: total - i,
  }));
}

/**
 * Tight bounds around everything placed, in frame coordinates.
 *
 * A look of three pieces occupies maybe a third of the 560x960 canvas, and
 * rendering the whole canvas in a carousel slide would show a stamp floating in
 * white. The carousel fits to this instead. `pieceSize` is the on-canvas size a
 * piece is drawn at before its own scale.
 */
export function lookBounds(
  placed: readonly PlacedPiece[],
  pieceSize: number,
): { x: number; y: number; width: number; height: number } {
  if (placed.length === 0) {
    return { x: 0, y: 0, width: LOOK_FRAME_WIDTH, height: LOOK_FRAME_HEIGHT };
  }
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const piece of placed) {
    const half = (pieceSize * piece.scale) / 2;
    left = Math.min(left, piece.x - half);
    right = Math.max(right, piece.x + half);
    top = Math.min(top, piece.y - half);
    bottom = Math.max(bottom, piece.y + half);
  }
  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}
