import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { fal } from "@fal-ai/client";
import { log } from "../log";
import { getObject, objectExists, putObject, contentTypeFor } from "../storage";
import { whitenBackground } from "./whiten-background";
import { centerCatalogImage } from "./center-catalog-image";
import { softenCatalogShadows } from "./flatten-catalog-lighting";
import { removeNeckPost } from "./remove-neck-post";
import { fetchFalResultBuffer } from "./fal-result-fetch";

// Real provider: fal.ai image-edit model (default: SeedDream v4 Edit). Takes a
// primary garment image plus optional context references and returns a single
// composite, all in one request. ~3-5s wall time, ~$0.03-0.04 per call.
//
// Alternative endpoints (drop-in via FAL_GHOST_MODEL env var):
// - "fal-ai/gemini-25-flash-image/edit" — Gemini, weaker angle adherence
// - "fal-ai/flux-pro/kontext"           — Flux Kontext, similar pricing
// - "fal-ai/flux-pro/kontext/max/multi" — Flux Kontext Max (4 refs, $$$)
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
  /** Optional per-view instruction from UI (composition, angle, detail emphasis). */
  instructions?: string;
  /** When `rear`, apparel prompts describe a back-facing catalog shot (not front-centred). */
  compositionHint?: "default" | "rear";
};

export type GhostMannequinResult = {
  /** DB-relative path to the generated ghost-mannequin image. */
  resultImagePath: string;
  /** Credits spent (1 = ~$0.04 with the real provider). */
  credits: number;
};

const BASE_WIDTH = 1024;
const BASE_HEIGHT = 1366; // 3:4 portrait
/** Bump when prompt/post-process changes so new runs don't reuse stale cache keys. */
const PROMPT_VERSION = "2026-04-six-tenets";
const NECK_REPAIR_ENABLED = process.env.GHOST_NECK_FAL_REPAIR !== "false";

/** Repair pass — never say "mannequin"; that word triggers plastic neck inserts. */
const NECK_REPAIR_PROMPT = `Edit this e-commerce garment photo: remove any white plastic neck tube, head, bust, stump, or filler inside the collar or hood opening.
Through the neck opening, show the garment's own back lining / interior fabric only.
Keep the garment color, shape, logos, and pure white (#ffffff) background exactly unchanged. No shadows.`;

const CATEGORY_LABEL: Record<GhostMannequinCategory, string> = {
  upperbody: "TOP",
  lowerbody: "BOTTOM",
  footwear: "FOOTWEAR",
  dress: "DRESS",
  /** Fallback mapping — not “full outfit”; avoid misleading dev stub label. */
  full: "GENERAL",
};

// Default to Seedream v4 edit: top-tier prompt adherence (it actually obeys the
// camera-angle requirements below, where the gemini editor tended to ignore
// them) at the same ~$0.04/call. Override with FAL_GHOST_MODEL to switch.
const FAL_GHOST_MODEL = process.env.FAL_GHOST_MODEL ?? "fal-ai/bytedance/seedream/v4/edit";
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
    .update(
      [
        input.garmentImagePath,
        input.category,
        input.instructions?.trim() ?? "",
        input.compositionHint ?? "default",
        PROMPT_VERSION,
        ...sortedExtras,
        REAL_MODE ? "real" : "stub",
      ].join("|"),
    )
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
// Real implementation — fal prompt (six tenets; never say "mannequin")
// -----------------------------------------------------------------------------

const TENET_LINING = `1) Neck / collar / hood opening — visible back lining:
- Through the neckline, collar, or hood opening, show the garment's own interior fabric and back lining only.
- No white plastic tube, neck stump, bust, head, foam insert, or filler of any kind inside the opening.
- No person, skin, face, or body parts.`;

const TENET_VOLUME = `2) Fully inflated:
- Garment is fully inflated to retail product-photo volume — filled sleeves, shaped shoulders, natural body volume.
- Not flat, deflated, collapsed, crumpled, or empty-looking.
- Smooth fabric; do not invent harsh wrinkles. Preserve exact colors, prints, logos, and texture from the reference.`;

const TENET_ARMS = `3) Arms straight (tops / dresses with sleeves):
- Shoulders level and square. Sleeves hang straight down at the sides.
- Do not bend arms inward, cross sleeves, or pinch elbows toward the center.`;

const TENET_BG = `4) Pure white background only:
- Seamless #ffffff filling the entire frame edge-to-edge.
- No gray, cream, gradient, floor line, or vignette.`;

const TENET_SHADOWS = `5) No shadows:
- No cast shadow under the garment, no contact shadow, no side shadow, no rim light, no vignette on fabric.
- Flat, even, shadowless lighting across the whole piece.`;

const TENET_CAMERA = `6) Straight-on camera only:
- Garment facing the lens head-on (0° yaw), centered, symmetric, fully in frame.
- Not three-quarter, not angled, not tilted.`;

const TENET_CAMERA_REAR = `6) Straight-on camera — back view:
- Show the back of the garment head-on (0° yaw), centered, symmetric, fully in frame.
- Not three-quarter, not angled, not tilted.`;

const LOWERBODY_POSE = `Bottoms (pants, shorts, skirts):
- Waistband level; legs fully inflated and straight — not pinched, twisted, or crumpled.`;

const SINGLE_ITEM = `Single item only from the reference. No extra clothes, props, hangers, stands, poles, or text.`;

const FOOTWEAR_ANGLE =
  "Camera: both shoes as a matched pair, angled ~45° to the viewer's left, same height and orientation — not toe-on, not heel-to-heel V, not splayed apart.";

function apparelLabel(category: Exclude<GhostMannequinCategory, "footwear">): string {
  return {
    upperbody: "top garment (shirt, sweater, jacket, hoodie, or upper-body piece)",
    lowerbody: "bottom garment (pants, shorts, skirt — not shoes)",
    dress: "dress",
    full: "single garment or accessory exactly as shown (hat, bag, scarf, etc.)",
  }[category];
}

function baseApparelPrompt(
  category: Exclude<GhostMannequinCategory, "footwear">,
  compositionHint: "default" | "rear",
): string {
  const camera = compositionHint === "rear" ? TENET_CAMERA_REAR : TENET_CAMERA;
  const arms =
    category === "lowerbody"
      ? LOWERBODY_POSE
      : TENET_ARMS;

  return `Floating e-commerce product photo of this ${apparelLabel(category)}. Exact item from the reference, suspended in empty space with no wearer and no stand.

${TENET_LINING}

${TENET_VOLUME}

${arms}

${TENET_BG}

${TENET_SHADOWS}

${camera}

${SINGLE_ITEM}`;
}

const FOOTWEAR_PROMPT = `Floating e-commerce product photo of this footwear (exact shoes from the reference).

${TENET_BG}

${TENET_SHADOWS}

${FOOTWEAR_ANGLE}

${SINGLE_ITEM}
No legs, ankles, feet, hangers, or text.`;

/** fal.ai prompt for catalog garment generation. */
export function buildPrompt(
  category: GhostMannequinCategory,
  instructions: string | undefined,
  compositionHint: "default" | "rear",
): string {
  const base =
    category === "footwear"
      ? FOOTWEAR_PROMPT
      : baseApparelPrompt(category, compositionHint);
  const extra = instructions?.trim();
  if (!extra) return base;
  return `${base}

Additional direction:
${extra}`;
}

async function uploadBufferToFal(buf: Buffer, name: string, mime: string): Promise<string> {
  const file = new File([new Uint8Array(buf)], name, { type: mime });
  return fal.storage.upload(file);
}

async function fetchFalImageUrl(model: string, prompt: string, imageUrls: string[]): Promise<string> {
  const response = await fal.subscribe(model, {
    input: {
      prompt,
      image_urls: imageUrls,
      num_images: 1,
      enhance_prompt_mode: "fast",
    },
    logs: false,
  });
  const data = response?.data as
    | { images?: Array<{ url?: string }>; image?: { url?: string } }
    | undefined;
  const url = data?.images?.[0]?.url ?? data?.image?.url ?? "";
  if (!url) throw new Error("fal.ai returned no image url");
  return url;
}

type PostProcessedGhost = {
  outJpeg: Buffer;
  thumbJpeg: Buffer;
  cutout: Buffer;
  neckRemovedPixels: number;
  neckRepairUsed: boolean;
};

async function postProcessGhostRaw(
  rawBuffer: Buffer,
  category: GhostMannequinCategory,
): Promise<PostProcessedGhost> {
  const skipNeck = category === "footwear";

  async function runPipeline(source: Buffer): Promise<{
    evenLight: Buffer;
    cutout: Buffer;
    neckRemovedPixels: number;
    suspectedRemaining: boolean;
  }> {
    const normalised = await sharp(source)
      .rotate()
      .resize({ width: BASE_WIDTH, height: BASE_HEIGHT, fit: "inside", withoutEnlargement: false })
      .png()
      .toBuffer();

    const { flattened, cutout: whitenCutout } = await whitenBackground(normalised);
    const firstPass = await removeNeckPost(flattened, whitenCutout, { skip: skipNeck });
    const centered = await centerCatalogImage(firstPass.cutout, {
      width: BASE_WIDTH,
      height: BASE_HEIGHT,
    });
    let evenLight = await softenCatalogShadows(centered.flattened, centered.cutout);
    let cutout = centered.cutout;
    let neckRemovedPixels = firstPass.removedPixels;
    let suspectedRemaining = firstPass.suspectedRemaining;

    if (!skipNeck) {
      const secondPass = await removeNeckPost(evenLight, cutout, { skip: false });
      neckRemovedPixels += secondPass.removedPixels;
      if (secondPass.removedPixels > 0) {
        const recentered = await centerCatalogImage(secondPass.cutout, {
          width: BASE_WIDTH,
          height: BASE_HEIGHT,
        });
        evenLight = await softenCatalogShadows(recentered.flattened, recentered.cutout);
        cutout = recentered.cutout;
      }
      suspectedRemaining = secondPass.suspectedRemaining;
    }

    return { evenLight, cutout, neckRemovedPixels, suspectedRemaining };
  }

  let processed = await runPipeline(rawBuffer);
  let neckRepairUsed = false;

  if (!skipNeck && processed.suspectedRemaining && NECK_REPAIR_ENABLED) {
    try {
      const repairUrl = await uploadBufferToFal(processed.evenLight, "ghost-repair.jpg", "image/jpeg");
      const repairedUrl = await fetchFalImageUrl(FAL_GHOST_MODEL, NECK_REPAIR_PROMPT, [repairUrl]);
      const repairedBuffer = await fetchFalResultBuffer(repairedUrl);
      processed = await runPipeline(repairedBuffer);
      neckRepairUsed = true;
      log.info("ghost.neck.repair", { model: FAL_GHOST_MODEL });
    } catch (err) {
      log.error("ghost.neck.repair.failed", err, { model: FAL_GHOST_MODEL });
    }
  }

  log.info("ghost.neck.cleanup", {
    removedPixels: processed.neckRemovedPixels,
    suspectedRemaining: processed.suspectedRemaining,
    repairUsed: neckRepairUsed,
  });

  const thumbJpeg = await sharp(processed.evenLight)
    .resize({ width: 400, height: 400, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();

  return {
    outJpeg: processed.evenLight,
    thumbJpeg,
    cutout: processed.cutout,
    neckRemovedPixels: processed.neckRemovedPixels,
    neckRepairUsed,
  };
}

async function uploadKeyToFal(key: string, fallbackName: string): Promise<string> {
  const buf = await getObject(key);
  if (!buf) throw new Error(`Missing image: ${key}`);
  return uploadBufferToFal(buf, path.basename(key) || fallbackName, contentTypeFor(key));
}

async function realGhostMannequin(input: GhostMannequinInput): Promise<GhostMannequinResult> {
  ensureFalConfigured();

  if (!(await objectExists(input.garmentImagePath))) {
    throw new Error(`Invalid garment path: ${input.garmentImagePath}`);
  }

  // Keep only extras that exist (they're optional context shots).
  const extraKeys: string[] = [];
  for (const rel of input.extraImagePaths ?? []) {
    if (await objectExists(rel)) extraKeys.push(rel);
  }

  // Uploads are independent network calls — run them concurrently. Promise.all
  // preserves order, so image_urls stays [garment, ...extras].
  const [garmentUrl, ...extraUrls] = await Promise.all([
    uploadKeyToFal(input.garmentImagePath, "garment.jpg"),
    ...extraKeys.map((k) => uploadKeyToFal(k, "context.jpg")),
  ]);

  const startedAt = Date.now();
  let resultUrl: string;
  try {
    resultUrl = await fetchFalImageUrl(
      FAL_GHOST_MODEL,
      buildPrompt(input.category, input.instructions, input.compositionHint ?? "default"),
      [garmentUrl, ...extraUrls],
    );
  } catch (err) {
    log.error("ghost.fal.failed", err, { model: FAL_GHOST_MODEL, ms: Date.now() - startedAt });
    throw new Error(`Ghost-mannequin generation failed: ${(err as Error).message}`);
  }
  log.info("ghost.fal.ok", {
    model: FAL_GHOST_MODEL,
    refs: 1 + extraUrls.length,
    ms: Date.now() - startedAt,
  });

  // Download the result. fal models prompt for #ffffff but routinely emit
  // near-white grays; whitenBackground() flood-fills the actual background to
  // pure white and produces a transparent cutout the try-on/outfit features
  // can composite directly. We resize first so the segmentation runs over
  // the canonical 1024x1366 canvas.
  const rawBuffer = await fetchFalResultBuffer(resultUrl);

  const hash = deterministicHash(input);
  const key = path.posix.join(input.userId, `ghost-${hash}.jpg`);
  const thumbKey = path.posix.join(input.userId, `ghost-${hash}-thumb.jpg`);
  const cutoutKey = path.posix.join(input.userId, `ghost-${hash}-cutout.png`);

  const processed = await postProcessGhostRaw(rawBuffer, input.category);

  await Promise.all([
    putObject(key, processed.outJpeg, "image/jpeg"),
    putObject(thumbKey, processed.thumbJpeg, "image/jpeg"),
    putObject(cutoutKey, processed.cutout, "image/png"),
  ]);

  return { resultImagePath: key, credits: processed.neckRepairUsed ? 2 : 1 };
}

// -----------------------------------------------------------------------------
// Stub implementation (kept so devs without a fal key can still run the app)
// -----------------------------------------------------------------------------

async function stubGhostMannequin(input: GhostMannequinInput): Promise<GhostMannequinResult> {
  const garmentSrc = await getObject(input.garmentImagePath);
  if (!garmentSrc) throw new Error(`Invalid garment path: ${input.garmentImagePath}`);

  const hash = deterministicHash(input);
  const key = path.posix.join(input.userId, `ghost-${hash}.jpg`);
  const thumbKey = path.posix.join(input.userId, `ghost-${hash}-thumb.jpg`);

  const garmentSize = Math.round(BASE_HEIGHT * 0.72);
  const garmentBuf = await sharp(garmentSrc)
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
  const thumbBuffer = await sharp(composedBuffer)
    .resize({ width: 400, height: 400, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 78 })
    .toBuffer();
  await Promise.all([
    putObject(key, composedBuffer, "image/jpeg"),
    putObject(thumbKey, thumbBuffer, "image/jpeg"),
  ]);

  return { resultImagePath: key, credits: 1 };
}
