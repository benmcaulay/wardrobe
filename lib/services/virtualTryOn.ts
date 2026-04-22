import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { UPLOADS_ROOT, resolveUploadPath } from "../uploads";

// TODO: replace with a real virtual try-on call (Kling AI VTON, Replicate
// IDM-VTON, fal.ai CatVTON, or Google Vertex Imagen Try-On).
// Replicate IDM-VTON: https://replicate.com/cuuupid/idm-vton
// fal.ai CatVTON: https://fal.ai/models/fal-ai/cat-vton
// Kling AI: https://klingai.com/dev-api

export type TryOnInput = {
  userId: string;
  personImagePath: string; // DB-relative (e.g. "userId/ref-abc.jpg")
  garmentImagePath: string; // DB-relative
};

export type TryOnResult = {
  /** DB-relative path to the generated preview image. */
  resultImagePath: string;
};

/**
 * Stub implementation: takes the garment image and stamps a "TRY-ON PREVIEW"
 * watermark at the top so the UI can render a clearly-fake placeholder while
 * we wait for a real provider. Deterministic filenames so re-running against
 * the same inputs overwrites the same file.
 *
 * A real provider would take both images and return a composite of the
 * person wearing the garment.
 */
export async function generateTryOn(input: TryOnInput): Promise<TryOnResult> {
  const garmentAbs = resolveUploadPath(input.garmentImagePath);
  if (!garmentAbs) throw new Error(`Invalid garment path: ${input.garmentImagePath}`);
  const personAbs = resolveUploadPath(input.personImagePath);
  if (!personAbs) throw new Error(`Invalid person path: ${input.personImagePath}`);

  // Make sure both files actually exist — a real provider would fail anyway.
  await fs.access(garmentAbs);
  await fs.access(personAbs);

  const dir = path.join(UPLOADS_ROOT, input.userId);
  await fs.mkdir(dir, { recursive: true });

  // Deterministic filename: same (person, garment) -> same output file.
  const hash = crypto
    .createHash("sha256")
    .update(`${input.personImagePath}|${input.garmentImagePath}`)
    .digest("hex")
    .slice(0, 12);
  const filename = `tryon-${hash}.jpg`;
  const outAbs = path.join(dir, filename);

  const base = sharp(garmentAbs).rotate();
  const meta = await base.metadata();
  const width = meta.width ?? 1024;
  const bannerHeight = Math.max(60, Math.round(width * 0.08));
  const fontSize = Math.round(bannerHeight * 0.55);

  const overlay = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${bannerHeight}">
      <rect width="100%" height="100%" fill="rgba(26,22,19,0.78)"/>
      <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central"
            font-family="Georgia, serif" font-size="${fontSize}" letter-spacing="4"
            fill="#faf8f5">TRY-ON PREVIEW</text>
    </svg>`,
  );

  await sharp(garmentAbs)
    .rotate()
    .composite([{ input: overlay, gravity: "north" }])
    .jpeg({ quality: 86 })
    .toFile(outAbs);

  return {
    resultImagePath: path.posix.join(input.userId, filename),
  };
}
