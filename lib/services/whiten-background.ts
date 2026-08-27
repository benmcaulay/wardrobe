import sharp from "sharp";
import { numEnv } from "../env";

/**
 * Post-process an AI-generated catalog image to guarantee a pure-white
 * background, regardless of what the model actually produced.
 *
 * Primary strategy (avoids eating white garments that touch the frame):
 * - Seed the flood fill only from **edge** pixels that are almost pure white
 *   (RGB min ≥ SEED_MIN).
 * - Expand only to neighbors with RGB min ≥ EXPAND_MIN (stricter than the
 *   old single 232 threshold), so slightly dimmer studio walls still fill, but
 *   a white tee body (often 230–245) does not connect from the edge.
 *
 * If that yields almost no background (e.g. flat #ededed studio), we **fall
 * back** to the legacy edge flood at `threshold` (default 232).
 *
 * Finally we **erode** the background mask by a few pixels so any thin
 * misclassification along the silhouette is flipped back to foreground.
 *
 * Returns two buffers:
 *  - flattened: the original image with background pixels clamped to #ffffff
 *    (suitable for catalog display, JPEG-compressible).
 *  cutout:   the same image with background pixels made transparent
 *    (suitable for compositing into virtual try-on / outfit shots).
 */
const SEED_MIN = numEnv("GHOST_WHITEN_SEED_MIN", 249);
const EXPAND_MIN = numEnv("GHOST_WHITEN_EXPAND_MIN", 246);
const DEFAULT_LEGACY_THRESHOLD = numEnv("GHOST_WHITEN_LEGACY_MIN", 232);
const MIN_BG_FRACTION = 0.012;
const ERODE_PASSES = numEnv("GHOST_WHITEN_ERODE_PASSES", 2);
/**
 * Halo cleanup. After the binary mask + erosion, a thin band of near-white
 * anti-alias pixels often survives as foreground right against the background —
 * that band reads as a faint gray halo around the garment in the flattened
 * catalog image. We snap foreground pixels at/above HALO_CLEAN_MIN that hug the
 * background to pure white. The threshold is high on purpose: a white garment
 * edge the model has shaded for separation (~#e6e6e6) stays below it and is
 * preserved, so this kills the halo without eating shaded edges. Only the
 * flattened image is touched; the cutout's alpha edge is left as-is.
 */
const HALO_CLEAN_MIN = numEnv("GHOST_WHITEN_HALO_MIN", 244);
const HALO_CLEAN_PASSES = numEnv("GHOST_WHITEN_HALO_PASSES", 2);

function rgbMin(data: Buffer, px: number): number {
  const i = px * 4;
  return Math.min(data[i]!, data[i + 1]!, data[i + 2]!);
}

function floodFromEdges(
  data: Buffer,
  width: number,
  height: number,
  total: number,
  edgeSeed: (px: number) => boolean,
  expandOk: (px: number) => boolean,
): Uint8Array {
  const isBg = new Uint8Array(total);
  const stack = new Int32Array(total);
  let top = 0;
  const push = (px: number) => {
    if (isBg[px]) return;
    if (!expandOk(px)) return;
    isBg[px] = 1;
    stack[top++] = px;
  };
  const seedPush = (px: number) => {
    if (isBg[px]) return;
    if (!edgeSeed(px)) return;
    isBg[px] = 1;
    stack[top++] = px;
  };

  for (let x = 0; x < width; x++) {
    seedPush(x);
    seedPush((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    seedPush(y * width);
    seedPush(y * width + (width - 1));
  }

  while (top > 0) {
    const px = stack[--top];
    const x = px % width;
    const y = (px - x) / width;
    if (x > 0) push(px - 1);
    if (x < width - 1) push(px + 1);
    if (y > 0) push(px - width);
    if (y < height - 1) push(px + width);
  }
  return isBg;
}

function countBg(isBg: Uint8Array, total: number): number {
  let n = 0;
  for (let p = 0; p < total; p++) if (isBg[p]) n++;
  return n;
}

/** Remove background pixels that border foreground (shrink false-positive bg). */
function erodeBackgroundMask(
  isBg: Uint8Array,
  width: number,
  height: number,
  passes: number,
): void {
  const total = width * height;
  const next = new Uint8Array(total);
  for (let pass = 0; pass < passes; pass++) {
    next.fill(0);
    for (let p = 0; p < total; p++) {
      if (!isBg[p]) continue;
      const x = p % width;
      const y = (p - x) / width;
      let allNeighborsBg = true;
      if (x > 0 && !isBg[p - 1]) allNeighborsBg = false;
      if (x < width - 1 && !isBg[p + 1]) allNeighborsBg = false;
      if (y > 0 && !isBg[p - width]) allNeighborsBg = false;
      if (y < height - 1 && !isBg[p + width]) allNeighborsBg = false;
      if (allNeighborsBg) next[p] = 1;
    }
    isBg.set(next);
  }
}

/**
 * Flag near-white FOREGROUND pixels hugging the background — the gray anti-alias
 * fringe the binary mask + erosion leave as a halo. Only pixels at/above
 * `minWhite` are caught (a shaded garment edge stays below it), and the flag
 * grows up to `passes` pixels inward through further near-white foreground.
 * Returns a mask of pixels the caller should clamp to white in the flattened
 * image. Interior whites (not touching the background) are never flagged.
 */
export function computeHaloSnapMask(
  data: Buffer,
  isBg: Uint8Array,
  width: number,
  height: number,
  minWhite: number,
  passes: number,
): Uint8Array {
  const total = width * height;
  const snap = new Uint8Array(total);
  if (passes <= 0) return snap;

  const isNearWhiteFg = (p: number) => !isBg[p] && rgbMin(data, p) >= minWhite;

  let frontier: number[] = [];
  for (let p = 0; p < total; p++) {
    if (!isNearWhiteFg(p)) continue;
    const x = p % width;
    const y = (p - x) / width;
    const touchesBg =
      (x > 0 && isBg[p - 1] === 1) ||
      (x < width - 1 && isBg[p + 1] === 1) ||
      (y > 0 && isBg[p - width] === 1) ||
      (y < height - 1 && isBg[p + width] === 1);
    if (touchesBg) {
      snap[p] = 1;
      frontier.push(p);
    }
  }

  for (let pass = 1; pass < passes && frontier.length > 0; pass++) {
    const next: number[] = [];
    for (const p of frontier) {
      const x = p % width;
      const y = (p - x) / width;
      const tryNb = (n: number) => {
        if (!snap[n] && isNearWhiteFg(n)) {
          snap[n] = 1;
          next.push(n);
        }
      };
      if (x > 0) tryNb(p - 1);
      if (x < width - 1) tryNb(p + 1);
      if (y > 0) tryNb(p - width);
      if (y < height - 1) tryNb(p + width);
    }
    frontier = next;
  }
  return snap;
}

export type WhitenBackgroundOptions = {
  /** Legacy fallback: edge seed + expansion both use this RGB minimum (default 232). */
  threshold?: number;
  /** Min RGB for a foreground fringe pixel to be snapped white (default 244). */
  haloMin?: number;
  /** How many pixels inward the halo snap grows (default 2; 0 disables it). */
  haloPasses?: number;
};

export async function whitenBackground(
  input: Buffer,
  opts: WhitenBackgroundOptions = {},
): Promise<{ flattened: Buffer; cutout: Buffer }> {
  const legacyMin = opts.threshold ?? DEFAULT_LEGACY_THRESHOLD;

  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  if (channels !== 4) {
    throw new Error(`Expected 4 channels after ensureAlpha, got ${channels}`);
  }

  const total = width * height;

  let isBg = floodFromEdges(
    data,
    width,
    height,
    total,
    (px) => rgbMin(data, px) >= SEED_MIN,
    (px) => rgbMin(data, px) >= EXPAND_MIN,
  );

  const bgFrac = countBg(isBg, total) / total;
  if (bgFrac < MIN_BG_FRACTION) {
    isBg = floodFromEdges(
      data,
      width,
      height,
      total,
      (px) => rgbMin(data, px) >= legacyMin,
      (px) => rgbMin(data, px) >= legacyMin,
    );
  }

  erodeBackgroundMask(isBg, width, height, ERODE_PASSES);

  // Snap the near-white anti-alias fringe (foreground hugging the background)
  // to white in the flattened image so it doesn't read as a gray halo.
  const haloMin = opts.haloMin ?? HALO_CLEAN_MIN;
  const haloPasses = opts.haloPasses ?? HALO_CLEAN_PASSES;
  const haloSnap = computeHaloSnapMask(data, isBg, width, height, haloMin, haloPasses);

  const flatRgb = Buffer.allocUnsafe(total * 3);
  const cutRgba = Buffer.allocUnsafe(total * 4);
  for (let p = 0; p < total; p++) {
    const di = p * 4;
    const r = data[di]!,
      g = data[di + 1]!,
      b = data[di + 2]!;
    const bg = isBg[p] === 1;
    const fi = p * 3;
    if (bg) {
      flatRgb[fi] = 255;
      flatRgb[fi + 1] = 255;
      flatRgb[fi + 2] = 255;
      cutRgba[di] = 255;
      cutRgba[di + 1] = 255;
      cutRgba[di + 2] = 255;
      cutRgba[di + 3] = 0;
    } else {
      // Foreground: clamp the near-white halo fringe to white in the catalog
      // image only; the cutout keeps original pixels + alpha for compositing.
      const snapWhite = haloSnap[p] === 1;
      flatRgb[fi] = snapWhite ? 255 : r;
      flatRgb[fi + 1] = snapWhite ? 255 : g;
      flatRgb[fi + 2] = snapWhite ? 255 : b;
      cutRgba[di] = r;
      cutRgba[di + 1] = g;
      cutRgba[di + 2] = b;
      cutRgba[di + 3] = data[di + 3]!;
    }
  }

  const flattened = await sharp(flatRgb, {
    raw: { width, height, channels: 3 },
  })
    .toFormat("png")
    .toBuffer();
  const cutout = await sharp(cutRgba, {
    raw: { width, height, channels: 4 },
  })
    .png()
    .toBuffer();

  return { flattened, cutout };
}
