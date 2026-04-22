import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { UPLOADS_ROOT, resolveUploadPath } from "../uploads";

// TODO: replace with a real virtual try-on / image-gen call. All of these
// accept one person reference + one or more garment references in a single
// request and return a composite image:
// - Replicate IDM-VTON: https://replicate.com/cuuupid/idm-vton
// - fal.ai CatVTON: https://fal.ai/models/fal-ai/cat-vton
// - Kling AI: https://klingai.com/dev-api
// - Gemini 2.5 Flash Image: https://ai.google.dev/gemini-api/docs/image-generation
// - OpenAI image edits (reference images): https://platform.openai.com/docs/guides/images

export type TryOnInput = {
  userId: string;
  /** DB-relative path to the person reference photo. */
  personImagePath: string;
  /** DB-relative paths for the garments in the outfit. Must be ≥ 1. */
  garmentImagePaths: string[];
};

export type TryOnResult = {
  /** DB-relative path to the generated preview image. */
  resultImagePath: string;
};

const BASE_WIDTH = 1024;
const BASE_HEIGHT = 1366; // 3:4 portrait

/**
 * Stub implementation: renders the reference photo as the base, overlays a
 * row of the garment thumbnails along the bottom, and stamps a "TRY-ON
 * PREVIEW" banner at the top. Deterministic filename so regenerating with
 * the same inputs overwrites the same file.
 *
 * A real provider would take the same inputs and return an actual composite
 * of the person wearing the full outfit.
 */
export async function generateTryOn(input: TryOnInput): Promise<TryOnResult> {
  if (!input.garmentImagePaths.length) throw new Error("At least one garment is required");

  const personAbs = resolveUploadPath(input.personImagePath);
  if (!personAbs) throw new Error(`Invalid person path: ${input.personImagePath}`);
  await fs.access(personAbs);

  const garmentAbsPaths: string[] = [];
  for (const rel of input.garmentImagePaths) {
    const abs = resolveUploadPath(rel);
    if (!abs) throw new Error(`Invalid garment path: ${rel}`);
    await fs.access(abs);
    garmentAbsPaths.push(abs);
  }

  const dir = path.join(UPLOADS_ROOT, input.userId);
  await fs.mkdir(dir, { recursive: true });

  // Deterministic filename: sorted garments so order doesn't matter.
  const sortedGarments = [...input.garmentImagePaths].sort();
  const hash = crypto
    .createHash("sha256")
    .update([input.personImagePath, ...sortedGarments].join("|"))
    .digest("hex")
    .slice(0, 12);
  const filename = `tryon-${hash}.jpg`;
  const outAbs = path.join(dir, filename);

  const base = await sharp(personAbs)
    .rotate()
    .resize({ width: BASE_WIDTH, height: BASE_HEIGHT, fit: "cover", position: "top" })
    .toBuffer();

  // Top banner
  const bannerHeight = Math.round(BASE_WIDTH * 0.08);
  const bannerFont = Math.round(bannerHeight * 0.55);
  const bannerSvg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${BASE_WIDTH}" height="${bannerHeight}">
      <rect width="100%" height="100%" fill="rgba(26,22,19,0.78)"/>
      <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central"
            font-family="Georgia, serif" font-size="${bannerFont}" letter-spacing="4"
            fill="#faf8f5">TRY-ON PREVIEW</text>
    </svg>`,
  );

  // Bottom garment strip
  const stripHeight = Math.round(BASE_HEIGHT * 0.22);
  const stripY = BASE_HEIGHT - stripHeight;
  const stripBg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${BASE_WIDTH}" height="${stripHeight}">
      <rect width="100%" height="100%" fill="rgba(26,22,19,0.55)"/>
    </svg>`,
  );

  const pad = 16;
  const gap = 10;
  const count = garmentAbsPaths.length;
  // Fit thumbs into the strip — square, sized by the stricter of width/height budget.
  const maxThumbByHeight = stripHeight - pad * 2;
  const maxThumbByWidth = Math.floor((BASE_WIDTH - pad * 2 - gap * (count - 1)) / count);
  const thumbSize = Math.max(48, Math.min(maxThumbByHeight, maxThumbByWidth));
  const totalWidth = count * thumbSize + (count - 1) * gap;
  const stripStartX = Math.round((BASE_WIDTH - totalWidth) / 2);
  const thumbTop = stripY + Math.round((stripHeight - thumbSize) / 2);

  const thumbBuffers = await Promise.all(
    garmentAbsPaths.map((p) =>
      sharp(p).rotate().resize(thumbSize, thumbSize, { fit: "cover" }).jpeg({ quality: 85 }).toBuffer(),
    ),
  );

  const layers: sharp.OverlayOptions[] = [
    { input: bannerSvg, top: 0, left: 0 },
    { input: stripBg, top: stripY, left: 0 },
    ...thumbBuffers.map((buf, i) => ({
      input: buf,
      top: thumbTop,
      left: stripStartX + i * (thumbSize + gap),
    })),
  ];

  const composedBuffer = await sharp(base).composite(layers).jpeg({ quality: 86 }).toBuffer();
  await fs.writeFile(outAbs, composedBuffer);

  // Companion 400px thumbnail so the try-on history grid renders fast.
  const thumbName = `tryon-${hash}-thumb.jpg`;
  const thumbAbs = path.join(dir, thumbName);
  await sharp(composedBuffer)
    .resize({ width: 400, height: 400, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 78 })
    .toFile(thumbAbs);

  return {
    resultImagePath: path.posix.join(input.userId, filename),
  };
}
