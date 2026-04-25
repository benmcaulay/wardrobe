import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { UPLOADS_ROOT, resolveUploadPath } from "../uploads";

// TODO: replace with a real ghost-mannequin call. Recommended providers all
// take one garment image (ideally a transparent-background cutout) and return
// a composite onto a neutral 3D mannequin in a single request:
// - fal.ai OOTDiffusion: https://fal.ai/models/fal-ai/ootd
// - fal.ai IDM-VTON (with stored neutral mannequin refs): https://fal.ai/models/fal-ai/idm-vton
// - Replicate IDM-VTON: https://replicate.com/cuuupid/idm-vton
// Cost target: ~$0.02 / image = 1 credit.

export type GhostMannequinCategory = "upperbody" | "lowerbody" | "dress" | "full";

export type GhostMannequinInput = {
  userId: string;
  /** DB-relative path to the garment image (cutout strongly preferred). */
  garmentImagePath: string;
  category: GhostMannequinCategory;
};

export type GhostMannequinResult = {
  /** DB-relative path to the generated ghost-mannequin image. */
  resultImagePath: string;
  /** Credits spent (1 today; future tiers may charge more for higher quality). */
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

/**
 * Stub: takes the garment image, fits it onto a neutral paper background sized
 * for a ghost-mannequin frame, and stamps a "GHOST MANNEQUIN PREVIEW" banner.
 * Deterministic filename so regenerating with the same inputs is idempotent.
 *
 * A real provider replaces the body of this function; the input/output
 * contract stays exactly the same.
 */
export async function createGhostMannequin(
  input: GhostMannequinInput,
): Promise<GhostMannequinResult> {
  const garmentAbs = resolveUploadPath(input.garmentImagePath);
  if (!garmentAbs) throw new Error(`Invalid garment path: ${input.garmentImagePath}`);
  await fs.access(garmentAbs);

  const dir = path.join(UPLOADS_ROOT, input.userId);
  await fs.mkdir(dir, { recursive: true });

  const hash = crypto
    .createHash("sha256")
    .update(`${input.garmentImagePath}|${input.category}`)
    .digest("hex")
    .slice(0, 12);
  const filename = `ghost-${hash}.jpg`;
  const thumbName = `ghost-${hash}-thumb.jpg`;
  const outAbs = path.join(dir, filename);
  const thumbAbs = path.join(dir, thumbName);

  // Centred garment over a soft warm background — gives the stub a recognizable
  // "studio mannequin" feel that's clearly not a real composite.
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

  // Companion 400px thumbnail (matches the convention used by saveUpload).
  await sharp(composedBuffer)
    .resize({ width: 400, height: 400, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 78 })
    .toFile(thumbAbs);

  return {
    resultImagePath: path.posix.join(input.userId, filename),
    credits: 1,
  };
}

/** Map a wardrobe item category to the ghost-mannequin category enum. */
export function mapCategoryToGhost(category: string): GhostMannequinCategory {
  switch (category) {
    case "top":
    case "outerwear":
    case "accessory":
      return "upperbody";
    case "bottom":
    case "shoes":
      return "lowerbody";
    case "dress":
      return "dress";
    default:
      return "full";
  }
}
