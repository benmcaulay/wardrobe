import crypto from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import { thumbnailPathFor } from "./image-paths";
import { putObject, deleteObject } from "./storage";
import { isAllowedImageUpload } from "./image-upload-accept";

// Re-export the pure helpers so existing imports keep working. Client code
// should import from "@/lib/image-paths" directly to avoid pulling sharp in.
export { thumbnailPathFor, imageUrl, thumbnailUrl } from "./image-paths";
export { isAllowedImageUpload } from "./image-upload-accept";
// Re-export storage helpers some callers still import from here.
export { UPLOADS_ROOT, resolveUploadPath } from "./storage";
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_EDGE_PX = 1536;
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
export async function saveUpload(file: File, userId: string): Promise<SavedUpload> {
  if (!file || file.size === 0) throw new UploadError("empty", "File is empty");
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new UploadError("too_large", `File exceeds ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB limit`);
  }
  if (!isAllowedImageUpload(file)) {
    throw new UploadError("bad_type", `Unsupported file type: ${file.type || file.name || "unknown"}`);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  return saveImageBuffer(buffer, userId);
}

/** Process raw image bytes the same way as {@link saveUpload}. */
export async function saveImageBuffer(buffer: Buffer, userId: string): Promise<SavedUpload> {
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
  try {
    const out = await sharp(buffer)
      .rotate()
      .resize({ width: MAX_EDGE_PX, height: MAX_EDGE_PX, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    original = out.data;
    meta = out.info;
    thumb = await sharp(buffer)
      .rotate()
      .resize({ width: THUMB_EDGE_PX, height: THUMB_EDGE_PX, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 78, mozjpeg: true })
      .toBuffer();
  } catch (err) {
    throw new UploadError("decode_failed", `Could not decode image: ${(err as Error).message}`);
  }

  await Promise.all([
    putObject(originalKey, original, "image/jpeg"),
    putObject(thumbKey, thumb, "image/jpeg"),
  ]);

  return {
    originalImagePath: originalKey,
    thumbnailImagePath: thumbKey,
    width: meta.width,
    height: meta.height,
  };
}

/** Best-effort delete of an image and its thumbnail. Ignores missing files. */
export async function deleteUpload(originalPath: string): Promise<void> {
  await Promise.all([
    deleteObject(originalPath),
    deleteObject(thumbnailPathFor(originalPath)),
  ]);
}
