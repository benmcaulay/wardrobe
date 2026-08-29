import path from "node:path";
import { log } from "../log";
import { boolEnv } from "../env";
import { NONE_CATEGORY } from "../categories";
import { normalizeColorName } from "../colors";
import type { Color } from "../json";
import { FAVORITE_COLOR_OPTIONS } from "../preferences";
import { contentTypeFor, getObject, objectExists } from "../storage";
import {
  DEFAULT_SCAN_SCENE,
  parseObservedScene,
  shouldSkipScene,
  type ObservedScene,
  type ScanSceneType,
} from "../scan-scene";
import { geminiJson, geminiText, geminiTextConfigured } from "./gemini-text";

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
  /** What the model reported seeing, independent of what the user declared. */
  scene?: ObservedScene;
  skipReason?: string;
};

type RawClassifierJson = {
  /** Positive scene enum from the current prompt. */
  scene?: string;
  /** Legacy boolean from the pre-scene prompt; still honoured when present. */
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

const REAL_MODE = boolEnv("USE_REAL_GARMENT_CLASSIFIER", true);

/** Scene-specific guidance prepended to the shared classifier prompt. */
const SCENE_GUIDANCE: Record<ScanSceneType, string> = {
  worn: `These photos show a PERSON WEARING the clothes. That is expected — catalogue what they are wearing.

Catalogue only the garments worn by the MAIN SUBJECT: the largest, most central, most in-focus person. If other people are visible — beside them, behind them, in the background — ignore what those people are wearing. Never describe or identify any person; report only the clothing.`,
  flatlay: `These photos show GARMENTS BY THEMSELVES — laid flat, on a hanger, piled on a bed, or spread out as a shopping haul.

List each piece separately. Overlapping garments are still separate entries.`,
};

/**
 * The classifier prompt, specialised by what the user said the batch is.
 *
 * The scene is reported back as a positive enum rather than filtered by a
 * "skip X" instruction — see the note in `lib/scan-scene.ts` on why negation
 * was doing no work here.
 */
export function classifierPrompt(scene: ScanSceneType): string {
  return `You are sorting photos for a digital wardrobe app.

${SCENE_GUIDANCE[scene]}

List every DISTINCT clothing item (garment, shoes, or wearable accessory) that could be catalogued separately.

Rules:
- Do NOT merge separate pieces into one entry (e.g. shirt + pants = two garments).
- Report what this photo actually is in "scene", using exactly one of:
  - "worn"    — a person is wearing the clothes
  - "flatlay" — garments shown by themselves
  - "other"   — food, scenery, receipts, screenshots, pets, or anything with no catalogue clothing
- For each item, also report its colors, pattern, and material:
  - "colors": 1-3 dominant colors, MOST dominant first, chosen ONLY from this list: ${COLOR_VOCAB.join(", ")}. Pick the closest match; omit if unclear.
  - "pattern": e.g. solid, striped, plaid, floral, graphic, checked — or omit if unclear.
  - "material": best guess, e.g. cotton, denim, leather, wool, knit — or omit if unclear.

Reply with ONLY valid JSON (no markdown):
{"scene":"worn"|"flatlay"|"other","garments":[{"category":"top"|"bottom"|"dress"|"outerwear"|"shoes"|"accessory"|"other","name":"short product title","confidence":0.0-1.0,"colors":["color"],"pattern":"pattern","material":"material"}],"reason":"why there is nothing to catalogue, when scene is other"}`;
}

/** Back-compat export: the default (worn) prompt. */
export const CLASSIFIER_PROMPT = classifierPrompt(DEFAULT_SCAN_SCENE);

/** Map vision-model category labels to wardrobe DB categories. */
export function mapClassifierCategory(raw: string | undefined): string {
  const key = (raw ?? "").trim().toLowerCase().replace(/[-_]/g, " ").replace(/\s+/g, " ");
  switch (key) {
    case "top":
    case "shirt":
    case "t shirt":
    case "tshirt":
    case "tee":
    case "tee shirt":
    case "tank":
    case "tank top":
    case "polo":
    case "polo shirt":
    case "jersey":
    case "sweater":
    case "sweatshirt":
    case "hoodie":
    case "cardigan":
    case "turtleneck":
    case "henley":
    case "blouse":
    case "long sleeve":
      return "top";
    case "bottom":
    case "bottoms":
    case "pants":
    case "trousers":
    case "jeans":
    case "shorts":
    case "skirt":
    case "leggings":
    case "chinos":
    case "joggers":
    case "sweatpants":
    case "slacks":
      return "bottom";
    case "dress":
    case "gown":
    case "sundress":
      return "dress";
    case "outerwear":
    case "jacket":
    case "coat":
    case "blazer":
    case "parka":
    case "vest":
    case "windbreaker":
    case "overcoat":
    case "raincoat":
      return "outerwear";
    case "shoes":
    case "shoe":
    case "footwear":
    case "sneakers":
    case "sneaker":
    case "trainers":
    case "boots":
    case "boot":
    case "sandals":
    case "sandal":
    case "heels":
    case "loafers":
    case "flats":
      return "shoes";
    case "accessory":
    case "accessories":
    case "bag":
    case "backpack":
    case "purse":
    case "hat":
    case "cap":
    case "beanie":
    case "belt":
    case "scarf":
    case "gloves":
    case "tie":
    case "socks":
    case "sunglasses":
    case "watch":
    case "jewelry":
    case "necklace":
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

  // Prefer the positive scene enum. `isGarment` is only consulted when the
  // model omitted "scene" entirely and sent the legacy boolean instead, which
  // keeps stored results from older scans parseable.
  const scene =
    raw.scene !== undefined
      ? parseObservedScene(raw.scene)
      : raw.isGarment === false
        ? "other"
        : parseObservedScene(undefined);

  if (shouldSkipScene(scene, garments.length)) {
    return {
      isGarment: false,
      garments: [],
      scene,
      skipReason: raw.reason?.trim() || "Not a catalogue garment",
    };
  }
  return { isGarment: true, garments: garments.slice(0, 8), scene };
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

async function loadImage(key: string): Promise<{ buffer: Buffer; mime: string }> {
  const buf = await getObject(key);
  if (!buf) throw new Error(`Missing image: ${key}`);
  return { buffer: buf, mime: contentTypeFor(key) };
}

async function realClassifyGarment(
  imagePath: string,
  scene: ScanSceneType,
): Promise<GarmentScanDetection> {
  const image = await loadImage(imagePath);
  const startedAt = Date.now();
  let text: string;
  try {
    text = await geminiText(classifierPrompt(scene), { images: [image] });
  } catch (err) {
    log.error("garment.classifier.failed", err, { ms: Date.now() - startedAt });
    throw err;
  }
  log.info("garment.classifier.ok", { provider: "gemini", ms: Date.now() - startedAt, scene });

  const parsed = parseClassifierJson(text);
  if (!parsed) {
    return {
      isGarment: true,
      garments: [{ category: NONE_CATEGORY, name: "Imported piece", confidence: 0.5, colors: [] }],
    };
  }
  return normalizeScanDetection(parsed);
}

/**
 * Bounding box for one garment inside a multi-item photo.
 *
 * Was fal Moondream object-detection. Gemini has no detection endpoint, so it is
 * asked for normalised coordinates directly. The prompt pins the coordinate
 * space (0-1, origin top-left) because that is the one thing a vision model will
 * otherwise vary between pixels, percentages, and 0-1000 grids between calls.
 */
export async function detectGarmentBounds(
  imagePath: string,
  garment: DetectedGarment,
): Promise<import("./garment-crop").NormalizedBBox | null> {
  if (!REAL_MODE || !geminiTextConfigured()) return null;
  const { detectionLabelForGarment, largestBBox } = await import("./garment-crop");
  const object = detectionLabelForGarment(garment.name, garment.category);
  const prompt = `Locate every "${object}" in this photo.

Coordinates MUST be normalised floats from 0 to 1, with the origin at the TOP-LEFT
of the image: x_min/x_max are fractions of the image width, y_min/y_max fractions
of its height. Do not use pixels, percentages, or a 0-1000 grid.

Return ONLY valid JSON: {"objects":[{"x_min":0.0,"y_min":0.0,"x_max":0.0,"y_max":0.0}]}
If the item is not visible, return {"objects":[]}.`;
  try {
    const image = await loadImage(imagePath);
    const data = await geminiJson<{ objects?: RawDetectObject[] }>(prompt, { images: [image] });
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
    log.error("garment.detect.failed", err, { object });
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
export async function detectGarmentsInPhoto(
  imagePath: string,
  scene: ScanSceneType = DEFAULT_SCAN_SCENE,
): Promise<GarmentScanDetection> {
  if (!(await objectExists(imagePath))) {
    return { isGarment: false, garments: [], skipReason: "Image missing" };
  }
  if (!REAL_MODE || !geminiTextConfigured()) {
    return stubScanDetection(imagePath);
  }
  try {
    return await realClassifyGarment(imagePath, scene);
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
export async function classifyGarmentImage(
  imagePath: string,
  scene: ScanSceneType = DEFAULT_SCAN_SCENE,
): Promise<GarmentClassification> {
  const scan = await detectGarmentsInPhoto(imagePath, scene);
  return normalizeClassification({
    isGarment: scan.isGarment,
    garments: scan.garments,
    reason: scan.skipReason,
  });
}
