/**
 * Paint-bucket background whitening, as a pure function over RGBA bytes.
 *
 * Extracted from `components/background-whitener.tsx` so the same algorithm runs
 * in two places that must agree: the interactive tool (canvas `ImageData`, user
 * clicks the seed) and the automatic pass on save (sharp raw buffer, seeds taken
 * from the frame corners). Two implementations would drift, and the whole point
 * of the automatic pass is that it does what the manual tool does.
 *
 * No canvas, no sharp, no DOM — it takes bytes and mutates them in place, so it
 * is testable exactly and usable from either side.
 */

/** Any RGBA byte container: canvas ImageData.data, or a sharp raw Buffer. */
export type RgbaBytes = Uint8ClampedArray | Uint8Array | Buffer;

export type SeedPoint = { x: number; y: number };

/**
 * Corners, inset by a pixel.
 *
 * The very edge row is where JPEG ringing and scanner/lens vignetting are worst,
 * so sampling at exactly (0,0) can pick a colour that is not representative of
 * the backdrop. One pixel in is enough to avoid that without risking landing on
 * the subject, which never reaches the corner in a catalog shot.
 */
export function cornerSeeds(width: number, height: number): SeedPoint[] {
  const x1 = Math.min(1, width - 1);
  const y1 = Math.min(1, height - 1);
  const x2 = Math.max(width - 2, 0);
  const y2 = Math.max(height - 2, 0);
  return [
    { x: x1, y: y1 },
    { x: x2, y: y1 },
    { x: x1, y: y2 },
    { x: x2, y: y2 },
  ];
}

/**
 * Paint pixels matching the seed colour at (sx, sy) to pure white. `tolerance`
 * is the maximum per-channel difference. When `contiguous`, only the region
 * connected to the seed is filled (4-neighbour flood), which is what protects a
 * pale garment enclosed by darker edges.
 *
 * Returns how many pixels it painted, so callers can tell a no-op from a fill —
 * at a tight tolerance on a noisy JPEG, painting nothing is a likely outcome and
 * worth being able to report.
 */
export function fillToWhite(
  data: RgbaBytes,
  width: number,
  height: number,
  seed: SeedPoint,
  tolerance: number,
  contiguous = true,
): number {
  if (width <= 0 || height <= 0) return 0;
  const sx = Math.min(Math.max(Math.round(seed.x), 0), width - 1);
  const sy = Math.min(Math.max(Math.round(seed.y), 0), height - 1);

  const si = (sy * width + sx) * 4;
  const tr = data[si]!;
  const tg = data[si + 1]!;
  const tb = data[si + 2]!;

  const within = (i: number) =>
    Math.abs(data[i]! - tr) <= tolerance &&
    Math.abs(data[i + 1]! - tg) <= tolerance &&
    Math.abs(data[i + 2]! - tb) <= tolerance;

  let painted = 0;
  const paint = (i: number) => {
    // Already pure white costs nothing to skip and keeps the count honest.
    if (data[i] === 255 && data[i + 1] === 255 && data[i + 2] === 255) return;
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
    data[i + 3] = 255;
    painted += 1;
  };

  if (!contiguous) {
    for (let i = 0; i < width * height * 4; i += 4) if (within(i)) paint(i);
    return painted;
  }

  const total = width * height;
  const visited = new Uint8Array(total);
  const stack = new Int32Array(total);
  let top = 0;
  const start = sy * width + sx;
  visited[start] = 1;
  stack[top++] = start;

  while (top > 0) {
    const p = stack[--top]!;
    const i = p * 4;
    if (!within(i)) continue;
    paint(i);
    const x = p % width;
    const y = (p - x) / width;
    if (x > 0 && !visited[p - 1]) {
      visited[p - 1] = 1;
      stack[top++] = p - 1;
    }
    if (x < width - 1 && !visited[p + 1]) {
      visited[p + 1] = 1;
      stack[top++] = p + 1;
    }
    if (y > 0 && !visited[p - width]) {
      visited[p - width] = 1;
      stack[top++] = p - width;
    }
    if (y < height - 1 && !visited[p + width]) {
      visited[p + width] = 1;
      stack[top++] = p + width;
    }
  }
  return painted;
}

/**
 * Run the bucket fill from several seeds in turn, sharing one buffer.
 *
 * Corners rather than one click is what makes the automatic pass automatic: a
 * backdrop is rarely uniform enough for a single seed to reach all of it, and
 * each corner re-samples its own local colour.
 */
export function fillToWhiteFromSeeds(
  data: RgbaBytes,
  width: number,
  height: number,
  seeds: readonly SeedPoint[],
  tolerance: number,
  contiguous = true,
): number {
  let painted = 0;
  for (const seed of seeds) {
    painted += fillToWhite(data, width, height, seed, tolerance, contiguous);
  }
  return painted;
}
