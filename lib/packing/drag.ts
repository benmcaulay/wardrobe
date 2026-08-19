/**
 * Hit-testing and fit maths for dragging things into bags.
 *
 * Packing used to be a `<select>` per row — correct, keyboard-friendly, and
 * completely unlike the thing it models. You don't pick your suitcase from a
 * dropdown, you put the jumper in it. The drag layer in `packing-drag.tsx`
 * does the gesture; this module does the arithmetic behind it, so the two
 * questions that actually matter — "which bag am I over?" and "will it fit?" —
 * are pure functions with tests rather than guesses inside a pointer handler.
 *
 * The select stays. Drag is an enhancement layered on top; anything reachable
 * by dragging is still reachable by keyboard.
 */

export type Rect = { left: number; top: number; right: number; bottom: number };

export type DropZone = {
  /** Bag id, or the sentinel the planner uses for "not packed". */
  id: string;
  rect: Rect;
};

function contains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function area(rect: Rect): number {
  return Math.max(0, rect.right - rect.left) * Math.max(0, rect.bottom - rect.top);
}

/**
 * Which zone the pointer is inside, or null.
 *
 * Ties break to the smallest zone. Nothing nests today, but the unpacked pool
 * sits inside the same scroll column as the bags, and a layout change that put
 * one inside the other should drop into the inner one rather than silently
 * picking whichever registered first.
 */
export function zoneAtPoint(zones: DropZone[], x: number, y: number): string | null {
  let best: DropZone | null = null;
  for (const zone of zones) {
    if (!contains(zone.rect, x, y)) continue;
    if (!best || area(zone.rect) < area(best.rect)) best = zone;
  }
  return best?.id ?? null;
}

export type FitPreview = {
  /** Fraction of the bag already used, 0..1, clamped. */
  usedFraction: number;
  /** Where the bar would end if this were dropped, 0..1, clamped. */
  previewFraction: number;
  /** True when dropping this would exceed the bag. */
  overflows: boolean;
  /** How much over, in the same unit. Zero when it fits. */
  overBy: number;
};

/**
 * What the meter should show while something hovers over a bag.
 *
 * This is the part that earns the gesture: the bar grows a translucent segment
 * for the incoming item *before* you let go, so "will this fit" is answered by
 * looking rather than by dropping it and reading a number. Used for volume and
 * again for weight.
 *
 * A zero or missing capacity can't be exceeded meaningfully — a bag with no
 * stated weight limit isn't over it — so it reports empty rather than dividing
 * by zero into Infinity and painting a full red bar.
 */
export function fitPreview(input: {
  used: number;
  capacity: number | null;
  incoming: number;
}): FitPreview {
  const { used, incoming } = input;
  const capacity = input.capacity;
  if (capacity == null || !Number.isFinite(capacity) || capacity <= 0) {
    return { usedFraction: 0, previewFraction: 0, overflows: false, overBy: 0 };
  }
  const total = used + incoming;
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  // A hair of tolerance so floating-point noise on an exact fit doesn't paint
  // a red "over capacity" warning for 0.0000001 of a litre.
  const overBy = Math.max(0, total - capacity);
  return {
    usedFraction: clamp(used / capacity),
    previewFraction: clamp(total / capacity),
    overflows: overBy > 1e-6,
    overBy,
  };
}

/**
 * Whether a pointer has moved far enough to mean "drag" rather than "tap".
 *
 * Rows carry buttons and a select, and a click that wobbles by a pixel must
 * still be a click. Squared distance so this can run on every pointermove
 * without a square root.
 */
export const DRAG_THRESHOLD_PX = 6;

export function passedThreshold(
  from: { x: number; y: number },
  to: { x: number; y: number },
  threshold = DRAG_THRESHOLD_PX,
): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return dx * dx + dy * dy >= threshold * threshold;
}
