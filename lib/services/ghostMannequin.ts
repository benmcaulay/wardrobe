import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { fal } from "@fal-ai/client";
import { UPLOADS_ROOT, resolveUploadPath } from "../uploads";

// Real provider: fal.ai Gemini 2.5 Flash Image (edit). Takes a primary garment
// image plus optional context references and returns a single composite, all
// in one request. ~3-5s wall time, ~$0.04 per call.
//
// Alternative endpoints (drop-in via FAL_GHOST_MODEL env var):
// - "fal-ai/flux-pro/kontext"           — Flux Kontext, similar pricing
// - "fal-ai/flux-pro/kontext/max/multi" — Flux Kontext Max (4 refs, $$$)
// - "fal-ai/seedream/v4/edit"           — ByteDance SeedDream
// - "fal-ai/idm-vton" / "fal-ai/ootd"   — true VTON (need a person ref)

export { mapCategoryToGhost, type GhostMannequinCategory } from "./ghost-mannequin-shared";
import type { GhostMannequinCategory } from "./ghost-mannequin-shared";

export type GhostMannequinInput = {
  userId: string;
  /** DB-relative path to the garment image (cutout strongly preferred). */
  garmentImagePath: string;
  /** Additional reference shots for accuracy. The real provider passes them as
   *  extra image_urls; the stub uses them only for filename hashing. */
  extraImagePaths?: string[];
  category: GhostMannequinCategory;
};

export type GhostMannequinResult = {
  /** DB-relative path to the generated ghost-mannequin image. */
  resultImagePath: string;
  /** Credits spent (1 = ~$0.04 with the real provider). */
  credits: number;
};

const BASE_WIDTH = 1024;
const BASE_HEIGHT = 1366; // 3:4 portrait

const CATEGORY_LABEL: Record<GhostMannequinCategory, string> = {
  upperbody: "TOP",
  lowerbody: "BOTTOM",
  dress: "DRESS",
  full: "FULL LOOK",
};

const FAL_GHOST_MODEL = process.env.FAL_GHOST_MODEL ?? "fal-ai/gemini-25-flash-image/edit";
const REAL_MODE = process.env.USE_REAL_GHOST_MANNEQUIN === "true";

let falConfigured = false;
function ensureFalConfigured() {
  if (falConfigured) return;
  const key = process.env.FAL_KEY;
  if (!key) {
    throw new Error(
      "USE_REAL_GHOST_MANNEQUIN is true but FAL_KEY is not set. Add it to .env.",
    );
  }
  fal.config({ credentials: key });
  falConfigured = true;
}

function deterministicHash(input: GhostMannequinInput): string {
  const sortedExtras = [...(input.extraImagePaths ?? [])].sort();
  return crypto
    .createHash("sha256")
    .update([input.garmentImagePath, input.category, ...sortedExtras, REAL_MODE ? "real" : "stub"].join("|"))
    .digest("hex")
    .slice(0, 12);
}

/**
 * Top-level entry point. Routes to the real fal.ai call when
 * USE_REAL_GHOST_MANNEQUIN === "true", otherwise the stub. Both honour the
 * same input/output contract — the only difference is the resulting image.
 */
export async function createGhostMannequin(
  input: GhostMannequinInput,
): Promise<GhostMannequinResult> {
  if (REAL_MODE) return realGhostMannequin(input);
  return stubGhostMannequin(input);
}

// -----------------------------------------------------------------------------
// Real implementation
// -----------------------------------------------------------------------------

const PROMPT = (category: GhostMannequinCategory) => {
  const label = {
    upperbody: "top garment (shirt, sweater, jacket, or other upper-body piece)",
    lowerbody: "bottom garment (pants, shorts, skirt, or other lower-body piece)",
    dress: "dress",
    full: "full outfit",
  }[category];
  return `Generate a clean ghost-mannequin product photograph of this ${label}.

Requirements:
- Pure white seamless studio background (#ffffff).
- Garment shown in a 3D form as if worn by an invisible mannequin: sleeves filled out, shoulders shaped, collar / neckline natural, garment hanging with realistic drape and silhouette.
- Front-facing centred composition, the entire garment visible with comfortable margin around it.
- Soft even studio lighting, no harsh cast shadows.
- E-commerce catalog quality.
- Preserve the garment's exact colour, fabric texture, prints, logos, and proportions.
- Do not show any person, mannequin, hands, hangers, props, or text.`;
};

async function uploadToFal(absolutePath: string, fallbackName: string): Promise<string> {
  const buf = await fs.readFile(absolutePath);
  const ext = path.extname(absolutePath).toLowerCase();
  const mime =
    ext === ".png"
      ? "image/png"
      : ext === ".webp"
        ? "image/webp"
        : "image/jpeg";
  const file = new File([new Uint8Array(buf)], path.basename(absolutePath) || fallbackName, {
    type: mime,
  });
  return fal.storage.upload(file);
}

async function realGhostMannequin(input: GhostMannequinInput): Promise<GhostMannequinResult> {
  ensureFalConfigured();

  const garmentAbs = resolveUploadPath(input.garmentImagePath);
  if (!garmentAbs) throw new Error(`Invalid garment path: ${input.garmentImagePath}`);
  await fs.access(garmentAbs);

  // Resolve and upload all inputs to fal.ai storage so the model can fetch them.
  const garmentUrl = await uploadToFal(garmentAbs, "garment.jpg");
  const extraUrls: string[] = [];
  for (const rel of input.extraImagePaths ?? []) {
    const abs = resolveUploadPath(rel);
    if (!abs) continue;
    try {
      await fs.access(abs);
      extraUrls.push(await uploadToFal(abs, "context.jpg"));
    } catch {
      // skip missing/unreadable extras silently — they're optional
    }
  }

  const startedAt = Date.now();
  let resultUrl: string;
  try {
    const response = await fal.subscribe(FAL_GHOST_MODEL, {
      input: {
        prompt: PROMPT(input.category),
        image_urls: [garmentUrl, ...extraUrls],
        num_images: 1,
      },
      logs: false,
    });
    // Different fal models put the image at slightly different shapes; cover
    // the two common ones (data.images[0].url and data.image.url).
    const data = response?.data as
      | { images?: Array<{ url?: string }>; image?: { url?: string } }
      | undefined;
    resultUrl = data?.images?.[0]?.url ?? data?.image?.url ?? "";
    if (!resultUrl) {
      throw new Error("fal.ai returned no image url");
    }
  } catch (err) {
    const ms = Date.now() - startedAt;
    console.error(`[ghost-mannequin] fal call failed after ${ms}ms (model=${FAL_GHOST_MODEL}):`, (err as Error).message);
    throw new Error(`Ghost-mannequin generation failed: ${(err as Error).message}`);
  }
  const elapsedMs = Date.now() - startedAt;
  console.log(`[ghost-mannequin] fal ${FAL_GHOST_MODEL} ok in ${elapsedMs}ms (refs=${1 + extraUrls.length})`);

  // Download the result and normalise to a 1024x1366 JPEG with a thumbnail.
  const fetched = await fetch(resultUrl);
  if (!fetched.ok) throw new Error(`Failed to download result: ${fetched.status}`);
  const buffer = Buffer.from(await fetched.arrayBuffer());

  const dir = path.join(UPLOADS_ROOT, input.userId);
  await fs.mkdir(dir, { recursive: true });
  const hash = deterministicHash(input);
  const filename = `ghost-${hash}.jpg`;
  const thumbName = `ghost-${hash}-thumb.jpg`;
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
// Stub implementation (kept so devs without a fal key can still run the app)
// -----------------------------------------------------------------------------

async function stubGhostMannequin(input: GhostMannequinInput): Promise<GhostMannequinResult> {
  const garmentAbs = resolveUploadPath(input.garmentImagePath);
  if (!garmentAbs) throw new Error(`Invalid garment path: ${input.garmentImagePath}`);
  await fs.access(garmentAbs);

  const dir = path.join(UPLOADS_ROOT, input.userId);
  await fs.mkdir(dir, { recursive: true });

  const hash = deterministicHash(input);
  const filename = `ghost-${hash}.jpg`;
  const thumbName = `ghost-${hash}-thumb.jpg`;
  const outAbs = path.join(dir, filename);
  const thumbAbs = path.join(dir, thumbName);

  const garmentSize = Math.round(BASE_HEIGHT * 0.72);
  const garmentBuf = await sharp(garmentAbs)
    .rotate()
    .resize({ width: garmentSize, height: garmentSize, fit: "inside" })
    .toBuffer();
  const garmentMeta = await sharp(garmentBuf).metadata();
  const garmentWidth = garmentMeta.width ?? garmentSize;
  const garmentHeight = garmentMeta.height ?? garmentSize;

  const bannerHeight = Math.round(BASE_WIDTH * 0.07);
  const bannerFont = Math.round(bannerHeight * 0.5);
  const banner = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${BASE_WIDTH}" height="${bannerHeight}">
      <rect width="100%" height="100%" fill="rgba(26,22,19,0.82)"/>
      <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central"
            font-family="Georgia, serif" font-size="${bannerFont}" letter-spacing="3"
            fill="#faf8f5">GHOST MANNEQUIN PREVIEW · ${CATEGORY_LABEL[input.category]}</text>
    </svg>`,
  );

  const composedBuffer = await sharp({
    create: { width: BASE_WIDTH, height: BASE_HEIGHT, channels: 3, background: "#f3ede4" },
  })
    .composite([
      {
        input: garmentBuf,
        top: Math.round((BASE_HEIGHT - garmentHeight) / 2),
        left: Math.round((BASE_WIDTH - garmentWidth) / 2),
      },
      { input: banner, top: 0, left: 0 },
    ])
    .jpeg({ quality: 86 })
    .toBuffer();
  await fs.writeFile(outAbs, composedBuffer);

  await sharp(composedBuffer)
    .resize({ width: 400, height: 400, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 78 })
    .toFile(thumbAbs);

  return {
    resultImagePath: path.posix.join(input.userId, filename),
    credits: 1,
  };
}
