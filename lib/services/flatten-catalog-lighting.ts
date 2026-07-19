import sharp from "sharp";

function numEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
}

/** Lift deep fabric shadows without washing out true blacks (0–255 luminance). */
const SHADOW_LIFT = numEnv("GHOST_SHADOW_LIFT", 18);
const SHADOW_FLOOR = numEnv("GHOST_SHADOW_FLOOR", 72);
const BLACK_PRESERVE = numEnv("GHOST_BLACK_PRESERVE", 28);

function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Compress harsh AI shadows on the garment so catalog tiles match the flat,
 * high-key look of professional ghost-mannequin photography.
 */
export async function softenCatalogShadows(
  flattened: Buffer,
  cutout: Buffer,
): Promise<Buffer> {
  if (SHADOW_LIFT <= 0) return flattened;

  const flat = await sharp(flattened).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const alpha = await sharp(cutout).ensureAlpha().extractChannel(3).raw().toBuffer();
  const { data, info } = flat;
  const { width, height } = info;
  const out = Buffer.from(data);

  for (let p = 0; p < width * height; p++) {
    if ((alpha[p] ?? 0) < 12) continue;
    const i = p * 3;
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const lum = luminance(r, g, b);
    if (lum <= BLACK_PRESERVE || lum >= SHADOW_FLOOR) continue;

    const t = (SHADOW_FLOOR - lum) / Math.max(1, SHADOW_FLOOR - BLACK_PRESERVE);
    const lift = SHADOW_LIFT * t;
    out[i] = Math.min(255, Math.round(r + lift));
    out[i + 1] = Math.min(255, Math.round(g + lift));
    out[i + 2] = Math.min(255, Math.round(b + lift));
  }

  return sharp(out, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 88 })
    .toBuffer();
}
