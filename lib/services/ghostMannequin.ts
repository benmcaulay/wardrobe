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
import { normalizeCatalogExposure } from "./normalize-exposure";
import { DEFAULT_GEMINI_IMAGE_MODEL, geminiEditImage } from "./ghost-provider-gemini";
import { fetchFalResultBuffer } from "./fal-result-fetch";
import {
  capEditImageUrls,
  loraInput,
  LORA_EDIT_ENDPOINT,
  MAX_EDIT_IMAGE_URLS,
} from "./ghost-lora";

// Two real providers, same contract: a primary garment image plus optional
// context references in, one composite out.
//
//   gemini (DEFAULT) — Google Interactions API, gemini-3.1-flash-image.
//                      Requires GEMINI_API_KEY *and* billing enabled on the
//                      Google project; there is no free tier for image models.
//   fal              — fal-ai/bytedance/seedream/v4/edit by default,
//                      ~3-5s wall time, ~$0.03-0.04 per call.
//
// GHOST_PROVIDER selects; see resolveGhostProvider for the fallback rules.
//
// Alternative fal endpoints (drop-in via FAL_GHOST_MODEL env var):
// - "fal-ai/gemini-25-flash-image/edit" — Gemini, weaker angle adherence
// - "fal-ai/flux-pro/kontext"           — Flux Kontext, similar pricing
// - "fal-ai/flux-pro/kontext/max/multi" — Flux Kontext Max (4 refs, $$$)
// - "fal-ai/idm-vton" / "fal-ai/ootd"   — true VTON (need a person ref)

export {
  mapCategoryToGhost,
  mapItemToGhost,
  requireGhostCategory,
  type GhostCategoryCheck,
  type GhostMannequinCategory,
} from "./ghost-mannequin-shared";
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
  /** Credits spent (1 = ~$0.04 with the real provider). 0 when served from cache. */
  credits: number;
  /** True when an identical request already had artifacts on disk. */
  cached: boolean;
};

const BASE_WIDTH = 1024;
const BASE_HEIGHT = 1366; // 3:4 portrait
/** Bump when prompt/post-process changes so new runs don't reuse stale cache keys. */
const PROMPT_VERSION = "2026-08-smooth-exposure";
/**
 * Catalog post-process after fal returns.
 * Bakeoff winner was `none` (prod-raw): resize only for the JPEG; cutout still
 * gets a light whiten for outfit compositing. `full` restores neck/center/shadow.
 */
type GhostPostProcessMode = "none" | "whiten" | "full";
function resolvePostProcessMode(): GhostPostProcessMode {
  const raw = (process.env.GHOST_POST_PROCESS ?? "none").trim().toLowerCase();
  if (raw === "full" || raw === "whiten" || raw === "none") return raw;
  return "none";
}
const POST_PROCESS_MODE = resolvePostProcessMode();
const NECK_REPAIR_ENABLED = process.env.GHOST_NECK_FAL_REPAIR !== "false";
/**
 * Deterministic exposure correction, on by default. The prompt has a whole
 * exposure tenet and the model still decides how bright the garment is; a
 * measured gamma curve does not need to be re-argued. Set to "false" to fall
 * back to whatever the model returned.
 */
const EXPOSURE_NORMALIZE = process.env.GHOST_EXPOSURE_NORMALIZE !== "false";

/** Repair pass — never say "mannequin"; that word triggers plastic neck inserts. */
const NECK_REPAIR_PROMPT = `Edit this e-commerce garment photo: remove any white plastic neck tube, head, bust, stump, or filler inside the collar or hood opening.
Through the neck opening, show the garment's own back lining / interior fabric only.
Keep the garment color, shape, logos, and pure white (#ffffff) background exactly unchanged. No shadows.`;

const CATEGORY_LABEL: Record<GhostMannequinCategory, string> = {
  upperbody: "TOP",
  lowerbody: "BOTTOM",
  footwear: "FOOTWEAR",
  dress: "DRESS",
  accessory: "ACCESSORY",
  /** Fallback mapping — not “full outfit”; avoid misleading dev stub label. */
  full: "GENERAL",
};

// Default to Seedream v4 edit: top-tier prompt adherence (it actually obeys the
// camera-angle requirements below, where the gemini editor tended to ignore
// them) at the same ~$0.04/call. Override with FAL_GHOST_MODEL to switch.
const FAL_GHOST_MODEL = process.env.FAL_GHOST_MODEL ?? "fal-ai/bytedance/seedream/v4/edit";
const REAL_MODE = process.env.USE_REAL_GHOST_MANNEQUIN === "true";

/**
 * A trained edit LoRA (see scripts/ghost-lora-train.ts). When set, generation
 * routes to the FLUX.2 LoRA edit endpoint instead of FAL_GHOST_MODEL, because
 * the LoRA only applies on that endpoint.
 */
const FAL_GHOST_LORA_URL = process.env.FAL_GHOST_LORA_URL?.trim() ?? "";
const FAL_GHOST_LORA_SCALE = Number(process.env.FAL_GHOST_LORA_SCALE ?? 1);
const USING_LORA = FAL_GHOST_LORA_URL.length > 0;
/** Endpoint actually called, once the LoRA override is taken into account. */
const ACTIVE_GHOST_MODEL = USING_LORA ? LORA_EDIT_ENDPOINT : FAL_GHOST_MODEL;

/**
 * Which vendor runs the edit. Both satisfy the same buffers-in / buffer-out
 * contract, so nothing above this cares which one ran.
 *
 * Default is `gemini`. Two things override it:
 *
 * 1. An explicit GHOST_PROVIDER is always honoured, including "fal".
 * 2. A trained LoRA only applies on fal-ai/flux-2/lora/edit, so setting
 *    FAL_GHOST_LORA_URL pins the provider to fal rather than silently
 *    discarding the LoRA that was paid for.
 *
 * When no provider is set *and* there is no GEMINI_API_KEY, this falls back to
 * fal — a default should not hard-break an environment (CI, another machine)
 * that only ever had a fal key. An explicit "gemini" still fails loudly.
 */
type GhostProvider = "fal" | "gemini";
function resolveGhostProvider(): GhostProvider {
  const raw = (process.env.GHOST_PROVIDER ?? "").trim().toLowerCase();
  const explicit = raw === "fal" || raw === "gemini" ? (raw as GhostProvider) : null;

  if (USING_LORA) {
    if (explicit === "gemini") {
      log.info("ghost.provider.override", {
        reason: "FAL_GHOST_LORA_URL is set; the LoRA only runs on fal",
      });
    }
    return "fal";
  }

  if (explicit) return explicit;

  if (process.env.GEMINI_API_KEY?.trim()) return "gemini";
  log.info("ghost.provider.fallback", {
    reason: "default is gemini but GEMINI_API_KEY is unset; using fal",
  });
  return "fal";
}
const GHOST_PROVIDER = resolveGhostProvider();
const GEMINI_IMAGE_MODEL =
  process.env.GEMINI_IMAGE_MODEL?.trim() || DEFAULT_GEMINI_IMAGE_MODEL;
/** Model string used for logs and cache keys, whichever provider is active. */
const ACTIVE_MODEL_LABEL =
  GHOST_PROVIDER === "gemini" ? GEMINI_IMAGE_MODEL : ACTIVE_GHOST_MODEL;

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
        POST_PROCESS_MODE,
        ...sortedExtras,
        REAL_MODE ? "real" : "stub",
        // Endpoint and LoRA are part of the identity of a render: without them
        // a model swap or a retrained LoRA would silently reuse the old image.
        ACTIVE_MODEL_LABEL,
        USING_LORA ? `lora:${FAL_GHOST_LORA_URL}@${FAL_GHOST_LORA_SCALE}` : "no-lora",
        EXPOSURE_NORMALIZE ? "exposure" : "no-exposure",
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
  // The key is a hash of every input that affects the image, so an identical
  // request already has its answer on disk. This used to overwrite the old file
  // and charge again — and because the new view row pointed at the same path,
  // two views shared one image and deleting either broke the other. Serving the
  // cache makes the collision deliberate, free, and reportable to the UI.
  //
  // Only the artifacts the active mode actually writes are required: the stub
  // produces no cutout, so demanding one would make its cache never hit.
  const keys = artifactKeys(input);
  const required = REAL_MODE
    ? [keys.key, keys.thumbKey, keys.cutoutKey]
    : [keys.key, keys.thumbKey];
  const present = await Promise.all(required.map((k) => objectExists(k)));
  if (present.every(Boolean)) {
    log.info("ghost.cache.hit", { key: keys.key, mode: REAL_MODE ? "real" : "stub" });
    return { resultImagePath: keys.key, credits: 0, cached: true };
  }

  if (REAL_MODE) return realGhostMannequin(input);
  return stubGhostMannequin(input);
}

// -----------------------------------------------------------------------------
// Real implementation — fal prompt (six tenets; never say "mannequin")
// -----------------------------------------------------------------------------

const TENET_LINING = `Openings — visible interior / back lining when applicable:
- If the item has a neckline, collar, or hood opening: show the garment's own interior fabric and back lining only.
- No white plastic tube, neck stump, bust, head, foam insert, or filler of any kind inside an opening.
- No person, skin, face, or body parts.`;

/** The reference is often a folded flat-lay. Identity must copy; pose must not. */
const TENET_REFERENCE_POSE = `Reference is for identity only — never for pose:
- Copy only what the item IS: its cut, colors, stripes, prints, logos, trims, and fabric.
- Ignore entirely HOW the reference is presented. It may be folded, stacked, laid flat, crumpled, draped, on a hanger, in a box, or worn by a person — none of that carries over.
- Always rebuild the item into an upright, fully unfolded, worn-looking shape, as if an invisible body were inside it, floating in empty space.
- A folded or flat-laid reference must still produce an upright, unfolded, three-dimensional garment. Never reproduce fold lines, stacked layers, or a flat-lay layout.`;

const TENET_VOLUME = `Natural retail shape:
- Show the item fully unfolded and filled out with natural three-dimensional form as in a clean product photo — not flat, collapsed, folded, crumpled, or empty-looking.
- The entire item is visible at full length in its true cut, nothing tucked, doubled over, or hidden behind another part of itself.
- Soft fabric hang with gentle structure; do not overfill, puff, balloon, or stretch the silhouette beyond its true cut.
- Preserve exact colors, prints, logos, and texture from the reference.`;

/** Seedream keeps carrying wrinkles over from worn/crumpled reference shots. */
const TENET_SMOOTH = `Freshly pressed finish:
- The garment reads steamed and press-ready, exactly as a retailer photographs new stock.
- Smooth surface everywhere. No wrinkles, creases, crumple marks, fold lines, rumpling, puckering, bunching, or dimpling anywhere on the fabric.
- Even if the reference photo shows the item wrinkled, rumpled, or crushed, render it smooth and pressed — wrinkles never carry over.
- Seams and hems lie flat and straight; panels are clean and evenly tensioned.
- Only the gentle, continuous curvature needed to read as three-dimensional — no surface noise beyond that.
- Any shading is broad and gradual across large areas. No small, sharp, or high-frequency light-and-dark detail on the fabric — fine tonal speckle reads as wrinkles even when the shape is smooth.
- Re-render the fabric as one clean continuous surface. Do not trace, copy, or preserve the reference photo's wrinkle and crease pattern.`;

/** Flat-lighting language was driving washed-out, over-exposed renders. */
const TENET_EXPOSURE = `Correct exposure — never brightened:
- Expose the garment exactly as in the reference. Do not lighten, brighten, bleach, wash out, or fade it.
- Keep full color depth and saturation: dark tones stay genuinely dark, mid-tones stay mid, and colors keep their richness.
- No blown-out or clipped highlights, no milky haze, no glare, no hotspots, no bloom.
- The background is pure white, but that must not pull the garment's own brightness up with it.`;

const TYPE_TOP = `TYPE — top (shirt, sweater, jacket, hoodie, or other upper-body piece):
- Shoulders level and square. Sleeves hang straight down at the sides.
- Do not bend arms inward, cross sleeves, or pinch elbows toward the center.
- Full length shown from collar to hem, unfolded — never folded in half, never with the hem doubled up toward the chest, never with sleeves tucked behind the body.
- Neck/collar/hood opening shows back lining only (see openings rule).`;

const TYPE_BOTTOM = `TYPE — bottom (pants, shorts, skirt — not shoes):
- Waistband level; legs with natural straight form — not pinched, twisted, or crumpled.`;

const TYPE_DRESS = `TYPE — dress:
- Bodice with natural shape and shoulders level; skirt/hem falls with soft drape.
- If sleeved: sleeves hang straight down at the sides (same arm rules as tops).
- Neck/collar opening shows back lining only (see openings rule).`;

const TYPE_FOOTWEAR = `TYPE — footwear:
- Both shoes as a matched pair, angled ~45° to the viewer's left, same height and orientation.
- Not toe-on, not heel-to-heel V, not splayed apart.
- No legs, ankles, or feet.`;

const TYPE_ACCESSORY = `TYPE — accessory (hat, bag, scarf, belt, or similar):
- Present the exact accessory from the reference in a clean retail catalog pose.
- No stand, person, or unrelated garments.`;

const TENET_BG = `Pure white background only:
- Seamless #ffffff filling the entire frame edge-to-edge.
- No gray, cream, gradient, floor line, or vignette.`;

const TENET_SHADOWS = `No shadows on the background:
- No cast shadow under the item, no contact shadow, no side shadow, no vignette. The background stays clean and unmarked.
- The garment itself may carry very soft, broad self-shading where the fabric turns away from the light — just enough to read as three-dimensional, never enough to look wrinkled.
- No harsh contrast, no spotlighting, no rim light, no bright hotspots.`;

const TENET_CAMERA = `Straight-on camera only:
- Item facing the lens head-on (0° yaw), centered, symmetric, fully in frame.
- Not three-quarter, not angled, not tilted.`;

const TENET_CAMERA_REAR = `Straight-on camera — back view:
- Show the back of the item head-on (0° yaw), centered, symmetric, fully in frame.
- Not three-quarter, not angled, not tilted.`;

const SINGLE_ITEM = `Single item only from the reference. No extra clothes, props, hangers, stands, poles, or text.`;

// Smoothness and exposure ride up front — they are the two the model most
// often ignores, and prompt position measurably helps adherence.
const SHARED_TENETS = `${TENET_REFERENCE_POSE}

${TENET_SMOOTH}

${TENET_EXPOSURE}

${TENET_LINING}

${TENET_VOLUME}

${TENET_BG}

${TENET_SHADOWS}`;

const TYPE_MENU = `First identify the item type from the reference image, then apply ONLY the matching TYPE block below (ignore the other TYPE blocks):

${TYPE_TOP}

${TYPE_BOTTOM}

${TYPE_DRESS}

${TYPE_FOOTWEAR}

${TYPE_ACCESSORY}`;

function apparelLabel(category: Exclude<GhostMannequinCategory, "footwear">): string {
  return {
    upperbody: "top garment (shirt, sweater, jacket, hoodie, or upper-body piece)",
    lowerbody: "bottom garment (pants, shorts, skirt — not shoes)",
    dress: "dress",
    accessory: "accessory (hat, bag, scarf, belt, or similar)",
    full: "item exactly as shown in the reference",
  }[category];
}

function typeBlockFor(category: Exclude<GhostMannequinCategory, "footwear">): string {
  switch (category) {
    case "lowerbody":
      return TYPE_BOTTOM;
    case "dress":
      return TYPE_DRESS;
    case "accessory":
      return TYPE_ACCESSORY;
    case "full":
      return TYPE_MENU;
    default:
      return TYPE_TOP;
  }
}

function baseApparelPrompt(
  category: Exclude<GhostMannequinCategory, "footwear">,
  compositionHint: "default" | "rear",
): string {
  const camera = compositionHint === "rear" ? TENET_CAMERA_REAR : TENET_CAMERA;
  const identify =
    category === "full"
      ? "Identify the garment or accessory type from the reference, then follow that type's instructions."
      : category === "accessory"
        ? // "Fully unfolded garment" is meaningless for a hat or a bag; an
          // accessory just needs to hold its own worn shape.
          "Exact item from the reference, holding its natural shape, suspended in empty space with no wearer and no stand."
        : "Exact item from the reference, rebuilt as an upright fully unfolded garment suspended in empty space with no wearer and no stand.";

  return `Floating e-commerce product photo of this ${apparelLabel(category)}. ${identify}

${typeBlockFor(category)}

${SHARED_TENETS}

${camera}

${SINGLE_ITEM}`;
}

const FOOTWEAR_PROMPT = `Floating e-commerce product photo of this footwear (exact shoes from the reference).

${TYPE_FOOTWEAR}

${TENET_REFERENCE_POSE}

${TENET_EXPOSURE}

${TENET_BG}

${TENET_SHADOWS}

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

/**
 * Longest edge for images sent to the model. Output is 1024x1366, so anything
 * larger is wasted bytes — and with inline data URIs, bytes are request size.
 */
const FAL_INPUT_MAX_EDGE = Number(process.env.FAL_INPUT_MAX_EDGE ?? 1536);

/**
 * Inline images as data URIs instead of uploading them to fal storage.
 *
 * Saves a network round trip per image and removes a dependency on fal storage
 * being reachable, which is a separate service from inference. Combined with the
 * downscale below it also cuts request size and model cost, since the output
 * canvas is only 1024x1366 anyway.
 *
 * Set GHOST_FAL_INLINE_IMAGES=false to go back to storage uploads (needed if a
 * request ever grows past the endpoint's body limit — base64 adds ~33%).
 */
const FAL_INLINE_IMAGES = process.env.GHOST_FAL_INLINE_IMAGES !== "false";

/** Downscale and re-encode so inline payloads stay modest. */
async function toInlineDataUri(buf: Buffer): Promise<string> {
  const shrunk = await sharp(buf)
    .rotate()
    .resize({
      width: FAL_INPUT_MAX_EDGE,
      height: FAL_INPUT_MAX_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 92 })
    .toBuffer();
  return `data:image/jpeg;base64,${shrunk.toString("base64")}`;
}

async function uploadBufferToFal(buf: Buffer, name: string, mime: string): Promise<string> {
  if (FAL_INLINE_IMAGES) return toInlineDataUri(buf);
  const file = new File([new Uint8Array(buf)], name, { type: mime });
  return fal.storage.upload(file);
}

async function fetchFalImageUrl(model: string, prompt: string, imageUrls: string[]): Promise<string> {
  // The LoRA edit endpoint takes a different input shape: it caps image_urls at
  // 4 (extras beyond that are a hard 400, not a silent truncation) and exposes
  // prompt expansion as an off-by-default boolean rather than a mode string.
  // Expansion stays off — it rewrites the prompt, which dilutes the negative
  // constraints the tenets are built from.
  const input = USING_LORA
    ? {
        prompt,
        image_urls: capEditImageUrls(imageUrls, MAX_EDIT_IMAGE_URLS),
        num_images: 1,
        loras: loraInput(FAL_GHOST_LORA_URL, FAL_GHOST_LORA_SCALE),
        enable_prompt_expansion: false,
        output_format: "jpeg" as const,
      }
    : {
        prompt,
        image_urls: imageUrls,
        num_images: 1,
        enhance_prompt_mode: "fast" as const,
      };

  const response = await fal.subscribe(model, { input, logs: false });
  const data = response?.data as
    | { images?: Array<{ url?: string }>; image?: { url?: string } }
    | undefined;
  const url = data?.images?.[0]?.url ?? data?.image?.url ?? "";
  if (!url) throw new Error("fal.ai returned no image url");
  return url;
}

/**
 * Run a one-off edit on an in-memory buffer through the active provider.
 * Used by the neck-repair pass, which starts from a processed buffer rather
 * than a stored key.
 */
async function editBufferWithProvider(
  prompt: string,
  buffer: Buffer,
  mime: string,
): Promise<Buffer> {
  if (GHOST_PROVIDER === "gemini") {
    return geminiEditImage(prompt, [{ buffer, mime }], { model: GEMINI_IMAGE_MODEL });
  }
  ensureFalConfigured();
  const url = await uploadBufferToFal(buffer, "ghost-repair.jpg", mime);
  const resultUrl = await fetchFalImageUrl(ACTIVE_GHOST_MODEL, prompt, [url]);
  return fetchFalResultBuffer(resultUrl);
}

type PostProcessedGhost = {
  outJpeg: Buffer;
  thumbJpeg: Buffer;
  cutout: Buffer;
  neckRemovedPixels: number;
  neckRepairUsed: boolean;
};

async function resizeToCatalogCanvas(source: Buffer): Promise<Buffer> {
  return sharp(source)
    .rotate()
    .resize({ width: BASE_WIDTH, height: BASE_HEIGHT, fit: "inside", withoutEnlargement: false })
    .png()
    .toBuffer();
}

async function postProcessGhostRaw(
  rawBuffer: Buffer,
  category: GhostMannequinCategory,
): Promise<PostProcessedGhost> {
  const skipNeck = category === "footwear";
  const mode = POST_PROCESS_MODE;

  // Exposure is corrected before the mode branches so every mode benefits, and
  // before whitening so the gamma curve sees the model's original tones. Gamma
  // fixes pure white in place, so a #ffffff background is unaffected.
  let source = rawBuffer;
  if (EXPOSURE_NORMALIZE) {
    try {
      const { buffer, correction } = await normalizeCatalogExposure(rawBuffer);
      source = buffer;
      if (correction.applied) {
        log.info("ghost.exposure.corrected", {
          gamma: Number(correction.gamma.toFixed(3)),
          saturationBoost: Number(correction.saturationBoost.toFixed(3)),
          measuredMeanLuma: Math.round(correction.measuredMeanLuma),
        });
      }
    } catch (err) {
      // A correction failure must not lose the render — fall back to raw.
      log.error("ghost.exposure.failed", err);
      source = rawBuffer;
    }
  }

  // Bakeoff winner (prod-raw): keep fal output as the catalog JPEG.
  // Still derive a transparent cutout for outfit compositing.
  if (mode === "none") {
    const normalised = await resizeToCatalogCanvas(source);
    const { cutout } = await whitenBackground(normalised);
    const outJpeg = await sharp(normalised).jpeg({ quality: 88 }).toBuffer();
    const thumbJpeg = await sharp(outJpeg)
      .resize({ width: 400, height: 400, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    log.info("ghost.postProcess", { mode, neckRemovedPixels: 0 });
    return { outJpeg, thumbJpeg, cutout, neckRemovedPixels: 0, neckRepairUsed: false };
  }

  if (mode === "whiten") {
    const normalised = await resizeToCatalogCanvas(source);
    const { flattened, cutout } = await whitenBackground(normalised);
    const outJpeg = await sharp(flattened).jpeg({ quality: 88 }).toBuffer();
    const thumbJpeg = await sharp(outJpeg)
      .resize({ width: 400, height: 400, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    log.info("ghost.postProcess", { mode, neckRemovedPixels: 0 });
    return { outJpeg, thumbJpeg, cutout, neckRemovedPixels: 0, neckRepairUsed: false };
  }

  async function runPipeline(source: Buffer): Promise<{
    evenLight: Buffer;
    cutout: Buffer;
    neckRemovedPixels: number;
    suspectedRemaining: boolean;
  }> {
    const normalised = await resizeToCatalogCanvas(source);

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

  let processed = await runPipeline(source);
  let neckRepairUsed = false;

  if (!skipNeck && processed.suspectedRemaining && NECK_REPAIR_ENABLED) {
    try {
      // Route through the active provider: on gemini there is no fal credit to
      // spend, so calling fal here would fail the repair for the wrong reason.
      const repairedBuffer = await editBufferWithProvider(
        NECK_REPAIR_PROMPT,
        processed.evenLight,
        "image/jpeg",
      );
      processed = await runPipeline(repairedBuffer);
      neckRepairUsed = true;
      log.info("ghost.neck.repair", { provider: GHOST_PROVIDER, model: ACTIVE_MODEL_LABEL });
    } catch (err) {
      log.error("ghost.neck.repair.failed", err, {
        provider: GHOST_PROVIDER,
        model: ACTIVE_MODEL_LABEL,
      });
    }
  }

  log.info("ghost.postProcess", {
    mode,
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

/** fal path: upload the images, run the edit, download the result. */
async function generateViaFal(
  prompt: string,
  garmentKey: string,
  extraKeys: string[],
): Promise<Buffer> {
  ensureFalConfigured();
  // Uploads are independent network calls — run them concurrently. Promise.all
  // preserves order, so image_urls stays [garment, ...extras].
  const [garmentUrl, ...extraUrls] = await Promise.all([
    uploadKeyToFal(garmentKey, "garment.jpg"),
    ...extraKeys.map((k) => uploadKeyToFal(k, "context.jpg")),
  ]);
  const resultUrl = await fetchFalImageUrl(ACTIVE_GHOST_MODEL, prompt, [
    garmentUrl,
    ...extraUrls,
  ]);
  return fetchFalResultBuffer(resultUrl);
}

/** Gemini path: inline the bytes, no upload step, no result download. */
async function generateViaGemini(
  prompt: string,
  garmentKey: string,
  extraKeys: string[],
): Promise<Buffer> {
  const keys = [garmentKey, ...extraKeys];
  const loaded = await Promise.all(
    keys.map(async (k) => {
      const buffer = await getObject(k);
      if (!buffer) throw new Error(`Missing image: ${k}`);
      return { buffer, mime: contentTypeFor(k) };
    }),
  );
  return geminiEditImage(prompt, loaded, { model: GEMINI_IMAGE_MODEL });
}

/** Storage keys for one request. Derived from the same hash, so they move together. */
function artifactKeys(input: GhostMannequinInput) {
  const hash = deterministicHash(input);
  return {
    key: path.posix.join(input.userId, `ghost-${hash}.jpg`),
    thumbKey: path.posix.join(input.userId, `ghost-${hash}-thumb.jpg`),
    cutoutKey: path.posix.join(input.userId, `ghost-${hash}-cutout.png`),
  };
}

async function realGhostMannequin(input: GhostMannequinInput): Promise<GhostMannequinResult> {
  if (!(await objectExists(input.garmentImagePath))) {
    throw new Error(`Invalid garment path: ${input.garmentImagePath}`);
  }


  // Keep only extras that exist (they're optional context shots).
  const extraKeys: string[] = [];
  for (const rel of input.extraImagePaths ?? []) {
    if (await objectExists(rel)) extraKeys.push(rel);
  }

  const prompt = buildPrompt(
    input.category,
    input.instructions,
    input.compositionHint ?? "default",
  );

  const startedAt = Date.now();
  let rawBuffer: Buffer;
  try {
    rawBuffer =
      GHOST_PROVIDER === "gemini"
        ? await generateViaGemini(prompt, input.garmentImagePath, extraKeys)
        : await generateViaFal(prompt, input.garmentImagePath, extraKeys);
  } catch (err) {
    log.error("ghost.generate.failed", err, {
      provider: GHOST_PROVIDER,
      model: ACTIVE_MODEL_LABEL,
      ms: Date.now() - startedAt,
    });
    throw new Error(`Ghost-mannequin generation failed: ${(err as Error).message}`);
  }
  log.info("ghost.generate.ok", {
    provider: GHOST_PROVIDER,
    model: ACTIVE_MODEL_LABEL,
    refs: 1 + extraKeys.length,
    ms: Date.now() - startedAt,
  });

  const { key, thumbKey, cutoutKey } = artifactKeys(input);

  const processed = await postProcessGhostRaw(rawBuffer, input.category);

  await Promise.all([
    putObject(key, processed.outJpeg, "image/jpeg"),
    putObject(thumbKey, processed.thumbJpeg, "image/jpeg"),
    putObject(cutoutKey, processed.cutout, "image/png"),
  ]);

  return { resultImagePath: key, credits: processed.neckRepairUsed ? 2 : 1, cached: false };
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

  return { resultImagePath: key, credits: 1, cached: false };
}
