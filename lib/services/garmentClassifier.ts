import path from "node:path";
import { fal } from "@fal-ai/client";
import { log } from "../log";
import { NONE_CATEGORY } from "../categories";
import { normalizeColorName } from "../colors";
import type { Color } from "../json";
import { FAVORITE_COLOR_OPTIONS } from "../preferences";
import { getObject, objectExists } from "../storage";

export type GarmentClassification = {
  isGarment: boolean;
  category: string;
  name: string;
  confidence: number;
  skipReason?: string;
};

/** One catalogue garment found in a camera-roll photo (multi-item scenes). */
export type DetectedGarment = {
  category: string;
  name: string;
  confidence: number;
  /** Colors mapped to the built-in palette so they filter/sort in the closet. */
  colors: Color[];
  pattern?: string;
  material?: string;
};

/** Named-color vocabulary the classifier must choose from, so results map to real swatches. */
const COLOR_VOCAB = FAVORITE_COLOR_OPTIONS.map((c) => c.name);
const COLOR_BY_NAME = new Map(
  FAVORITE_COLOR_OPTIONS.map((c) => [normalizeColorName(c.name), c]),
);

/** Map free-text color names from the model onto known palette swatches (max 3). */
function resolveColorNames(raw: unknown): Color[] {
  if (!Array.isArray(raw)) return [];
  const out: Color[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const key = normalizeColorName(entry);
    const hit = COLOR_BY_NAME.get(key);
    if (!hit || seen.has(key)) continue;
    seen.add(key);
    out.push({ ...hit });
    if (out.length >= 3) break;
  }
  return out;
}

function cleanAttr(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const v = raw.trim().toLowerCase();
  if (!v || v === "none" || v === "n/a" || v === "unknown") return undefined;
  return v.slice(0, 60);
}

export type GarmentScanDetection = {
  isGarment: boolean;
  garments: DetectedGarment[];
  skipReason?: string;
};

type RawClassifierJson = {
  isGarment?: boolean;
  category?: string;
  name?: string;
  confidence?: number;
  colors?: unknown;
  pattern?: string;
  material?: string;
  reason?: string;
  garments?: Array<{
    category?: string;
    name?: string;
    confidence?: number;
    colors?: unknown;
    pattern?: string;
    material?: string;
  }>;
};

type RawDetectObject = {
  x_min?: number;
  y_min?: number;
  x_max?: number;
  y_max?: number;
};

const FAL_DETECT_MODEL =
  process.env.FAL_GARMENT_DETECT_MODEL ?? "fal-ai/moondream2/object-detection";

const REAL_MODE = process.env.USE_REAL_GARMENT_CLASSIFIER !== "false";
const FAL_VISION_MODEL =
  process.env.FAL_GARMENT_CLASSIFIER_MODEL ?? "fal-ai/moondream2";

const CLASSIFIER_PROMPT = `You are sorting photos for a digital wardrobe app.

Look at this image and list every DISTINCT clothing item (garment, shoes, or wearable accessory) that could be catalogued separately.

Rules:
- If the photo shows multiple items (outfit flat-lay, bed spread, shopping haul, closet pile), list EACH item separately.
- If only ONE primary item is visible, return a garments array with one entry.
- Skip selfies where a person is the subject, food, scenery, receipts, or photos with no catalogue clothing.
- Do NOT merge separate pieces into one entry (e.g. shirt + pants = two garments).
- For each item, also report its colors, pattern, and material:
  - "colors": 1-3 dominant colors, MOST dominant first, chosen ONLY from this list: ${COLOR_VOCAB.join(", ")}. Pick the closest match; omit if unclear.
  - "pattern": e.g. solid, striped, plaid, floral, graphic, checked — or omit if unclear.
  - "material": best guess, e.g. cotton, denim, leather, wool, knit — or omit if unclear.

Reply with ONLY valid JSON (no markdown):
{"isGarment":true|false,"garments":[{"category":"top"|"bottom"|"dress"|"outerwear"|"shoes"|"accessory"|"other","name":"short product title","confidence":0.0-1.0,"colors":["color"],"pattern":"pattern","material":"material"}],"reason":"optional skip reason when isGarment is false"}`;

let falConfigured = false;
function ensureFalConfigured() {
  if (falConfigured) return;
  const key = process.env.FAL_KEY;
  if (!key) {
    throw new Error("FAL_KEY is not set");
  }
  fal.config({ credentials: key });
  falConfigured = true;
}

/** Map vision-model category labels to wardrobe DB categories. */
export function mapClassifierCategory(raw: string | undefined): string {
  const key = (raw ?? "").trim().toLowerCase();
  switch (key) {
    case "top":
    case "shirt":
    case "sweater":
    case "hoodie":
    case "blouse":
      return "top";
    case "bottom":
    case "pants":
    case "shorts":
    case "skirt":
      return "bottom";
    case "dress":
      return "dress";
    case "outerwear":
    case "jacket":
    case "coat":
      return "outerwear";
    case "shoes":
    case "footwear":
    case "sneakers":
      return "shoes";
    case "accessory":
    case "bag":
    case "hat":
      return "accessory";
    default:
      return NONE_CATEGORY;
  }
}

export function parseClassifierJson(text: string): RawClassifierJson | null {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? trimmed).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as RawClassifierJson;
  } catch {
    return null;
  }
}

export function normalizeClassification(raw: RawClassifierJson): GarmentClassification {
  const scan = normalizeScanDetection(raw);
  const primary = scan.garments[0];
  if (!scan.isGarment || !primary) {
    return {
      isGarment: false,
      category: NONE_CATEGORY,
      name: "",
      confidence: 0,
      skipReason: scan.skipReason ?? "Not a catalogue garment",
    };
  }
  return {
    isGarment: true,
    category: primary.category,
    name: primary.name,
    confidence: primary.confidence,
  };
}

export function normalizeScanDetection(raw: RawClassifierJson): GarmentScanDetection {
  const legacyGarments: DetectedGarment[] = [];
  if (raw.category || raw.name) {
    const confidence =
      typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
        ? Math.min(1, Math.max(0, raw.confidence))
        : raw.isGarment
          ? 0.75
          : 0.25;
    legacyGarments.push({
      category: mapClassifierCategory(raw.category),
      name: (raw.name ?? "").trim().slice(0, 120) || "Imported piece",
      confidence,
      colors: resolveColorNames(raw.colors),
      pattern: cleanAttr(raw.pattern),
      material: cleanAttr(raw.material),
    });
  }

  const parsedGarments = (raw.garments ?? [])
    .map((g) => {
      const confidence =
        typeof g.confidence === "number" && Number.isFinite(g.confidence)
          ? Math.min(1, Math.max(0, g.confidence))
          : 0.7;
      const name = (g.name ?? "").trim().slice(0, 120) || "Imported piece";
      return {
        category: mapClassifierCategory(g.category),
        name,
        confidence,
        colors: resolveColorNames(g.colors),
        pattern: cleanAttr(g.pattern),
        material: cleanAttr(g.material),
      };
    })
    .filter((g) => g.confidence >= 0.35);

  let garments = parsedGarments.length > 0 ? parsedGarments : legacyGarments;
  garments = dedupeGarments(garments);

  const isGarment = !!raw.isGarment && garments.length > 0;
  if (!isGarment) {
    return {
      isGarment: false,
      garments: [],
      skipReason: raw.reason?.trim() || "Not a catalogue garment",
    };
  }
  return { isGarment: true, garments: garments.slice(0, 8) };
}

function dedupeGarments(garments: DetectedGarment[]): DetectedGarment[] {
  const out: DetectedGarment[] = [];
  for (const g of garments) {
    const dupe = out.some(
      (x) =>
        x.category === g.category &&
        x.name.toLowerCase().replace(/\s+/g, " ") === g.name.toLowerCase().replace(/\s+/g, " "),
    );
    if (!dupe) out.push(g);
  }
  return out;
}

async function uploadKeyToFal(key: string): Promise<string> {
  const buf = await getObject(key);
  if (!buf) throw new Error(`Missing image: ${key}`);
  const file = new File([new Uint8Array(buf)], path.basename(key) || "photo.jpg", {
    type: "image/jpeg",
  });
  return fal.storage.upload(file);
}

async function realClassifyGarment(imagePath: string): Promise<GarmentScanDetection> {
  ensureFalConfigured();
  const imageUrl = await uploadKeyToFal(imagePath);
  const startedAt = Date.now();
  let text = "";
  try {
    const response = await fal.subscribe(FAL_VISION_MODEL, {
      input: { image_url: imageUrl, prompt: CLASSIFIER_PROMPT },
      logs: false,
    });
    const data = response?.data as { output?: string; text?: string; answer?: string } | undefined;
    text = data?.output ?? data?.text ?? data?.answer ?? "";
    if (!text && typeof response?.data === "string") text = response.data;
  } catch (err) {
    log.error("garment.classifier.fal.failed", err, { model: FAL_VISION_MODEL, ms: Date.now() - startedAt });
    throw err;
  }
  log.info("garment.classifier.ok", { model: FAL_VISION_MODEL, ms: Date.now() - startedAt });

  const parsed = parseClassifierJson(text);
  if (!parsed) {
    return {
      isGarment: true,
      garments: [{ category: NONE_CATEGORY, name: "Imported piece", confidence: 0.5, colors: [] }],
    };
  }
  return normalizeScanDetection(parsed);
}

export async function detectGarmentBounds(
  imagePath: string,
  garment: DetectedGarment,
): Promise<import("./garment-crop").NormalizedBBox | null> {
  if (!REAL_MODE || !process.env.FAL_KEY) return null;
  ensureFalConfigured();
  const { detectionLabelForGarment, largestBBox } = await import("./garment-crop");
  const imageUrl = await uploadKeyToFal(imagePath);
  const object = detectionLabelForGarment(garment.name, garment.category);
  try {
    const response = await fal.subscribe(FAL_DETECT_MODEL, {
      input: { image_url: imageUrl, object },
      logs: false,
    });
    const data = response?.data as { objects?: RawDetectObject[] } | undefined;
    const boxes =
      data?.objects
        ?.map((o) => ({
          x_min: o.x_min ?? 0,
          y_min: o.y_min ?? 0,
          x_max: o.x_max ?? 0,
          y_max: o.y_max ?? 0,
        }))
        .filter((b) => b.x_max > b.x_min && b.y_max > b.y_min) ?? [];
    return largestBBox(boxes);
  } catch (err) {
    log.error("garment.detect.failed", err, { model: FAL_DETECT_MODEL, object });
    return null;
  }
}

function stubScanDetection(imagePath: string): GarmentScanDetection {
  const base = path.basename(imagePath, path.extname(imagePath));
  return {
    isGarment: true,
    garments: [
      { category: NONE_CATEGORY, name: `Imported ${base.slice(0, 8)}`, confidence: 0.9, colors: [] },
    ],
  };
}

/**
 * Detect all catalogue garments in a camera-roll photo.
 */
export async function detectGarmentsInPhoto(imagePath: string): Promise<GarmentScanDetection> {
  if (!(await objectExists(imagePath))) {
    return { isGarment: false, garments: [], skipReason: "Image missing" };
  }
  if (!REAL_MODE || !process.env.FAL_KEY) {
    return stubScanDetection(imagePath);
  }
  try {
    return await realClassifyGarment(imagePath);
  } catch {
    return {
      isGarment: true,
      garments: [{ category: NONE_CATEGORY, name: "Imported piece", confidence: 0.4, colors: [] }],
    };
  }
}

/**
 * Decide whether a camera-roll photo is a catalogue garment and infer metadata.
 * Uses fal vision when enabled; stub accepts everything in dev.
 */
export async function classifyGarmentImage(imagePath: string): Promise<GarmentClassification> {
  const scan = await detectGarmentsInPhoto(imagePath);
  return normalizeClassification({
    isGarment: scan.isGarment,
    garments: scan.garments,
    reason: scan.skipReason,
  });
}
