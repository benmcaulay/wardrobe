import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { fal } from "@fal-ai/client";
import { log } from "../log";
import { getObject, objectExists, putObject, contentTypeFor } from "../storage";
import { whitenBackground } from "./whiten-background";

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
const FAL_GHOST_MODEL = process.env.FAL_GHOST_MODEL ?? "fal-ai/seedream/v4/edit";
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
// Real implementation
// -----------------------------------------------------------------------------

/**
 * Shared constraints — models often “complete the outfit” unless told aggressively not to.
 */
const SINGLE_ITEM_FIDELITY = `Single-item fidelity (required):
- Output must depict ONLY the merchandise visible in the supplied reference image(s). Treat this as one SKU / one listing — not a styled outfit.
- Do NOT add, imply, or invent any clothing or accessories that are not clearly shown in those references: no extra tops, bottoms, dresses, socks, shoes, layers, jewelry, or props unless they appear in the same reference frame(s).
- Do NOT “complete the look,” coordinate separates, or produce a head-to-toe outfit when the reference shows a single piece (e.g. only a hat, bag, belt, or shirt).
- Context/reference images (if any) are for detail only — still render the same item(s) shown, not an expanded wardrobe.`;

/** Keeps pale fabric from washing into #ffffff when backgrounds are normalized bright. */
const WHITE_ITEM_BACKGROUND_SEPARATION =
  "For white, off-white, or very pale items: add very light, natural shading on folds, seams, collars, cuffs, and silhouette edges (still soft even studio light, not heavy shadows) so every part of the garment or shoe reads clearly against the pure white background and no section visually merges into the backdrop.";

/**
 * Camera angle is the requirement image models most often ignore, so we state
 * it as a STRICT lead requirement in directive language and never offer an
 * "or" that lets the model choose. Both angles are env-overridable so the
 * catalog look can change without a code edit.
 */
const APPAREL_ANGLE =
  process.env.GHOST_APPAREL_ANGLE?.trim() ||
  "facing straight forward, squared to the camera — the front of the piece flat to the lens, with no rotation, tilt, or three-quarter turn";
const FOOTWEAR_ANGLE =
  process.env.GHOST_FOOTWEAR_ANGLE?.trim() ||
  "both shoes angled ~45° to the viewer's left (toes pointing left), shown together as a matched pair seen from the same outer side, at an identical angle and height";

const APPAREL_VIEW_DEFAULT = `- Camera angle (STRICT — do not deviate): the garment is ${APPAREL_ANGLE}. Centred composition, the entire item visible with comfortable margin. For a non-apparel accessory, use its natural front-facing catalog angle.`;

const APPAREL_VIEW_REAR =
  "- Rear-facing ghost-mannequin composition: the PRIMARY (first) reference image defines which side of the garment to show — if it shows the back, output a professional back view with that side centred; show yoke, shoulder blades, back neckline, and hem clearly. Do not substitute the front/chest unless the primary reference does not show the back of the piece.";

const APPAREL_PROMPT = (
  category: Exclude<GhostMannequinCategory, "footwear">,
  compositionHint: "default" | "rear",
) => {
  const label = {
    upperbody: "top garment (shirt, sweater, jacket, or other upper-body piece)",
    lowerbody:
      "bottom garment (pants, shorts, skirt, or similar — not shoes or sneakers)",
    dress: "dress",
    // "full" is the fallback garment class — NOT instruction to build a full outfit.
    full: "single garment or accessory exactly as shown in the reference (unknown type or general category — e.g. hat, bag, scarf — still one item only, not an ensemble)",
  }[category];
  const viewLine = compositionHint === "rear" ? APPAREL_VIEW_REAR : APPAREL_VIEW_DEFAULT;
  return `Generate a clean ghost-mannequin product photograph of this ${label}.

${SINGLE_ITEM_FIDELITY}

Requirements:
${viewLine}
- Pure white seamless studio background (#ffffff).
- Garment shown in a 3D form as if worn by an invisible mannequin (when the piece is apparel): sleeves filled out, shoulders shaped, collar / neckline natural, garment hanging with realistic drape and silhouette. For small accessories (hats, bags, etc.), present them as a crisp catalog product shot — correct scale and proportion — without attaching them to a body or adding other garments.
- Soft even studio lighting, no harsh cast shadows.
- ${WHITE_ITEM_BACKGROUND_SEPARATION}
- E-commerce catalog quality.
- Preserve the garment's exact colour, fabric texture, prints, logos, and proportions.
- Do not show any person, skin, mannequin body, hands, hangers, or overlaid text.`;
};

/** Footwear uses different geometry than torso/legs apparel; kept separate from lowerbody prompts. */
const FOOTWEAR_PROMPT = `Generate a clean e-commerce product photograph of this footwear (the exact shoes or sneakers shown in the reference).

${SINGLE_ITEM_FIDELITY}

Requirements:
- Camera angle (STRICT — do not deviate): ${FOOTWEAR_ANGLE}. Do not face them toe-on to the camera, splay them apart, or mirror them into a heel-to-heel "V".
- Pure white seamless studio background (#ffffff).
- Reproduce only the footwear from the reference — same silhouette, colours, materials, soles, logos, and laces. Do not substitute shirts, jackets, pants, or any other apparel.
- Balanced catalog composition, the entire pair visible with comfortable margin.
- Soft even studio lighting, no harsh cast shadows.
- ${WHITE_ITEM_BACKGROUND_SEPARATION}
- Preserve fine detail: mesh, suede, stitching, sole tread, branding.
- Do not show legs, mannequin bodies above the ankle, hangers, or text.`;

const PROMPT = (category: GhostMannequinCategory, compositionHint: "default" | "rear"): string =>
  category === "footwear" ? FOOTWEAR_PROMPT : APPAREL_PROMPT(category, compositionHint);

export function buildPrompt(
  category: GhostMannequinCategory,
  instructions: string | undefined,
  compositionHint: "default" | "rear",
): string {
  const base = PROMPT(category, category === "footwear" ? "default" : compositionHint);
  const extra = instructions?.trim();
  if (!extra) return base;
  return `${base}

Additional view instruction:
- ${extra}`;
}

async function uploadKeyToFal(key: string, fallbackName: string): Promise<string> {
  const buf = await getObject(key);
  if (!buf) throw new Error(`Missing image: ${key}`);
  const file = new File([new Uint8Array(buf)], path.basename(key) || fallbackName, {
    type: contentTypeFor(key),
  });
  return fal.storage.upload(file);
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
    const response = await fal.subscribe(FAL_GHOST_MODEL, {
      input: {
        prompt: buildPrompt(
          input.category,
          input.instructions,
          input.compositionHint ?? "default",
        ),
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
  const fetched = await fetch(resultUrl);
  if (!fetched.ok) throw new Error(`Failed to download result: ${fetched.status}`);
  const rawBuffer = Buffer.from(await fetched.arrayBuffer());

  const hash = deterministicHash(input);
  const key = path.posix.join(input.userId, `ghost-${hash}.jpg`);
  const thumbKey = path.posix.join(input.userId, `ghost-${hash}-thumb.jpg`);
  const cutoutKey = path.posix.join(input.userId, `ghost-${hash}-cutout.png`);

  const normalised = await sharp(rawBuffer)
    .rotate()
    .resize({ width: BASE_WIDTH, height: BASE_HEIGHT, fit: "inside", withoutEnlargement: false })
    .png()
    .toBuffer();

  const { flattened, cutout } = await whitenBackground(normalised);

  const [outJpeg, thumbJpeg] = await Promise.all([
    sharp(flattened).jpeg({ quality: 88 }).toBuffer(),
    sharp(flattened)
      .resize({ width: 400, height: 400, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer(),
  ]);
  await Promise.all([
    putObject(key, outJpeg, "image/jpeg"),
    putObject(thumbKey, thumbJpeg, "image/jpeg"),
    putObject(cutoutKey, cutout, "image/png"),
  ]);

  return { resultImagePath: key, credits: 1 };
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
