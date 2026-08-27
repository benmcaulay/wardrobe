import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { log } from "../log";
import { boolEnv, strEnv } from "../env";
import { costTenthCentsForModel } from "../ai-costs";
import { getObject, objectExists, putObject, contentTypeFor } from "../storage";
import { geminiEditImage } from "./ghost-provider-gemini";

const BASE_WIDTH_THUMB = 400;

/** Standard try-on output: a 1024×1366 JPEG + 400px thumbnail, written to storage. */
async function writeStandardTryOn(userId: string, hash: string, buffer: Buffer): Promise<string> {
  const key = path.posix.join(userId, `tryon-${hash}.jpg`);
  const thumbKey = path.posix.join(userId, `tryon-${hash}-thumb.jpg`);
  const [full, thumb] = await Promise.all([
    sharp(buffer)
      .rotate()
      .resize({ width: BASE_WIDTH, height: BASE_HEIGHT, fit: "inside", withoutEnlargement: false })
      .jpeg({ quality: 88 })
      .toBuffer(),
    sharp(buffer)
      .rotate()
      .resize({ width: BASE_WIDTH_THUMB, height: BASE_WIDTH_THUMB, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer(),
  ]);
  await Promise.all([
    putObject(key, full, "image/jpeg"),
    putObject(thumbKey, thumb, "image/jpeg"),
  ]);
  return key;
}

// One real provider: gemini image edit (GEMINI_API_KEY), costing 1 app credit
// per generation. Stub mode composites the person photo with a watermark and
// garment thumbnails.
//
// This used to route to Fashn (dedicated try-on) or fal idm-vton. Both are gone,
// and it is worth being honest about the trade: idm-vton was a purpose-built
// person try-on model that preserved identity and pose and mapped each garment
// to the right body region. A general image editor is weaker at all three, so
// expect softer likeness on faces and occasional garment/body mismatches.
const REAL_MODE = boolEnv("USE_REAL_VIRTUAL_TRYON");
const BASE_WIDTH = 1024;
const BASE_HEIGHT = 1366;

/** Gemini try-on is billed to app credits, unlike the old Fashn plan billing. */
export function virtualTryOnUsesAppCredits(): boolean {
  return REAL_MODE;
}

function tryOnProvider(): "stub" | "gemini" {
  return REAL_MODE ? "gemini" : "stub";
}

export type VirtualTryOnInput = {
  userId: string;
  /** DB-relative path to the person reference photo. */
  personImagePath: string;
  /** DB-relative paths of garment images (cutouts / ghosts preferred). */
  garmentImagePaths: string[];
  /** Same order as garmentImagePaths; hints Fashn tryon-v1.6 category (hats/accessories → try tryon-max). */
  garmentCategories?: string[];
  /** Same order as garmentImagePaths; richer per-garment text (name/subcategory) used as the
   *  `description` for text-driven VTON models like idm-vton. Falls back to garmentCategories. */
  garmentDescriptions?: string[];
  /** Optional human description (e.g. "outfit for a coffee date"). */
  prompt?: string;
};

export type VirtualTryOnResult = {
  resultImagePath: string;
  credits: number;
  /** Model that produced the image, for cost reporting. Null in stub mode. */
  model: string | null;
  /** List-price cost in tenths of a cent. 0 in stub mode. */
  costTenthCents: number;
};

/** Image model used for try-on, shared with the ghost path's default. */
function tryOnModel(): string {
  return strEnv("GEMINI_IMAGE_MODEL", "gemini-3.1-flash-image");
}

function deterministicHash(input: VirtualTryOnInput): string {
  const sortedGarments = [...input.garmentImagePaths].sort();
  return crypto
    .createHash("sha256")
    .update(
      [
        input.personImagePath,
        input.prompt ?? "",
        ...sortedGarments,
        tryOnProvider(),
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 12);
}

export async function createVirtualTryOn(
  input: VirtualTryOnInput,
): Promise<VirtualTryOnResult> {
  if (input.garmentImagePaths.length === 0) {
    throw new Error("At least one garment image is required");
  }
  if (REAL_MODE) return geminiRealVirtualTryOn(input);
  return stubVirtualTryOn(input);
}

// -----------------------------------------------------------------------------
// Gemini implementation
// -----------------------------------------------------------------------------

type TryOnGarment = { key: string; category?: string; description?: string };

/** Per-garment text for the prompt: prefer the rich description, fall back to category. */
export function vtonDescription(g: { description?: string; category?: string }): string {
  const d = (g.description ?? g.category ?? "").trim();
  return d.length > 0 ? d : "a clothing garment";
}

/**
 * The editor has no try-on contract, so the whole task lives in the prompt: the
 * first image is the person and must be preserved, the rest are garments to put
 * on them. Identity preservation is stated first because that is what a general
 * editor gets wrong — it will happily return a different, better-looking person
 * wearing the clothes.
 */
export function buildTryOnPrompt(garments: TryOnGarment[], extraPrompt?: string): string {
  const list = garments
    .map((g, i) => `${i + 2}. ${vtonDescription(g)}`)
    .join("\n");
  const extra = extraPrompt?.trim();
  return `Virtual try-on. Dress the person from image 1 in the garments from the following images.

Image 1 is the PERSON. Images 2+ are GARMENTS:
${list}

Keep the person exactly as they are:
- Same face, hair, skin tone, body proportions, and pose. This is the same individual, not a similar-looking model.
- Same camera framing and background as image 1.

Fit each garment realistically:
- Correct body region for the garment type, at a natural scale, following the body's pose.
- Preserve each garment's true colour, pattern, print, logo placement, and fabric.
- Replace any existing clothing the new garment covers; do not layer it on top of what they were already wearing.
- Natural fabric drape and contact shadows where the garment meets the body.

No text, watermarks, labels, or collage panels. Return a single photograph.${
    extra ? `\n\nAdditional direction:\n${extra}` : ""
  }`;
}

async function geminiRealVirtualTryOn(input: VirtualTryOnInput): Promise<VirtualTryOnResult> {
  const personBuf = await getObject(input.personImagePath);
  if (!personBuf) throw new Error(`Invalid person path: ${input.personImagePath}`);

  // Keep each garment paired with its category + description; missing files are
  // dropped here so downstream indices stay aligned.
  const garments: TryOnGarment[] = [];
  const buffers: Array<{ buffer: Buffer; mime: string }> = [
    { buffer: personBuf, mime: contentTypeFor(input.personImagePath) },
  ];
  for (let i = 0; i < input.garmentImagePaths.length; i++) {
    const rel = input.garmentImagePaths[i];
    const buf = await getObject(rel);
    if (!buf) continue;
    garments.push({
      key: rel,
      category: input.garmentCategories?.[i],
      description: input.garmentDescriptions?.[i],
    });
    buffers.push({ buffer: buf, mime: contentTypeFor(rel) });
  }
  if (garments.length === 0) throw new Error("None of the garment images could be read");

  const startedAt = Date.now();
  let result: Buffer;
  try {
    result = await geminiEditImage(buildTryOnPrompt(garments, input.prompt), buffers);
  } catch (err) {
    log.error("tryon.gemini.failed", err, {
      garments: garments.length,
      ms: Date.now() - startedAt,
    });
    throw new Error(`Virtual try-on generation failed: ${(err as Error).message}`);
  }
  log.info("tryon.gemini.ok", { garments: garments.length, ms: Date.now() - startedAt });

  const key = await writeStandardTryOn(input.userId, deterministicHash(input), result);
  const model = tryOnModel();
  return {
    resultImagePath: key,
    credits: 1,
    model,
    costTenthCents: costTenthCentsForModel(model),
  };
}

// -----------------------------------------------------------------------------
// Stub implementation
// -----------------------------------------------------------------------------

async function stubVirtualTryOn(input: VirtualTryOnInput): Promise<VirtualTryOnResult> {
  const personSrc = await getObject(input.personImagePath);
  if (!personSrc) throw new Error(`Invalid person path: ${input.personImagePath}`);

  const hash = deterministicHash(input);
  const key = path.posix.join(input.userId, `tryon-${hash}.jpg`);
  const thumbKey = path.posix.join(input.userId, `tryon-${hash}-thumb.jpg`);

  // Resize person to fill the canvas.
  const personBuf = await sharp(personSrc)
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
    const src = await getObject(rel);
    if (!src) continue;
    const garmentTile = await sharp(src)
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
  const thumb = await sharp(composed)
    .resize({ width: 400, height: 400, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 78 })
    .toBuffer();
  await Promise.all([
    putObject(key, composed, "image/jpeg"),
    putObject(thumbKey, thumb, "image/jpeg"),
  ]);

  return { resultImagePath: key, credits: 1, model: null, costTenthCents: 0 };
}
