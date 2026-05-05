import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { fal } from "@fal-ai/client";
import { UPLOADS_ROOT, resolveUploadPath } from "../uploads";

// Real provider: fal.ai (default `fal-ai/gemini-25-flash-image/edit`).
// We pass the person photo as the first reference and each garment / outfit
// image as additional references, then prompt the model to redress the same
// person while keeping pose, face, body, and background unchanged.
//
// Stub mode (USE_REAL_VIRTUAL_TRYON !== "true") composites the person photo
// with a watermark + garment thumbnails so devs without a fal key can still
// exercise the full UI flow.

const FAL_VTON_MODEL =
  process.env.FAL_VTON_MODEL ?? process.env.FAL_GHOST_MODEL ?? "fal-ai/gemini-25-flash-image/edit";
const REAL_MODE = process.env.USE_REAL_VIRTUAL_TRYON === "true";
const BASE_WIDTH = 1024;
const BASE_HEIGHT = 1366;

let falConfigured = false;
function ensureFalConfigured() {
  if (falConfigured) return;
  const key = process.env.FAL_KEY;
  if (!key) {
    throw new Error(
      "USE_REAL_VIRTUAL_TRYON is true but FAL_KEY is not set. Add it to .env.",
    );
  }
  fal.config({ credentials: key });
  falConfigured = true;
}

export type VirtualTryOnInput = {
  userId: string;
  /** DB-relative path to the person reference photo. */
  personImagePath: string;
  /** DB-relative paths of garment images (cutouts / ghosts preferred). */
  garmentImagePaths: string[];
  /** Optional human description (e.g. "outfit for a coffee date"). */
  prompt?: string;
};

export type VirtualTryOnResult = {
  resultImagePath: string;
  credits: number;
};

function deterministicHash(input: VirtualTryOnInput): string {
  const sortedGarments = [...input.garmentImagePaths].sort();
  return crypto
    .createHash("sha256")
    .update(
      [
        input.personImagePath,
        input.prompt ?? "",
        ...sortedGarments,
        REAL_MODE ? "real" : "stub",
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 12);
}

const PROMPT = (extraPrompt?: string) => {
  const base = `Generate a photorealistic image of the SAME person from the first reference photo wearing the clothing items shown in the additional reference photos.

Strict requirements:
- Preserve the person's identity exactly: face, hair, skin tone, body proportions, and pose must be unchanged from the first reference.
- Preserve the original background, lighting, and camera framing of the first reference photo.
- Replace ONLY the visible clothing with the new garments. Combine the new pieces into a single coherent outfit if multiple garments are provided.
- Match the garments' colors, fabric textures, prints, logos, fit, and proportions exactly as shown in the reference photos.
- Realistic drape and natural shadows; the new clothing should look like it is actually being worn, not pasted in.
- Do not add text, watermarks, hangers, mannequins, or extra people.`;
  return extraPrompt && extraPrompt.trim().length > 0
    ? `${base}\n\nAdditional direction from the user: ${extraPrompt.trim()}`
    : base;
};

async function uploadToFal(absolutePath: string, fallbackName: string): Promise<string> {
  const buf = await fs.readFile(absolutePath);
  const ext = path.extname(absolutePath).toLowerCase();
  const mime =
    ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
  const file = new File([new Uint8Array(buf)], path.basename(absolutePath) || fallbackName, {
    type: mime,
  });
  return fal.storage.upload(file);
}

export async function createVirtualTryOn(
  input: VirtualTryOnInput,
): Promise<VirtualTryOnResult> {
  if (input.garmentImagePaths.length === 0) {
    throw new Error("At least one garment image is required");
  }
  if (REAL_MODE) return realVirtualTryOn(input);
  return stubVirtualTryOn(input);
}

// -----------------------------------------------------------------------------
// Real implementation
// -----------------------------------------------------------------------------

async function realVirtualTryOn(input: VirtualTryOnInput): Promise<VirtualTryOnResult> {
  ensureFalConfigured();

  const personAbs = resolveUploadPath(input.personImagePath);
  if (!personAbs) throw new Error(`Invalid person path: ${input.personImagePath}`);
  await fs.access(personAbs);

  const garmentAbsList: string[] = [];
  for (const rel of input.garmentImagePaths) {
    const abs = resolveUploadPath(rel);
    if (!abs) continue;
    try {
      await fs.access(abs);
      garmentAbsList.push(abs);
    } catch {
      // skip missing garments silently
    }
  }
  if (garmentAbsList.length === 0) {
    throw new Error("None of the garment images could be read");
  }

  const personUrl = await uploadToFal(personAbs, "person.jpg");
  const garmentUrls: string[] = [];
  for (const abs of garmentAbsList) {
    garmentUrls.push(await uploadToFal(abs, "garment.jpg"));
  }

  const startedAt = Date.now();
  let resultUrl: string;
  try {
    const response = await fal.subscribe(FAL_VTON_MODEL, {
      input: {
        prompt: PROMPT(input.prompt),
        image_urls: [personUrl, ...garmentUrls],
        num_images: 1,
      },
      logs: false,
    });
    const data = response?.data as
      | { images?: Array<{ url?: string }>; image?: { url?: string } }
      | undefined;
    resultUrl = data?.images?.[0]?.url ?? data?.image?.url ?? "";
    if (!resultUrl) throw new Error("fal.ai returned no image url");
  } catch (err) {
    const ms = Date.now() - startedAt;
    console.error(
      `[virtual-tryon] fal call failed after ${ms}ms (model=${FAL_VTON_MODEL}):`,
      (err as Error).message,
    );
    throw new Error(`Virtual try-on generation failed: ${(err as Error).message}`);
  }
  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[virtual-tryon] fal ${FAL_VTON_MODEL} ok in ${elapsedMs}ms (garments=${garmentUrls.length})`,
  );

  const fetched = await fetch(resultUrl);
  if (!fetched.ok) throw new Error(`Failed to download result: ${fetched.status}`);
  const buffer = Buffer.from(await fetched.arrayBuffer());

  const dir = path.join(UPLOADS_ROOT, input.userId);
  await fs.mkdir(dir, { recursive: true });
  const hash = deterministicHash(input);
  const filename = `tryon-${hash}.jpg`;
  const thumbName = `tryon-${hash}-thumb.jpg`;
  const outAbs = path.join(dir, filename);
  const thumbAbs = path.join(dir, thumbName);

  await sharp(buffer)
    .rotate()
    .resize({ width: BASE_WIDTH, height: BASE_HEIGHT, fit: "inside", withoutEnlargement: false })
    .jpeg({ quality: 88 })
    .toFile(outAbs);
  await sharp(buffer)
    .rotate()
    .resize({ width: 400, height: 400, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toFile(thumbAbs);

  return {
    resultImagePath: path.posix.join(input.userId, filename),
    credits: 1,
  };
}

// -----------------------------------------------------------------------------
// Stub implementation
// -----------------------------------------------------------------------------

async function stubVirtualTryOn(input: VirtualTryOnInput): Promise<VirtualTryOnResult> {
  const personAbs = resolveUploadPath(input.personImagePath);
  if (!personAbs) throw new Error(`Invalid person path: ${input.personImagePath}`);
  await fs.access(personAbs);

  const dir = path.join(UPLOADS_ROOT, input.userId);
  await fs.mkdir(dir, { recursive: true });
  const hash = deterministicHash(input);
  const filename = `tryon-${hash}.jpg`;
  const thumbName = `tryon-${hash}-thumb.jpg`;
  const outAbs = path.join(dir, filename);
  const thumbAbs = path.join(dir, thumbName);

  // Resize person to fill the canvas.
  const personBuf = await sharp(personAbs)
    .rotate()
    .resize({ width: BASE_WIDTH, height: BASE_HEIGHT, fit: "cover" })
    .toBuffer();

  // Compose small garment thumbnails along the bottom strip.
  const overlays: sharp.OverlayOptions[] = [];
  const stripHeight = 240;
  const stripPad = 16;
  const slotSize = stripHeight - stripPad * 2;
  const garmentPaths = input.garmentImagePaths.slice(0, 4);
  let cursorX = stripPad;
  for (const rel of garmentPaths) {
    const abs = resolveUploadPath(rel);
    if (!abs) continue;
    try {
      await fs.access(abs);
      const garmentTile = await sharp(abs)
        .rotate()
        .resize({ width: slotSize, height: slotSize, fit: "cover" })
        .jpeg({ quality: 80 })
        .toBuffer();
      overlays.push({
        input: garmentTile,
        top: BASE_HEIGHT - stripHeight + stripPad,
        left: cursorX,
      });
      cursorX += slotSize + stripPad;
    } catch {
      // skip
    }
  }

  const stripBg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${BASE_WIDTH}" height="${stripHeight}">
      <rect width="100%" height="100%" fill="rgba(26,22,19,0.78)"/>
      <text x="${cursorX + 8}" y="40" font-family="Georgia, serif" font-size="22"
            letter-spacing="2" fill="#faf8f5">VIRTUAL TRY-ON PREVIEW</text>
      <text x="${cursorX + 8}" y="72" font-family="Inter, sans-serif" font-size="14"
            fill="#d8d3cc">Stub mode — set USE_REAL_VIRTUAL_TRYON to "true" for real generation</text>
    </svg>`,
  );
  overlays.unshift({ input: stripBg, top: BASE_HEIGHT - stripHeight, left: 0 });

  const composed = await sharp(personBuf).composite(overlays).jpeg({ quality: 88 }).toBuffer();
  await fs.writeFile(outAbs, composed);
  await sharp(composed)
    .resize({ width: 400, height: 400, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 78 })
    .toFile(thumbAbs);

  return {
    resultImagePath: path.posix.join(input.userId, filename),
    credits: 1,
  };
}
