import sharp from "sharp";

const DEFAULT_WIDTH = 1024;
const DEFAULT_HEIGHT = 1366;
/** Garment occupies at most this fraction of the shorter canvas dimension. */
const MAX_FILL = 0.78;
const MIN_ALPHA = 12;

export type CenterCatalogOptions = {
  width?: number;
  height?: number;
  maxFill?: number;
  background?: string;
};

/**
 * Re-compose a ghost/catalog image onto a pure-white canvas with the garment
 * centered and scaled consistently — fixes model drift on background color,
 * framing, and placement without another API call.
 */
export async function centerCatalogImage(
  cutout: Buffer,
  opts: CenterCatalogOptions = {},
): Promise<{ flattened: Buffer; cutout: Buffer }> {
  const width = opts.width ?? DEFAULT_WIDTH;
  const height = opts.height ?? DEFAULT_HEIGHT;
  const maxFill = opts.maxFill ?? MAX_FILL;
  const background = opts.background ?? "#ffffff";

  const { data, info } = await sharp(cutout)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const imgW = info.width;
  const imgH = info.height;
  let minX = imgW;
  let minY = imgH;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < imgH; y++) {
    for (let x = 0; x < imgW; x++) {
      const alpha = data[(y * imgW + x) * 4 + 3] ?? 0;
      if (alpha < MIN_ALPHA) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < minX || maxY < minY) {
    const flattened = await sharp(cutout)
      .resize({ width, height, fit: "inside", background })
      .flatten({ background })
      .jpeg({ quality: 88 })
      .toBuffer();
    return { flattened, cutout };
  }

  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;
  const cropped = await sharp(cutout)
    .extract({ left: minX, top: minY, width: cropW, height: cropH })
    .toBuffer();

  const targetMaxW = Math.round(width * maxFill);
  const targetMaxH = Math.round(height * maxFill);
  const scale = Math.min(targetMaxW / cropW, targetMaxH / cropH, 1);
  const outW = Math.max(1, Math.round(cropW * scale));
  const outH = Math.max(1, Math.round(cropH * scale));

  const resized = await sharp(cropped)
    .resize({ width: outW, height: outH, fit: "inside" })
    .ensureAlpha()
    .toBuffer();

  const left = Math.round((width - outW) / 2);
  const top = Math.round((height - outH) / 2);

  const composited = await sharp({
    create: { width, height, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  })
    .composite([{ input: resized, left, top }])
    .png()
    .toBuffer();

  const flattened = await sharp(composited).flatten({ background }).jpeg({ quality: 88 }).toBuffer();

  return { flattened, cutout: composited };
}
