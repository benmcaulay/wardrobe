import sharp from "sharp";

/**
 * Post-process an AI-generated catalog image to guarantee a pure-white
 * background, regardless of what the model actually produced.
 *
 * The algorithm: build a binary mask of "near-white" pixels (R, G, B all
 * above NEAR_WHITE_THRESHOLD), then flood-fill from every edge pixel that's
 * already in the mask. Only pixels that are both near-white AND connected
 * to the image edge are treated as background — interior white regions of
 * the garment (e.g. a white shirt) are left alone.
 *
 * Returns two buffers:
 *  - flattened: the original image with background pixels clamped to #ffffff
 *    (suitable for catalog display, JPEG-compressible).
 *  - cutout:   the same image with background pixels made transparent
 *    (suitable for compositing into virtual try-on / outfit shots).
 *
 * Both are returned so callers can persist whichever variants they need
 * without re-running the segmentation.
 */
export async function whitenBackground(
  input: Buffer,
  opts: { threshold?: number } = {},
): Promise<{ flattened: Buffer; cutout: Buffer }> {
  const NEAR_WHITE = opts.threshold ?? 232;

  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  if (channels !== 4) {
    throw new Error(`Expected 4 channels after ensureAlpha, got ${channels}`);
  }

  const total = width * height;
  // 0 = unvisited / foreground, 1 = background
  const isBg = new Uint8Array(total);
  const nearWhite = (px: number) => {
    const i = px * 4;
    return data[i] >= NEAR_WHITE && data[i + 1] >= NEAR_WHITE && data[i + 2] >= NEAR_WHITE;
  };

  // BFS seeded from every edge pixel that's near-white. A typed-array stack is
  // significantly faster than a JS array for ~1M pixels.
  const stack = new Int32Array(total);
  let top = 0;
  const push = (px: number) => {
    if (isBg[px]) return;
    if (!nearWhite(px)) return;
    isBg[px] = 1;
    stack[top++] = px;
  };
  for (let x = 0; x < width; x++) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    push(y * width);
    push(y * width + (width - 1));
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

  // Build flattened (RGB only, bg → 255,255,255) and cutout (RGBA, bg → α=0).
  const flatRgb = Buffer.allocUnsafe(total * 3);
  const cutRgba = Buffer.allocUnsafe(total * 4);
  for (let p = 0; p < total; p++) {
    const di = p * 4;
    const r = data[di],
      g = data[di + 1],
      b = data[di + 2];
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
      flatRgb[fi] = r;
      flatRgb[fi + 1] = g;
      flatRgb[fi + 2] = b;
      cutRgba[di] = r;
      cutRgba[di + 1] = g;
      cutRgba[di + 2] = b;
      cutRgba[di + 3] = data[di + 3];
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
