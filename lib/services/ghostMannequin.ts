import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { fal } from "@fal-ai/client";
import { log } from "../log";
import { boolEnv, numEnv, strEnv } from "../env";
import { costTenthCentsForModel } from "../ai-costs";
import { getObject, objectExists, putObject, contentTypeFor } from "../storage";
import { whitenBackground } from "./whiten-background";
import { centerCatalogImage } from "./center-catalog-image";
import { softenCatalogShadows } from "./flatten-catalog-lighting";
import { removeNeckPost } from "./remove-neck-post";
import { normalizeCatalogExposure } from "./normalize-exposure";
import { DEFAULT_GEMINI_IMAGE_MODEL, geminiEditImage } from "./ghost-provider-gemini";
import { fetchFalResultBuffer } from "./fal-result-fetch";

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
  /** Model that produced the image, for cost reporting. Null in stub mode. */
  model: string | null;
  /** List-price cost in tenths of a cent. 0 for a cache hit or a stub. */
  costTenthCents: number;
  /** True when an identical request already had artifacts on disk. */
  cached: boolean;
};

const BASE_WIDTH = 1024;
const BASE_HEIGHT = 1366; // 3:4 portrait
/** Bump when prompt/post-process changes so new runs don't reuse stale cache keys. */
const PROMPT_VERSION = "2026-08-footwear-flat-left";
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
  headwear: "HEADWEAR",
  accessory: "ACCESSORY",
  /** Fallback mapping — not “full outfit”; avoid misleading dev stub label. */
  full: "GENERAL",
};

// Default to Seedream v4 edit: top-tier prompt adherence (it actually obeys the
// camera-angle requirements below, where the gemini editor tended to ignore
// them) at the same ~$0.04/call. Override with FAL_GHOST_MODEL to switch.
const FAL_GHOST_MODEL = strEnv("FAL_GHOST_MODEL", "fal-ai/bytedance/seedream/v4/edit");
const REAL_MODE = boolEnv("USE_REAL_GHOST_MANNEQUIN");

/**
 * Which vendor runs the edit, decided per category.
 *
 * Everything is gemini except footwear, which stays on fal Seedream v4 edit.
 * That split is measured, not stylistic: asked for a pair of shoes upright at
 * 45° side by side, gemini-3.1-flash-image renders them mirrored sole-to-sole
 * and gemini-3-pro-image floats them tilted, both ignoring the instruction even
 * when it is the first rule in the prompt. Seedream obeys it. Shoes are also
 * the category where pose is least forgiving — a mirrored pair reads as broken
 * where a slightly off t-shirt does not.
 *
 * GHOST_PROVIDER still forces one vendor for every category when set.
 */
type GhostProvider = "fal" | "gemini";

const FAL_AVAILABLE = Boolean(strEnv("FAL_KEY"));

function providerForCategory(category: GhostMannequinCategory): GhostProvider {
  const forced = strEnv("GHOST_PROVIDER")?.toLowerCase();
  if (forced === "fal" || forced === "gemini") return forced;

  if (category === "footwear") {
    if (FAL_AVAILABLE) return "fal";
    // Falling back is better than failing: a gemini pair is imperfectly posed,
    // an error is no image at all. Logged so the cause is never a mystery.
    log.info("ghost.provider.fallback", {
      reason: "footwear prefers fal but FAL_KEY is unset; using gemini",
      category,
    });
    return "gemini";
  }
  return "gemini";
}

const GEMINI_IMAGE_MODEL = strEnv("GEMINI_IMAGE_MODEL", DEFAULT_GEMINI_IMAGE_MODEL);

/**
 * Footwear runs on the pro image model when it runs on gemini at all.
 *
 * Measured: given the same prompt, `gemini-3.1-flash-image` renders the pair
 * mirrored sole-to-sole while `gemini-3-pro-image` gets the direction right. It
 * still floats them slightly and adds a cast shadow, but the shadow is removed
 * by the whiten pass footwear already gets, and a tilt is a far smaller error
 * than a mirrored pair. Twice the price ($0.134 vs $0.067) on the one category
 * where the pose is least forgiving.
 *
 * An explicit GEMINI_IMAGE_MODEL still wins, so this can be overridden or
 * A/B tested without a code change.
 */
const GEMINI_FOOTWEAR_MODEL = strEnv("GEMINI_FOOTWEAR_MODEL", "gemini-3-pro-image");

function geminiModelFor(category: GhostMannequinCategory): string {
  if (strEnv("GEMINI_IMAGE_MODEL")) return GEMINI_IMAGE_MODEL;
  return category === "footwear" ? GEMINI_FOOTWEAR_MODEL : GEMINI_IMAGE_MODEL;
}

/**
 * Optional pose exemplar for footwear: a storage key holding an image whose
 * *arrangement* should be copied, identity ignored.
 *
 * Few-shot for geometry. Describing a pose in words is exactly what these models
 * are worst at, and showing one is the standard lever when a description does not
 * land — the edit endpoint already accepts several images, so this costs nothing
 * but the extra bytes.
 *
 * Off by default, because the positive prompt plus the pro model already produce
 * a correct pair and an unnecessary reference is one more thing to drift. Point
 * it at any render you like — a good previous output of your own is ideal, and
 * avoids shipping someone else's catalog photo as an asset.
 */
const GHOST_FOOTWEAR_POSE_REFERENCE = strEnv("GHOST_FOOTWEAR_POSE_REFERENCE");

/** Appended only when an exemplar is actually attached, so it cannot dangle. */
const POSE_REFERENCE_NOTE = `Arrangement reference:
- The final image shows the arrangement to copy: how the two shoes are angled, spaced, and stood.
- Copy that arrangement only. The shoes themselves come from the first image.`;

export function footwearPoseReferenceKey(): string | undefined {
  return GHOST_FOOTWEAR_POSE_REFERENCE;
}

/** Model string for logs and cache keys, for whichever provider ran. */
function modelLabelFor(provider: GhostProvider, category: GhostMannequinCategory): string {
  return provider === "gemini" ? geminiModelFor(category) : FAL_GHOST_MODEL;
}

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
        // The endpoint is part of a render's identity: without it a model swap
        // would silently reuse the old image. Resolved per category, since
        // footwear and apparel go to different vendors.
        modelLabelFor(providerForCategory(input.category), input.category),
        // So does the pose exemplar: attaching or changing one changes the
        // output, and without this the old render would be served instead.
        input.category === "footwear" ? (GHOST_FOOTWEAR_POSE_REFERENCE ?? "no-pose-ref") : "",
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
    return {
      resultImagePath: keys.key,
      credits: 0,
      cached: true,
      // Nothing was generated, so nothing is charged — but report which model's
      // artifact is being served so the breakdown attributes it correctly.
      model: REAL_MODE ? modelLabelFor(providerForCategory(input.category), input.category) : null,
      costTenthCents: 0,
    };
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

/**
 * Footwear pose, stated positively.
 *
 * The previous version was a wall of prohibitions — "not mirrored", "not
 * symmetric", "never sole-toward-the-camera", nine `never`s in total, with the
 * key rule in capitals. It did not work, and it plausibly made things worse:
 * image models are weak at negation, and naming "mirrored" repeatedly is as
 * likely to anchor the layout as to forbid it. Measured output was a mirrored
 * sole-to-sole pair on flash, every time.
 *
 * So this describes the target and nothing else. One short sentence per fact,
 * no "not", no capitals. Overridable with GHOST_FOOTWEAR_ANGLE.
 */
const FOOTWEAR_ANGLE = strEnv(
  "GHOST_FOOTWEAR_ANGLE",
  "angled about 45° toward the viewer's left",
);

const TYPE_FOOTWEAR = `TYPE — footwear:
- Two shoes of the same pair, ${FOOTWEAR_ANGLE}, facing left flat on the ground.
- Both shoes point the same way, as a shop displays them on a shelf.
- Each shoe is seen from its outer side.
- Both stand upright and level on their soles, at the same height, flat on the ground.
- They sit side by side and close together, the near one slightly forward.
- The frame contains the shoes alone.`;

/*
 * Hats get the footwear treatment: an explicit pose, not "a catalog pose".
 *
 * Under the accessory prompt a cap only had the global camera tenet, which
 * says head-on at 0° yaw — unambiguous for a shirt, meaningless for a cap,
 * because it does not say which face is the front. Imported hats came out
 * facing every direction. These lines pin the same shot a shop uses.
 */
const TYPE_HEADWEAR = `TYPE — headwear (cap, hat, or beanie):
- Front panel squarely to the camera, any logo or graphic centred and fully legible.
- The brim points toward the viewer and tilts slightly down, so a sliver of its underside shows.
- Crown upright and filled out as if on a head — never crushed, folded, or laid flat.
- Seen from very slightly above the brim line, the way a shop photographs a cap.
- A brimless beanie follows the same rule with its front facing the camera and the cuff level.
- The frame contains the single hat alone.`;

const TYPE_ACCESSORY = `TYPE — accessory (bag, scarf, belt, or similar):
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
    headwear: "hat (cap, beanie, or similar headwear)",
    accessory: "accessory (bag, scarf, belt, or similar)",
    full: "item exactly as shown in the reference",
  }[category];
}

function typeBlockFor(category: Exclude<GhostMannequinCategory, "footwear">): string {
  switch (category) {
    case "lowerbody":
      return TYPE_BOTTOM;
    case "dress":
      return TYPE_DRESS;
    case "headwear":
      return TYPE_HEADWEAR;
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
      : category === "accessory" || category === "headwear"
        ? // "Fully unfolded garment" is meaningless for a hat or a bag; these
          // just need to hold their own worn shape.
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
const FAL_INPUT_MAX_EDGE = numEnv("FAL_INPUT_MAX_EDGE", 1536);

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
  const input = {
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
  provider: GhostProvider,
  prompt: string,
  buffer: Buffer,
  mime: string,
): Promise<Buffer> {
  if (provider === "gemini") {
    return geminiEditImage(prompt, [{ buffer, mime }], { model: GEMINI_IMAGE_MODEL });
  }
  ensureFalConfigured();
  const url = await uploadBufferToFal(buffer, "ghost-repair.jpg", mime);
  const resultUrl = await fetchFalImageUrl(FAL_GHOST_MODEL, prompt, [url]);
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

/**
 * Fraction of the frame the subject occupies, measured on the transparent
 * cutout. A real garment covers a large share of a catalog frame; anything at
 * or below this is a failed render, not a small item.
 */
const MIN_SUBJECT_COVERAGE = 0.01;

/** Attempts allowed when the provider hands back a blank frame. Each is billed. */
const BLANK_RETRY_ATTEMPTS = 3;

async function opaqueCoverage(cutout: Buffer): Promise<number> {
  const { data, info } = await sharp(cutout).ensureAlpha().raw().toBuffer({
    resolveWithObject: true,
  });
  let opaque = 0;
  for (let i = 3; i < data.length; i += info.channels) {
    if (data[i] > 10) opaque++;
  }
  return opaque / (info.width * info.height);
}

async function postProcessGhostRaw(
  rawBuffer: Buffer,
  category: GhostMannequinCategory,
  provider: GhostProvider,
): Promise<PostProcessedGhost> {
  const skipNeck = category === "footwear";
  // Footwear is always flattened to a true #ffffff backdrop. The prompt asks for
  // white, but asking is not guaranteeing: shoes are small, dark, and high
  // contrast, so any residual studio gray reads as a dirty tile in the grid.
  // Other categories keep the bakeoff-tuned default (prod-raw won there).
  const mode = category === "footwear" && POST_PROCESS_MODE === "none" ? "whiten" : POST_PROCESS_MODE;

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
        provider,
        NECK_REPAIR_PROMPT,
        processed.evenLight,
        "image/jpeg",
      );
      processed = await runPipeline(repairedBuffer);
      neckRepairUsed = true;
      log.info("ghost.neck.repair", { provider, model: modelLabelFor(provider, category) });
    } catch (err) {
      log.error("ghost.neck.repair.failed", err, {
        provider,
        model: modelLabelFor(provider, category),
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
  const resultUrl = await fetchFalImageUrl(FAL_GHOST_MODEL, prompt, [
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
  category: GhostMannequinCategory,
): Promise<Buffer> {
  const keys = [garmentKey, ...extraKeys];
  const loaded = await Promise.all(
    keys.map(async (k) => {
      const buffer = await getObject(k);
      if (!buffer) throw new Error(`Missing image: ${k}`);
      return { buffer, mime: contentTypeFor(k) };
    }),
  );

  // The exemplar goes last so "the final image" in the note is unambiguous
  // regardless of how many context shots the user attached.
  let fullPrompt = prompt;
  const poseKey = category === "footwear" ? GHOST_FOOTWEAR_POSE_REFERENCE : undefined;
  if (poseKey) {
    const poseBuffer = await getObject(poseKey);
    if (poseBuffer) {
      loaded.push({ buffer: poseBuffer, mime: contentTypeFor(poseKey) });
      fullPrompt = `${prompt}\n\n${POSE_REFERENCE_NOTE}`;
      log.info("ghost.poseReference.attached", { key: poseKey });
    } else {
      // Silently generating without it would make a misconfigured key look like
      // a model that ignores exemplars.
      log.warn("ghost.poseReference.missing", { key: poseKey });
    }
  }

  return geminiEditImage(fullPrompt, loaded, { model: geminiModelFor(category) });
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
  const provider = providerForCategory(input.category);
  const modelLabel = modelLabelFor(provider, input.category);

  // The image models intermittently return a blank frame — observed roughly one
  // call in three on footwear. A blank is not a permanent failure, so retry it
  // here rather than surfacing it: the user clicking again would cost the same
  // and they cannot tell a blank from a slow render. Each attempt is billed, so
  // the ceiling is low and every one is logged.
  let processed: PostProcessedGhost | null = null;
  let coverage = 0;
  for (let attempt = 1; attempt <= BLANK_RETRY_ATTEMPTS; attempt++) {
    let rawBuffer: Buffer;
    const attemptStarted = Date.now();
    try {
      rawBuffer =
        provider === "gemini"
          ? await generateViaGemini(prompt, input.garmentImagePath, extraKeys, input.category)
          : await generateViaFal(prompt, input.garmentImagePath, extraKeys);
    } catch (err) {
      log.error("ghost.generate.failed", err, {
        provider,
        model: modelLabel,
        attempt,
        ms: Date.now() - attemptStarted,
      });
      throw new Error(`Ghost-mannequin generation failed: ${(err as Error).message}`);
    }
    log.info("ghost.generate.ok", {
      provider,
      model: modelLabel,
      refs: 1 + extraKeys.length,
      attempt,
      ms: Date.now() - attemptStarted,
    });

    const candidate = await postProcessGhostRaw(rawBuffer, input.category, provider);
    coverage = await opaqueCoverage(candidate.cutout);
    if (coverage >= MIN_SUBJECT_COVERAGE) {
      processed = candidate;
      break;
    }
    // Never cache an empty render: writing it to the cache keys would make every
    // later attempt a free cache hit serving the same white square, with no way
    // to regenerate.
    log.warn("ghost.generate.blank", {
      provider,
      model: modelLabel,
      attempt,
      coverage: Number(coverage.toFixed(4)),
      minimum: MIN_SUBJECT_COVERAGE,
      willRetry: attempt < BLANK_RETRY_ATTEMPTS,
    });
  }

  if (!processed) {
    throw new Error(
      `The generator returned an empty image ${BLANK_RETRY_ATTEMPTS} times in a row. ` +
        "No image was saved — please try again.",
    );
  }

  const { key, thumbKey, cutoutKey } = artifactKeys(input);

  await Promise.all([
    putObject(key, processed.outJpeg, "image/jpeg"),
    putObject(thumbKey, processed.thumbJpeg, "image/jpeg"),
    putObject(cutoutKey, processed.cutout, "image/png"),
  ]);

  // A neck repair is a second billed generation, so it doubles both the credit
  // charge and the money cost.
  const billedCalls = processed.neckRepairUsed ? 2 : 1;
  return {
    resultImagePath: key,
    credits: billedCalls,
    cached: false,
    model: modelLabel,
    costTenthCents: costTenthCentsForModel(modelLabel) * billedCalls,
  };
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

  return { resultImagePath: key, credits: 1, cached: false, model: null, costTenthCents: 0 };
}
