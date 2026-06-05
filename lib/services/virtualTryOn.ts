import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { fal } from "@fal-ai/client";
import { UPLOADS_ROOT, resolveUploadPath } from "../uploads";
import { bufferToPngDataUri, fileToDataUri, fashnRunTryOn } from "./fashnTryOn";

// Real providers (USE_REAL_VIRTUAL_TRYON === "true"):
// 1) Fashn.ai try-on (FASHN_API_KEY) — one garment per API call; we chain
//    multi-garment outfits by feeding each step's output back as model_image.
//    Billing is on your Fashn plan; we do not decrement in-app credits.
// 2) fal.ai (FAL_KEY) — multi-image edit with a text prompt; costs 1 app credit.
//
// Stub mode composites the person photo with a watermark + garment thumbnails.

// fal default is a dedicated person try-on model (idm-vton) rather than a
// general image editor: it preserves the wearer's identity/pose far better and
// maps each garment onto the right body region. Edit-style models (gemini /
// flux / seedream) still work — set FAL_VTON_MODEL to one and we fall back to
// the multi-image-edit contract automatically.
const FAL_VTON_MODEL = process.env.FAL_VTON_MODEL?.trim() || "fal-ai/idm-vton";
/** Optional override for idm-vton inference steps (default ~30; higher = sharper, slower). */
const FAL_VTON_STEPS = (() => {
  const n = Number(process.env.FAL_VTON_STEPS);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
})();
/** idm-vton (and look-alikes) take human_image_url + garment_image_url + description,
 *  one garment per call; editors take a prompt + image_urls. Detect by model id. */
export function falModelUsesVtonContract(model: string): boolean {
  return model.toLowerCase().includes("idm-vton");
}
const FASHN_TRYON_MODEL = process.env.FASHN_TRYON_MODEL ?? "tryon-v1.6";
/** For `tryon-max` only. */
const FASHN_TRYON_RESOLUTION = process.env.FASHN_TRYON_RESOLUTION?.trim() || "1k";
/**
 * tryon-v1.6 render mode: performance | balanced | quality. Defaults to the
 * highest-fidelity "quality" — output fidelity matters more than the few extra
 * seconds here, and "balanced" was visibly softer on prints/textures. Override
 * with FASHN_TRYON_MODE if you'd rather trade quality for speed.
 */
const FASHN_TRYON_MODE = process.env.FASHN_TRYON_MODE?.trim().toLowerCase() || "quality";
/**
 * How Fashn should interpret the garment image. Our garment references are
 * product / ghost-mannequin cutouts (not photos of someone wearing the item),
 * so "flat-lay" gives the model the correct prior. "auto" (the old default)
 * made it guess and sometimes treated a flat garment as an on-model shot.
 */
const FASHN_GARMENT_PHOTO_TYPE =
  process.env.FASHN_GARMENT_PHOTO_TYPE?.trim().toLowerCase() || "flat-lay";
const REAL_MODE = process.env.USE_REAL_VIRTUAL_TRYON === "true";
const BASE_WIDTH = 1024;
const BASE_HEIGHT = 1366;

let falConfigured = false;
function ensureFalConfigured() {
  if (falConfigured) return;
  const key = process.env.FAL_KEY?.trim();
  if (!key) {
    throw new Error(
      'USE_REAL_VIRTUAL_TRYON is "true" but FAL_KEY is not set. Add FAL_KEY to .env, or use FASHN_API_KEY for Fashn try-on.',
    );
  }
  fal.config({ credentials: key });
  falConfigured = true;
}

/** When true, generateVirtualTryOn requires and decrements app credits (Fal path). */
export function virtualTryOnUsesAppCredits(): boolean {
  return REAL_MODE && !process.env.FASHN_API_KEY?.trim();
}

function tryOnProvider(): "stub" | "fal" | "fashn" {
  if (!REAL_MODE) return "stub";
  if (process.env.FASHN_API_KEY?.trim()) return "fashn";
  return "fal";
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
        tryOnProvider(),
        REAL_MODE && tryOnProvider() === "fashn" ? FASHN_TRYON_MODEL : "",
        REAL_MODE && tryOnProvider() === "fal" ? FAL_VTON_MODEL : "",
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 12);
}

const PROMPT = (extraPrompt?: string, garmentLabels?: (string | undefined)[]) => {
  const base = `Generate a photorealistic image of the SAME person from the first reference photo wearing the clothing items shown in the additional reference photos.

Strict requirements:
- Preserve the person's identity exactly: face, hair, skin tone, body proportions, and pose must be unchanged from the first reference.
- Preserve the original background, lighting, and camera framing of the first reference photo.
- Replace ONLY the visible clothing with the new garments. Combine the new pieces into a single coherent outfit if multiple garments are provided.
- Match the garments' colors, fabric textures, prints, logos, fit, and proportions exactly as shown in the reference photos.
- Realistic drape and natural shadows; the new clothing should look like it is actually being worn, not pasted in.
- Do not add text, watermarks, hangers, mannequins, or extra people.`;

  // Tell the model what each reference garment is and where it belongs. This is
  // the biggest lever against multi-garment composites putting a top on the
  // legs (or duplicating a piece) — the fal edit model otherwise has to guess.
  const labels = (garmentLabels ?? [])
    .map((l) => l?.trim())
    .filter((l): l is string => !!l && l.length > 0);
  let prompt = base;
  if (labels.length > 0) {
    const list = labels.map((l, i) => `${i + 1}) ${l}`).join(", ");
    prompt += `\n\nThe additional reference photos are the garments to put on the person, in order: ${list}. Place each garment on its correct body region (tops on the torso, bottoms on the legs/waist, shoes on the feet, accessories where they belong) and combine them into one coherent, layered outfit. If these references only cover part of an outfit, keep the person's other existing garments unchanged.`;
  }
  if (extraPrompt && extraPrompt.trim().length > 0) {
    prompt += `\n\nAdditional direction from the user: ${extraPrompt.trim()}`;
  }
  return prompt;
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
  if (REAL_MODE) {
    const fashnKey = process.env.FASHN_API_KEY?.trim();
    if (fashnKey) return fashnRealVirtualTryOn(input, fashnKey);
    if (process.env.FAL_KEY?.trim()) return falRealVirtualTryOn(input);
    throw new Error(
      'USE_REAL_VIRTUAL_TRYON is "true" but neither FASHN_API_KEY nor FAL_KEY is set. Add one to .env.',
    );
  }
  return stubVirtualTryOn(input);
}

// -----------------------------------------------------------------------------
// Fashn helpers
// -----------------------------------------------------------------------------

function fashnModelIsTryOnMax(modelName: string): boolean {
  return modelName.trim().toLowerCase() === "tryon-max";
}

/** tryon-v1.6 only supports tops | bottoms | one-pieces | auto — no hats/shoes. */
function mapCategoryToFashnV16(category: string | undefined): "auto" | "tops" | "bottoms" | "one-pieces" {
  const n = (category ?? "").trim().toLowerCase();
  if (!n) return "auto";
  if (n.includes("hat") || n.includes("cap") || n.includes("beanie")) return "auto";
  if (n.includes("bottom") || n === "pants" || n.includes("skirt")) return "bottoms";
  if (n.includes("dress") || n.includes("jumpsuit") || n.includes("one-piece")) return "one-pieces";
  if (
    n.includes("top") ||
    n.includes("outerwear") ||
    n.includes("shirt") ||
    n.includes("sweater") ||
    n.includes("knit")
  ) {
    return "tops";
  }
  return "auto";
}

// -----------------------------------------------------------------------------
// Real implementation
// -----------------------------------------------------------------------------

async function fashnRealVirtualTryOn(
  input: VirtualTryOnInput,
  apiKey: string,
): Promise<VirtualTryOnResult> {
  const personAbs = resolveUploadPath(input.personImagePath);
  if (!personAbs) throw new Error(`Invalid person path: ${input.personImagePath}`);
  await fs.access(personAbs);

  type Step = { abs: string; category?: string };
  const steps: Step[] = [];
  for (let i = 0; i < input.garmentImagePaths.length; i++) {
    const rel = input.garmentImagePaths[i];
    const abs = resolveUploadPath(rel);
    if (!abs) continue;
    try {
      await fs.access(abs);
      steps.push({ abs, category: input.garmentCategories?.[i] });
    } catch {
      // skip missing garments
    }
  }
  if (steps.length === 0) {
    throw new Error("None of the garment images could be read");
  }

  const useMax = fashnModelIsTryOnMax(FASHN_TRYON_MODEL);

  let modelImage = await fileToDataUri(personAbs);
  const startedAt = Date.now();
  let lastResultBuf: Buffer | null = null;

  try {
    for (let i = 0; i < steps.length; i++) {
      const { abs, category } = steps[i]!;
      const garmentImage = await fileToDataUri(abs);
      // PNG output: the only lossy compression is then our single final JPEG
      // encode, instead of Fashn JPEG -> (re-JPEG per chained step) -> JPEG.
      const inputs: Record<string, unknown> = useMax
        ? {
            model_image: modelImage,
            product_image: garmentImage,
            output_format: "png",
            resolution: FASHN_TRYON_RESOLUTION,
          }
        : {
            model_image: modelImage,
            garment_image: garmentImage,
            garment_photo_type: FASHN_GARMENT_PHOTO_TYPE,
            output_format: "png",
            mode: FASHN_TRYON_MODE,
            category: mapCategoryToFashnV16(category),
          };

      const prompt = input.prompt?.trim();
      if (prompt && useMax) {
        inputs.prompt = prompt;
      }

      const outUrl = await fashnRunTryOn(apiKey, FASHN_TRYON_MODEL, inputs);
      const fetched = await fetch(outUrl);
      if (!fetched.ok) throw new Error(`Failed to download Fashn result: ${fetched.status}`);
      const buf = Buffer.from(await fetched.arrayBuffer());
      lastResultBuf = buf;
      // Chain losslessly so adding garment N+1 doesn't degrade garments 1..N.
      modelImage = await bufferToPngDataUri(buf);
    }
  } catch (err) {
    const ms = Date.now() - startedAt;
    console.error(
      `[virtual-tryon] Fashn failed after ${ms}ms (model=${FASHN_TRYON_MODEL}, garments=${steps.length}):`,
      (err as Error).message,
    );
    throw new Error(`Virtual try-on generation failed: ${(err as Error).message}`);
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[virtual-tryon] Fashn ${FASHN_TRYON_MODEL} ok in ${elapsedMs}ms (steps=${steps.length})`,
  );

  if (!lastResultBuf) throw new Error("Fashn returned no image data");
  const buffer = lastResultBuf;

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
    credits: 0,
  };
}

type FalGarment = { abs: string; category?: string; description?: string };

/** idm-vton `description`: prefer the rich per-garment text, fall back to category. */
export function vtonDescription(g: {
  description?: string;
  category?: string;
}): string {
  const d = (g.description ?? g.category ?? "").trim();
  return d.length > 0 ? d : "a clothing garment";
}

/**
 * Dedicated VTON models (idm-vton) take one garment per call. Multi-garment
 * outfits are chained: each step's result becomes the next call's human image.
 * The result is already fal-hosted, so we feed the URL straight back without
 * re-downloading or re-encoding — the chain stays lossless.
 */
async function runFalVtonChain(personAbs: string, garments: FalGarment[]): Promise<string> {
  const [humanStart, ...garmentUrls] = await Promise.all([
    uploadToFal(personAbs, "person.jpg"),
    ...garments.map((g) => uploadToFal(g.abs, "garment.jpg")),
  ]);

  let humanUrl = humanStart;
  let resultUrl = humanUrl;
  for (let i = 0; i < garments.length; i++) {
    const stepInput: Record<string, unknown> = {
      human_image_url: humanUrl,
      garment_image_url: garmentUrls[i],
      description: vtonDescription(garments[i]!),
    };
    if (FAL_VTON_STEPS) stepInput.num_inference_steps = FAL_VTON_STEPS;

    const response = await fal.subscribe(FAL_VTON_MODEL, { input: stepInput, logs: false });
    const data = response?.data as
      | { image?: { url?: string }; images?: Array<{ url?: string }> }
      | undefined;
    const url = data?.image?.url ?? data?.images?.[0]?.url ?? "";
    if (!url) throw new Error("fal VTON returned no image url");
    humanUrl = url; // chain this garment's result into the next garment
    resultUrl = url;
  }
  return resultUrl;
}

/**
 * Editor models (gemini / flux / seedream) take the person + every garment as
 * image_urls plus a single descriptive prompt, and composite in one call.
 */
async function runFalEditComposite(
  personAbs: string,
  garments: FalGarment[],
  extraPrompt: string | undefined,
): Promise<string> {
  // Independent uploads — run concurrently; Promise.all preserves order so
  // image_urls stays [person, ...garments].
  const [personUrl, ...garmentUrls] = await Promise.all([
    uploadToFal(personAbs, "person.jpg"),
    ...garments.map((g) => uploadToFal(g.abs, "garment.jpg")),
  ]);
  const response = await fal.subscribe(FAL_VTON_MODEL, {
    input: {
      prompt: PROMPT(
        extraPrompt,
        garments.map((g) => g.category),
      ),
      image_urls: [personUrl, ...garmentUrls],
      num_images: 1,
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

async function falRealVirtualTryOn(input: VirtualTryOnInput): Promise<VirtualTryOnResult> {
  ensureFalConfigured();

  const personAbs = resolveUploadPath(input.personImagePath);
  if (!personAbs) throw new Error(`Invalid person path: ${input.personImagePath}`);
  await fs.access(personAbs);

  // Keep each garment paired with its category + description; missing files are
  // dropped here so downstream indices stay aligned.
  const garments: FalGarment[] = [];
  for (let i = 0; i < input.garmentImagePaths.length; i++) {
    const abs = resolveUploadPath(input.garmentImagePaths[i]);
    if (!abs) continue;
    try {
      await fs.access(abs);
      garments.push({
        abs,
        category: input.garmentCategories?.[i],
        description: input.garmentDescriptions?.[i],
      });
    } catch {
      // skip missing garments silently
    }
  }
  if (garments.length === 0) {
    throw new Error("None of the garment images could be read");
  }

  const startedAt = Date.now();
  let resultUrl: string;
  try {
    resultUrl = falModelUsesVtonContract(FAL_VTON_MODEL)
      ? await runFalVtonChain(personAbs, garments)
      : await runFalEditComposite(personAbs, garments, input.prompt);
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
    `[virtual-tryon] fal ${FAL_VTON_MODEL} ok in ${elapsedMs}ms (garments=${garments.length})`,
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
