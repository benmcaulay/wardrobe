/**
 * Knock a flat backdrop out of a product photo.
 *
 * Used wherever a garment has to float on the page rather than sit in a tile:
 * the outfit canvas, and the orbit in Pack mode.
 *
 * The naive version of this — "make every pixel brighter than 240 transparent"
 * — is what this replaces. It works until someone photographs a white shirt,
 * at which point the shirt disappears along with the backdrop. Extending that
 * approach to black backgrounds would be far worse, because black clothing is
 * everywhere: a global threshold would erase most of the wardrobe.
 *
 * So the backdrop is found rather than assumed, and removed by flood fill from
 * the edges. A white shirt on white keeps its body because the body isn't
 * connected to the border; a black jacket on white is untouched because the
 * border is white and the fill never reaches the jacket. Only pixels that are
 * both background-coloured *and* reachable from outside the subject go.
 *
 * Pure and DOM-free: takes raw RGBA, mutates alpha in place. The canvas work
 * lives in lib/outfit-piece-image.ts.
 */

export type Rgb = { r: number; g: number; b: number };

/** Channel value at or above which a backdrop counts as "pure white". */
const WHITE_MIN = 232;
/** Channel value at or below which a backdrop counts as "pure black". */
const BLACK_MAX = 32;

/**
 * How far a pixel may stray from the backdrop colour and still be removed.
 *
 * Tight on purpose. Connectivity protects a white shirt whose body is enclosed
 * by darker edges, but it cannot protect one whose *own colour* is within
 * tolerance of the backdrop — the fill walks straight in. 20 levels is about
 * where JPEG ringing on a flat backdrop stops and a garment's own shading
 * begins; anything looser starts eating pale clothing from the edge inward.
 *
 * The honest limit: a garment that is genuinely the same value as its backdrop,
 * with no shading at the boundary, cannot be separated from it by any of this,
 * and will lose its outer pixels. That's the case the feather band softens
 * rather than solves.
 */
const TOLERANCE = 20;

/** Below this, the border isn't one flat colour and nothing should be removed. */
const MAX_BORDER_SPREAD = 34;

function channelDistance(px: Uint8ClampedArray, i: number, c: Rgb): number {
  // Chebyshev rather than Euclidean: a backdrop that drifts on one channel
  // (warm white, blue-grey studio paper) shouldn't read as three times closer
  // than one that drifts on all three.
  return Math.max(
    Math.abs(px[i] - c.r),
    Math.abs(px[i + 1] - c.g),
    Math.abs(px[i + 2] - c.b),
  );
}

/**
 * The colour of the 1px border ring, and whether it's flat enough to trust.
 *
 * `spread` is the largest deviation any border pixel shows from the mean. A
 * photo taken on a rug or against a bookshelf has a high spread and gets left
 * alone — better an untouched photo than a garment with holes punched in it.
 */
export function detectBorderBackground(
  px: Uint8ClampedArray,
  width: number,
  height: number,
): { color: Rgb; spread: number } | null {
  if (width < 2 || height < 2) return null;

  const at = (x: number, y: number) => (y * width + x) * 4;
  const indices: number[] = [];
  for (let x = 0; x < width; x += 1) {
    indices.push(at(x, 0), at(x, height - 1));
  }
  for (let y = 1; y < height - 1; y += 1) {
    indices.push(at(0, y), at(width - 1, y));
  }
  if (indices.length === 0) return null;

  let r = 0;
  let g = 0;
  let b = 0;
  for (const i of indices) {
    r += px[i];
    g += px[i + 1];
    b += px[i + 2];
  }
  const color = {
    r: Math.round(r / indices.length),
    g: Math.round(g / indices.length),
    b: Math.round(b / indices.length),
  };

  let spread = 0;
  for (const i of indices) {
    const d = channelDistance(px, i, color);
    if (d > spread) spread = d;
  }
  return { color, spread };
}

/** Whether a detected backdrop is one we're willing to remove. */
export function isRemovableBackdrop(color: Rgb): boolean {
  const white = color.r >= WHITE_MIN && color.g >= WHITE_MIN && color.b >= WHITE_MIN;
  const black = color.r <= BLACK_MAX && color.g <= BLACK_MAX && color.b <= BLACK_MAX;
  return white || black;
}

/**
 * Erase the backdrop, in place. Returns how many pixels were cleared.
 *
 * Flood fill from every border pixel that matches the backdrop, four-connected,
 * with an explicit stack — a recursive fill blows the call stack on anything
 * bigger than a thumbnail.
 *
 * Edge pixels that survive but sit next to a cleared one get partial alpha
 * scaled by how far they are from the backdrop. Without it, JPEG haloing leaves
 * a hard bright fringe that reads as a cheap cut-out.
 */
export function knockOutBackdrop(
  px: Uint8ClampedArray,
  width: number,
  height: number,
  color: Rgb,
  tolerance = TOLERANCE,
): number {
  const count = width * height;
  if (count === 0) return 0;

  const removed = new Uint8Array(count);
  const queued = new Uint8Array(count);
  const stack: number[] = [];

  const push = (p: number) => {
    if (queued[p]) return;
    queued[p] = 1;
    stack.push(p);
  };

  for (let x = 0; x < width; x += 1) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    push(y * width);
    push(y * width + width - 1);
  }

  let cleared = 0;
  while (stack.length > 0) {
    const p = stack.pop()!;
    const i = p * 4;
    if (channelDistance(px, i, color) > tolerance) continue;

    removed[p] = 1;
    px[i + 3] = 0;
    cleared += 1;

    const x = p % width;
    const y = (p - x) / width;
    if (x > 0) push(p - 1);
    if (x < width - 1) push(p + 1);
    if (y > 0) push(p - width);
    if (y < height - 1) push(p + width);
  }

  if (cleared === 0) return 0;

  /*
   * Feather the survivors that touch a hole.
   *
   * The band has to sit *beyond* the fill tolerance, not inside it: anything
   * within tolerance was already removed, so a ramp over [0, tolerance] would
   * never match a surviving pixel and the whole pass would be dead code. It
   * runs from tolerance to 2x tolerance instead — just outside the backdrop,
   * fade almost out; clearly the garment, leave alone.
   */
  for (let p = 0; p < count; p += 1) {
    if (removed[p]) continue;
    const x = p % width;
    const y = (p - x) / width;
    const touching =
      (x > 0 && removed[p - 1]) ||
      (x < width - 1 && removed[p + 1]) ||
      (y > 0 && removed[p - width]) ||
      (y < height - 1 && removed[p + width]);
    if (!touching) continue;

    const i = p * 4;
    const d = channelDistance(px, i, color);
    const ramp = Math.min(1, Math.max(0, (d - tolerance) / tolerance));
    if (ramp >= 1) continue;
    px[i + 3] = Math.round(px[i + 3] * ramp);
  }

  return cleared;
}

/**
 * Detect and remove in one step. Returns false when nothing was done, so the
 * caller can keep the original image rather than ship a re-encoded copy of it.
 */
export function cutOutBackdrop(
  px: Uint8ClampedArray,
  width: number,
  height: number,
): boolean {
  const detected = detectBorderBackground(px, width, height);
  if (!detected) return false;
  if (detected.spread > MAX_BORDER_SPREAD) return false;
  if (!isRemovableBackdrop(detected.color)) return false;
  return knockOutBackdrop(px, width, height, detected.color) > 0;
}
