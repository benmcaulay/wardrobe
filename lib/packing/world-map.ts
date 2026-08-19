/**
 * Projection and viewport maths for the trip page's map window.
 *
 * Pure, so it can be tested without a DOM and so the numbers here can be
 * checked against `scripts/build-world-map.ts`, which projects the path data
 * with the identical formula. If the two ever disagree the pin lands in the
 * sea, so `__tests__/world-map.test.ts` pins the projection to known cities.
 *
 * The projection is equirectangular (plate carrée): longitude scales linearly
 * to x, latitude linearly to y. Chosen for exactly one reason — placing a dot
 * is two multiplications with no trigonometry and no inverse to get wrong.
 * It stretches the high latitudes, which matters for a map you navigate and
 * not at all for a window that says "you are going here".
 */

import { WORLD_HEIGHT, WORLD_WIDTH } from "./world-map-data";

export { WORLD_HEIGHT, WORLD_WIDTH };

/**
 * Latitudes the "whole world" view is cropped to.
 *
 * Uncropped, a quarter of the window is Antarctica and empty Arctic ocean —
 * the map reads as mostly nothing. Cutting at 84°N/56°S keeps every populated
 * place (northernmost settlement: Alert, 82.5°N) and every country the picker
 * can return, while filling the frame with land.
 */
export const WORLD_NORTH = 84;
export const WORLD_SOUTH = -56;

/** Degrees of longitude the close-up view spans. Roughly a continent's worth. */
export const REGION_SPAN_DEGREES = 44;

export type Viewport = { x: number; y: number; width: number; height: number };

/** SVG `viewBox` attribute for a viewport. */
export function viewBoxOf(v: Viewport): string {
  const r = (n: number) => Math.round(n * 100) / 100;
  return `${r(v.x)} ${r(v.y)} ${r(v.width)} ${r(v.height)}`;
}

export function projectX(longitude: number): number {
  return ((longitude + 180) / 360) * WORLD_WIDTH;
}

export function projectY(latitude: number): number {
  return ((90 - latitude) / 180) * WORLD_HEIGHT;
}

export function project(longitude: number, latitude: number): { x: number; y: number } {
  return { x: projectX(longitude), y: projectY(latitude) };
}

/** The cropped world box, before it's fitted to the card. */
function worldBox(): Viewport {
  const y = projectY(WORLD_NORTH);
  return { x: 0, y, width: WORLD_WIDTH, height: projectY(WORLD_SOUTH) - y };
}

/**
 * The card's aspect ratio, derived from the world crop rather than picked.
 *
 * Tying the two together means the world view fills the card exactly — no
 * letterbox bars, no arbitrary crop of the continents — and the close-up view
 * inherits the same shape, so toggling between them changes what's in the
 * window without changing the window.
 */
export const MAP_ASPECT_RATIO = WORLD_WIDTH / worldBox().height;

/**
 * Grow `box` to `aspect` about its centre. Only ever expands, so the caller's
 * region of interest is always still inside the result.
 */
function fitAspect(box: Viewport, aspect: number): Viewport {
  const current = box.width / box.height;
  if (Math.abs(current - aspect) < 1e-9) return box;
  if (current < aspect) {
    const width = box.height * aspect;
    return { ...box, x: box.x - (width - box.width) / 2, width };
  }
  const height = box.width / aspect;
  return { ...box, y: box.y - (height - box.height) / 2, height };
}

/**
 * Slide `box` back inside the canvas without resizing it.
 *
 * Sliding rather than clipping is what keeps the window the same size and
 * shape everywhere on Earth. The cost is that a destination near a map edge
 * sits off-centre — Reykjavík pushed right, Auckland pushed up — which is the
 * correct trade: an off-centre pin still reads, a squashed window doesn't.
 *
 * A destination near the antimeridian (Fiji, Kamchatka) gets the same
 * treatment, so its window shows one side of the date line rather than
 * wrapping around. Wrapping would need the path data duplicated either side,
 * which is a lot of bytes to spend on the Pacific.
 */
function clampToCanvas(box: Viewport): Viewport {
  const width = Math.min(box.width, WORLD_WIDTH);
  const height = Math.min(box.height, WORLD_HEIGHT);
  return {
    width,
    height,
    x: Math.min(Math.max(box.x, 0), WORLD_WIDTH - width),
    y: Math.min(Math.max(box.y, 0), WORLD_HEIGHT - height),
  };
}

/** The whole world, cropped to the populated latitudes. */
export function worldViewport(): Viewport {
  return clampToCanvas(fitAspect(worldBox(), MAP_ASPECT_RATIO));
}

/**
 * A window centred on one place, `spanDegrees` of longitude across.
 *
 * Falls back to the world view when there are no coordinates — a trip whose
 * destination we never resolved should still show a map rather than a hole.
 */
export function regionViewport(
  point: { latitude: number; longitude: number } | null,
  spanDegrees: number = REGION_SPAN_DEGREES,
): Viewport {
  if (!point || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) {
    return worldViewport();
  }
  const width = (spanDegrees / 360) * WORLD_WIDTH;
  const height = width / MAP_ASPECT_RATIO;
  const { x, y } = project(point.longitude, point.latitude);
  return clampToCanvas({ x: x - width / 2, y: y - height / 2, width, height });
}

/**
 * Scale factor from canvas units to the rendered card, for anything that must
 * keep a constant on-screen size as the viewport zooms — the pin, its ring,
 * the coastline stroke. SVG scales stroke widths with the viewBox by default,
 * so a 0.5-unit border that looks right zoomed out becomes a slab zoomed in.
 * Dividing by this holds them still.
 */
export function unitScale(v: Viewport): number {
  return WORLD_WIDTH / v.width;
}

/**
 * A CSS transform that makes the `to` viewport fill the frame `from` occupies.
 *
 * Zooming is done by transforming a group rather than by animating the SVG
 * `viewBox`, because `viewBox` is an attribute and isn't transitionable. The
 * SVG keeps `from` as its viewBox forever and this slides the map underneath.
 *
 * Two things about this are easy to get wrong, and both did:
 *
 *  1. It must be *CSS* transform syntax — `translate(10px, 5px)`, with units
 *     and a comma. The SVG attribute spelling (`translate(10 5)`) is invalid
 *     as CSS and browsers drop the whole declaration silently, which shows up
 *     as a map that simply never zooms.
 *  2. It is applied about `transform-origin`, which with the component's
 *     `transform-box: view-box; transform-origin: 0 0` is user-space (0,0) —
 *     *not* the viewBox's top-left corner, even when the viewBox has a
 *     non-zero min-y. Measured with `getScreenCTM`, not assumed: deriving this
 *     for the corner instead put the pin 119 canvas units off the city, which
 *     on screen was Seoul sitting in the Yellow Sea.
 *
 * So a point v lands at k·v + t, and we want it at from.origin + k(v − to.origin),
 * which gives t = from.origin − k·to.origin.
 */
export function zoomTransform(from: Viewport, to: Viewport): string {
  const k = from.width / to.width;
  // Five decimals, not three: the scale factor multiplies every coordinate on
  // the map, so at an 8x zoom a rounding error in `k` alone shifts the far
  // edge of the world by a sixth of a canvas unit.
  const r = (n: number) => Math.round(n * 100000) / 100000;
  const tx = from.x - k * to.x;
  const ty = from.y - k * to.y;
  return `translate(${r(tx)}px, ${r(ty)}px) scale(${r(k)})`;
}

/**
 * Where a point ends up on screen once `zoomTransform` has been applied —
 * in the outer (viewBox) coordinate space.
 *
 * The pin is drawn outside the zoomed group so that its size stays constant as
 * the map scales, which means its position has to be worked out by hand rather
 * than inherited.
 */
export function placeOnViewport(
  point: { latitude: number; longitude: number },
  from: Viewport,
  to: Viewport,
): { x: number; y: number } {
  const k = from.width / to.width;
  const { x, y } = project(point.longitude, point.latitude);
  return { x: from.x + (x - to.x) * k, y: from.y + (y - to.y) * k };
}
