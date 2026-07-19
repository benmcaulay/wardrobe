import path from "node:path";
import sharp from "sharp";
import { saveImageBuffer } from "../uploads";

export type NormalizedBBox = {
  x_min: number;
  y_min: number;
  x_max: number;
  y_max: number;
};

const MIN_CROP_PX = 48;
const PADDING_RATIO = 0.06;

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** Expand a normalized bbox slightly and clamp to image bounds. */
export function padBBox(box: NormalizedBBox, ratio = PADDING_RATIO): NormalizedBBox {
  const w = box.x_max - box.x_min;
  const h = box.y_max - box.y_min;
  const padX = w * ratio;
  const padY = h * ratio;
  return {
    x_min: clamp01(box.x_min - padX),
    y_min: clamp01(box.y_min - padY),
    x_max: clamp01(box.x_max + padX),
    y_max: clamp01(box.y_max + padY),
  };
}

/**
 * Crop a garment region from a source photo and store it as a new upload.
 * Returns null when the bbox is too small or invalid.
 */
export async function cropGarmentRegion(
  userId: string,
  imagePath: string,
  box: NormalizedBBox,
): Promise<string | null> {
  const { getObject } = await import("../storage");
  const buf = await getObject(imagePath);
  if (!buf) return null;

  const meta = await sharp(buf).metadata();
  const imgW = meta.width ?? 0;
  const imgH = meta.height ?? 0;
  if (imgW < MIN_CROP_PX || imgH < MIN_CROP_PX) return null;

  const padded = padBBox(box);
  let left = Math.floor(padded.x_min * imgW);
  let top = Math.floor(padded.y_min * imgH);
  let right = Math.ceil(padded.x_max * imgW);
  let bottom = Math.ceil(padded.y_max * imgH);

  left = Math.max(0, Math.min(left, imgW - 1));
  top = Math.max(0, Math.min(top, imgH - 1));
  right = Math.max(left + 1, Math.min(right, imgW));
  bottom = Math.max(top + 1, Math.min(bottom, imgH));

  const width = right - left;
  const height = bottom - top;
  if (width < MIN_CROP_PX || height < MIN_CROP_PX) return null;

  const cropped = await sharp(buf)
    .extract({ left, top, width, height })
    .jpeg({ quality: 90 })
    .toBuffer();

  const saved = await saveImageBuffer(cropped, userId);
  return saved.originalImagePath;
}

/** Pick the largest detection box (by area). */
export function largestBBox(boxes: NormalizedBBox[]): NormalizedBBox | null {
  if (boxes.length === 0) return null;
  let best = boxes[0]!;
  let bestArea = 0;
  for (const box of boxes) {
    const area = Math.max(0, box.x_max - box.x_min) * Math.max(0, box.y_max - box.y_min);
    if (area > bestArea) {
      bestArea = area;
      best = box;
    }
  }
  return bestArea > 0.002 ? best : null;
}

/** Heuristic label for moondream object detection from garment metadata. */
export function detectionLabelForGarment(name: string, category: string): string {
  const n = name.trim();
  if (n.length >= 3) return n.slice(0, 80);
  switch (category) {
    case "top":
      return "shirt or top";
    case "bottom":
      return "pants or skirt";
    case "dress":
      return "dress";
    case "outerwear":
      return "jacket or coat";
    case "shoes":
      return "shoes";
    case "accessory":
      return "accessory";
    default:
      return "clothing item";
  }
}
