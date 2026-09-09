import crypto from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import { sourcePathFor, thumbnailPathFor } from "./image-paths";
import { putObject, deleteObject } from "./storage";
import { isAllowedImageUpload } from "./image-upload-accept";

// Re-export the pure helpers so existing imports keep working. Client code
// should import from "@/lib/image-paths" directly to avoid pulling sharp in.
export { thumbnailPathFor, imageUrl, thumbnailUrl } from "./image-paths";
export { isAllowedImageUpload } from "./image-upload-accept";
// Re-export storage helpers some callers still import from here.
export { UPLOADS_ROOT, resolveUploadPath } from "./storage";
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/**
 * Stored originals. Raised from 1536 because garment crops are cut out of this
 * image, so it is the ceiling on every downstream render: a garment filling a
 * quarter of the frame came out ~400px. Measured cost of the change on a real
 * 112-item closet: originals go from ~34MB to ~95MB against Supabase's 1GB
 * free tier, and generation cost is unaffected (the ledger records a flat
 * 67 tenth-cents per flash render regardless of input size).
 */
export const MAX_EDGE_PX = 2560;

/**
 * The temporary near-native copy the camera-roll scan crops from.
 *
 * Written only when a caller asks for it, and deleted by the scan as soon as
 * the crops exist, so it never counts toward steady-state storage.
 */
export const SOURCE_EDGE_PX = 4096;
export const THUMB_EDGE_PX = 400;

export class UploadError extends Error {
  constructor(public code: "too_large" | "bad_type" | "empty" | "decode_failed", message: string) {
    super(message);
  }
}

export type SavedUpload = {
  /** Relative path from uploads/, e.g. "cuid/uuid.jpg". Store this in the DB. */
  originalImagePath: string;
  thumbnailImagePath: string;
  width: number;
  height: number;
};

/**
 * Validate + process an uploaded file: EXIF-rotate, resize to 1536px max edge,
 * and write both the full-size JPEG and a 400px thumbnail through the storage
 * seam. Returns the DB-relative paths (which double as storage keys).
 */
export type SaveOptions = {
  /**
   * Also write a near-native `-src` sibling for the camera-roll scan to crop
   * from. The caller that asks for it owns deleting it.
   */
  keepSource?: boolean;
};

export async function saveUpload(
  file: File,
  userId: string,
  options: SaveOptions = {},
): Promise<SavedUpload> {
  if (!file || file.size === 0) throw new UploadError("empty", "File is empty");
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new UploadError("too_large", `File exceeds ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB limit`);
  }
  if (!isAllowedImageUpload(file)) {
    throw new UploadError("bad_type", `Unsupported file type: ${file.type || file.name || "unknown"}`);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  return saveImageBuffer(buffer, userId, options);
}

/** Process raw image bytes the same way as {@link saveUpload}. */
export async function saveImageBuffer(
  buffer: Buffer,
  userId: string,
  options: SaveOptions = {},
): Promise<SavedUpload> {
  if (buffer.length === 0) throw new UploadError("empty", "File is empty");
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new UploadError("too_large", `File exceeds ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB limit`);
  }

  const id = crypto.randomUUID();
  const originalKey = path.posix.join(userId, `${id}.jpg`);
  const thumbKey = path.posix.join(userId, `${id}-thumb.jpg`);

  let original: Buffer;
  let thumb: Buffer;
  let meta: sharp.OutputInfo;
  let source: Buffer | null = null;
  try {
    /*
     * keepIccProfile: an iPhone photo is Display P3, and sharp strips metadata
     * by default while NOT converting the pixels. Measured here: three very
     * different embedded profiles over identical pixel values all come out
     * byte-identical, so libvips is not transforming through the input
     * profile — it only drops the tag. The result is P3-encoded pixels emitted
     * untagged, which every consumer then reads as sRGB. Same numbers, wrong
     * colour, and the classifier maps that onto FAVORITE_COLOR_OPTIONS.
     *
     * Keeping the profile costs ~500 bytes and makes the pixels mean what they
     * were authored to mean. Tagging the output sRGB instead
     * (`withIccProfile("srgb")`) would be the same mistake written down.
     */
    const out = await sharp(buffer)
      .rotate()
      .resize({ width: MAX_EDGE_PX, height: MAX_EDGE_PX, fit: "inside", withoutEnlargement: true })
      .keepIccProfile()
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    original = out.data;
    meta = out.info;
    thumb = await sharp(buffer)
      .rotate()
      .resize({ width: THUMB_EDGE_PX, height: THUMB_EDGE_PX, fit: "inside", withoutEnlargement: true })
      .keepIccProfile()
      .jpeg({ quality: 78, mozjpeg: true })
      .toBuffer();
    if (options.keepSource) {
      source = await sharp(buffer)
        .rotate()
        .resize({ width: SOURCE_EDGE_PX, height: SOURCE_EDGE_PX, fit: "inside", withoutEnlargement: true })
        .keepIccProfile()
        .jpeg({ quality: 92, mozjpeg: true })
        .toBuffer();
    }
  } catch (err) {
    throw new UploadError("decode_failed", `Could not decode image: ${(err as Error).message}`);
  }

  await Promise.all([
    putObject(originalKey, original, "image/jpeg"),
    putObject(thumbKey, thumb, "image/jpeg"),
    ...(source ? [putObject(sourcePathFor(originalKey), source, "image/jpeg")] : []),
  ]);

  return {
    originalImagePath: originalKey,
    thumbnailImagePath: thumbKey,
    width: meta.width,
    height: meta.height,
  };
}

/**
 * Best-effort delete of an image and its siblings. Ignores missing files.
 *
 * Includes the `-src` copy: it is normally removed by the scan once cropping
 * is done, but a scan that is abandoned mid-flight leaves one behind, and
 * deleting the item it belongs to is the last chance to collect it.
 */
export async function deleteUpload(originalPath: string): Promise<void> {
  await Promise.all([
    deleteObject(originalPath),
    deleteObject(thumbnailPathFor(originalPath)),
    deleteObject(sourcePathFor(originalPath)),
  ]);
}

/** Drop just the temporary full-resolution copy, keeping the stored original. */
export async function deleteSourceCopy(originalPath: string): Promise<void> {
  await deleteObject(sourcePathFor(originalPath));
}
