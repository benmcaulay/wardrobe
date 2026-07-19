import sharp from "sharp";

function numEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
}

const NECK_BRIGHT_MIN = numEnv("GHOST_NECK_WHITE_MIN", 220);
const BRIGHTNESS_DELTA = numEnv("GHOST_NECK_BRIGHTNESS_DELTA", 16);
const ENABLED = process.env.GHOST_NECK_POST_REMOVE !== "false";

export type RemoveNeckPostOptions = {
  /** Skip removal (e.g. footwear). */
  skip?: boolean;
};

export type GarmentBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  bw: number;
  bh: number;
  cx: number;
};

function rgbMin(data: Buffer, px: number): number {
  const i = px * 4;
  return Math.min(data[i]!, data[i + 1]!, data[i + 2]!);
}

function rgbMax(data: Buffer, px: number): number {
  const i = px * 4;
  return Math.max(data[i]!, data[i + 1]!, data[i + 2]!);
}

function dilateMask(mask: Uint8Array, width: number, height: number, passes = 1): Uint8Array {
  let current = mask;
  for (let pass = 0; pass < passes; pass++) {
    const total = width * height;
    const out = new Uint8Array(current);
    for (let p = 0; p < total; p++) {
      if (!current[p]) continue;
      const x = p % width;
      const y = (p - x) / width;
      out[p] = 1;
      if (x > 0) out[p - 1] = 1;
      if (x < width - 1) out[p + 1] = 1;
      if (y > 0) out[p - width] = 1;
      if (y < height - 1) out[p + width] = 1;
    }
    current = out;
  }
  return current;
}

export function foregroundBounds(
  data: Buffer,
  width: number,
  height: number,
  alphaThreshold = 128,
): GarmentBounds | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if ((data[p * 4 + 3] ?? 0) >= alphaThreshold) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX) return null;
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  return { minX, minY, maxX, maxY, bw, bh, cx: (minX + maxX) / 2 };
}

/** Median min-RGB of garment pixels outside the upper neckline band. */
export function garmentBodyBrightnessMedian(
  data: Buffer,
  width: number,
  height: number,
  bounds: GarmentBounds,
  alphaThreshold = 128,
): number {
  const neckBandBottom = bounds.minY + Math.floor(bounds.bh * 0.32);
  const samples: number[] = [];

  for (let y = bounds.minY; y <= bounds.maxY; y++) {
    for (let x = bounds.minX; x <= bounds.maxX; x++) {
      const p = y * width + x;
      if ((data[p * 4 + 3] ?? 0) < alphaThreshold) continue;
      if (y <= neckBandBottom) continue;
      samples.push(rgbMin(data, p));
    }
  }

  if (samples.length === 0) {
    for (let y = bounds.minY; y <= bounds.maxY; y++) {
      for (let x = bounds.minX; x <= bounds.maxX; x++) {
        const p = y * width + x;
        if ((data[p * 4 + 3] ?? 0) >= alphaThreshold) samples.push(rgbMin(data, p));
      }
    }
  }

  if (samples.length === 0) return 200;
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)]!;
}

function isMannequinCandidatePixel(
  data: Buffer,
  px: number,
  garmentMedian: number,
  brightMin: number,
): boolean {
  const min = rgbMin(data, px);
  const max = rgbMax(data, px);
  const neutral = max - min <= 18;
  const brighterThanGarment = min >= garmentMedian + BRIGHTNESS_DELTA;
  const nearWhite = min >= brightMin && neutral;
  return nearWhite || (brighterThanGarment && neutral && min >= brightMin - 12);
}

/**
 * Heuristic mask for AI-hallucinated mannequin neck/head inserts — narrow posts
 * and wider head forms in the upper-center neckline/hood region.
 */
export function computeNeckPostMask(
  data: Buffer,
  width: number,
  height: number,
  alphaThreshold = 128,
  brightMin = NECK_BRIGHT_MIN,
): Uint8Array {
  const total = width * height;
  const bounds = foregroundBounds(data, width, height, alphaThreshold);
  if (!bounds) return new Uint8Array(total);

  const { minY, bw, bh, cx } = bounds;
  const garmentMedian = garmentBodyBrightnessMedian(data, width, height, bounds, alphaThreshold);
  const roiTop = minY;
  const roiBottom = minY + Math.floor(bh * 0.52);
  const roiHalfW = Math.floor(bw * 0.22);

  const candidate = new Uint8Array(total);
  for (let y = roiTop; y <= roiBottom; y++) {
    for (let x = Math.floor(cx - roiHalfW); x <= Math.ceil(cx + roiHalfW); x++) {
      if (x < 0 || x >= width) continue;
      const p = y * width + x;
      if ((data[p * 4 + 3] ?? 0) < alphaThreshold) continue;
      if (isMannequinCandidatePixel(data, p, garmentMedian, brightMin)) candidate[p] = 1;
    }
  }

  const remove = new Uint8Array(total);
  const visited = new Uint8Array(total);

  for (let p = 0; p < total; p++) {
    if (!candidate[p] || visited[p]) continue;

    const stack = [p];
    const comp: number[] = [];
    visited[p] = 1;
    let compMinX = width;
    let compMaxX = -1;
    let compMinY = height;
    let compMaxY = -1;
    let brightnessSum = 0;

    while (stack.length > 0) {
      const cur = stack.pop()!;
      comp.push(cur);
      brightnessSum += rgbMin(data, cur);
      const x = cur % width;
      const y = (cur - x) / width;
      if (x < compMinX) compMinX = x;
      if (x > compMaxX) compMaxX = x;
      if (y < compMinY) compMinY = y;
      if (y > compMaxY) compMaxY = y;

      const tryPush = (n: number, nx: number, ny: number) => {
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) return;
        if (!candidate[n] || visited[n]) return;
        visited[n] = 1;
        stack.push(n);
      };

      if (x > 0) tryPush(cur - 1, x - 1, y);
      if (x < width - 1) tryPush(cur + 1, x + 1, y);
      if (y > 0) tryPush(cur - width, x, y - 1);
      if (y < height - 1) tryPush(cur + width, x, y + 1);
    }

    const cw = compMaxX - compMinX + 1;
    const ch = compMaxY - compMinY + 1;
    const aspect = ch / Math.max(cw, 1);
    const maxNarrowWidth = Math.max(10, Math.floor(bw * 0.16));
    const maxHeadWidth = Math.max(20, Math.floor(bw * 0.58));
    const minFormHeight = Math.max(18, Math.floor(bh * 0.05));
    const maxHeadHeight = Math.floor(bh * 0.58);
    const compCx = (compMinX + compMaxX) / 2;
    const centered = Math.abs(compCx - cx) <= bw * 0.14;
    const inUpperGarment = compMinY <= minY + Math.floor(bh * 0.42);
    const compMean = brightnessSum / comp.length;
    const brighterThanGarment = compMean >= garmentMedian + BRIGHTNESS_DELTA - 4;

    const narrowPost =
      centered &&
      inUpperGarment &&
      brighterThanGarment &&
      cw <= maxNarrowWidth &&
      ch >= minFormHeight &&
      aspect >= 1.2;

    const headOrWideNeck =
      centered &&
      inUpperGarment &&
      brighterThanGarment &&
      cw <= maxHeadWidth &&
      ch >= minFormHeight &&
      ch <= maxHeadHeight &&
      comp.length >= minFormHeight;

    if (narrowPost || headOrWideNeck) {
      for (const px of comp) remove[px] = 1;
    }
  }

  return dilateMask(remove, width, height, 2);
}

export function countMaskPixels(mask: Uint8Array): number {
  let n = 0;
  for (let p = 0; p < mask.length; p++) if (mask[p]) n++;
  return n;
}

/** True when a bright mannequin-like form likely remains after cleanup. */
export function hasSuspectedNeckForm(
  data: Buffer,
  width: number,
  height: number,
  alphaThreshold = 128,
): boolean {
  const bounds = foregroundBounds(data, width, height, alphaThreshold);
  if (!bounds) return false;

  const garmentMedian = garmentBodyBrightnessMedian(data, width, height, bounds, alphaThreshold);
  const roiBottom = bounds.minY + Math.floor(bounds.bh * 0.45);
  const roiHalfW = Math.floor(bounds.bw * 0.18);
  let brightCount = 0;
  let roiCount = 0;

  for (let y = bounds.minY; y <= roiBottom; y++) {
    for (let x = Math.floor(bounds.cx - roiHalfW); x <= Math.ceil(bounds.cx + roiHalfW); x++) {
      if (x < bounds.minX || x > bounds.maxX) continue;
      const p = y * width + x;
      if ((data[p * 4 + 3] ?? 0) < alphaThreshold) continue;
      roiCount++;
      if (isMannequinCandidatePixel(data, p, garmentMedian, NECK_BRIGHT_MIN)) brightCount++;
    }
  }

  if (roiCount === 0) return false;
  return brightCount / roiCount >= 0.08;
}

/**
 * Remove common ghost-mannequin failure mode: a white plastic neck cylinder
 * or partial mannequin head inside the collar/hood opening.
 */
export async function removeNeckPost(
  flattened: Buffer,
  cutout: Buffer,
  opts: RemoveNeckPostOptions = {},
): Promise<{ flattened: Buffer; cutout: Buffer; removedPixels: number; suspectedRemaining: boolean }> {
  if (opts.skip || !ENABLED) {
    return { flattened, cutout, removedPixels: 0, suspectedRemaining: false };
  }

  const { data, info } = await sharp(cutout)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const mask = computeNeckPostMask(data, width, height);
  const removedPixels = countMaskPixels(mask);

  if (removedPixels === 0) {
    return {
      flattened,
      cutout,
      removedPixels: 0,
      suspectedRemaining: hasSuspectedNeckForm(data, width, height),
    };
  }

  const cutData = Buffer.from(data);
  for (let p = 0; p < width * height; p++) {
    if (!mask[p]) continue;
    cutData[p * 4 + 3] = 0;
  }

  const flatRaw = await sharp(flattened).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const flatData = Buffer.from(flatRaw.data);
  for (let p = 0; p < width * height; p++) {
    if (!mask[p]) continue;
    const i = p * 3;
    flatData[i] = 255;
    flatData[i + 1] = 255;
    flatData[i + 2] = 255;
  }

  const [newCutout, newFlat] = await Promise.all([
    sharp(cutData, { raw: { width, height, channels: 4 } }).png().toBuffer(),
    sharp(flatData, { raw: { width, height, channels: 3 } }).png().toBuffer(),
  ]);

  const { data: cleaned } = await sharp(newCutout).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  return {
    flattened: newFlat,
    cutout: newCutout,
    removedPixels,
    suspectedRemaining: hasSuspectedNeckForm(cleaned, width, height),
  };
}
