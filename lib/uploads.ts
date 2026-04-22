import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";

export const UPLOADS_ROOT = path.join(process.cwd(), "uploads");
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_EDGE_PX = 1536;
export const THUMB_EDGE_PX = 400;

export const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

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
 * Resolve a relative upload path (as stored in the DB) to an absolute path on
 * disk, rejecting anything that escapes the uploads root. Returns null if the
 * path is invalid.
 */
export function resolveUploadPath(relativePath: string): string | null {
  const normalized = path.posix.normalize(relativePath).replace(/^\/+/, "");
  if (normalized.startsWith("..")) return null;
  const absolute = path.resolve(UPLOADS_ROOT, normalized);
  const root = path.resolve(UPLOADS_ROOT);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) return null;
  return absolute;
}

/** Derive the thumbnail path from an original path. Convention: foo.jpg → foo-thumb.jpg. */
export function thumbnailPathFor(originalPath: string): string {
  const ext = path.posix.extname(originalPath);
  const base = originalPath.slice(0, originalPath.length - ext.length);
  return `${base}-thumb${ext}`;
}

/** URL to serve an image through our authenticated route. */
export function imageUrl(relativePath: string): string {
  return `/api/images/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
}

/** Convenience: URL for the thumbnail derived from the original path. */
export function thumbnailUrl(originalPath: string): string {
  return imageUrl(thumbnailPathFor(originalPath));
}

/**
 * Validate + process an uploaded file: EXIF-rotate, resize to 1536px max edge,
 * and write both the full-size JPEG and a 400px thumbnail. Returns the
 * DB-relative paths.
 */
export async function saveUpload(file: File, userId: string): Promise<SavedUpload> {
  if (!file || file.size === 0) throw new UploadError("empty", "File is empty");
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new UploadError("too_large", `File exceeds ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB limit`);
  }
  if (!ALLOWED_MIME.has(file.type)) {
    throw new UploadError("bad_type", `Unsupported file type: ${file.type || "unknown"}`);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const id = crypto.randomUUID();
  const dir = path.join(UPLOADS_ROOT, userId);
  await fs.mkdir(dir, { recursive: true });

  const originalName = `${id}.jpg`;
  const thumbName = `${id}-thumb.jpg`;
  const originalAbs = path.join(dir, originalName);
  const thumbAbs = path.join(dir, thumbName);

  let meta: sharp.OutputInfo;
  try {
    meta = await sharp(buffer)
      .rotate()
      .resize({ width: MAX_EDGE_PX, height: MAX_EDGE_PX, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 88, mozjpeg: true })
      .toFile(originalAbs);
    await sharp(buffer)
      .rotate()
      .resize({ width: THUMB_EDGE_PX, height: THUMB_EDGE_PX, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 78, mozjpeg: true })
      .toFile(thumbAbs);
  } catch (err) {
    await fs.rm(originalAbs, { force: true });
    await fs.rm(thumbAbs, { force: true });
    throw new UploadError("decode_failed", `Could not decode image: ${(err as Error).message}`);
  }

  return {
    originalImagePath: path.posix.join(userId, originalName),
    thumbnailImagePath: path.posix.join(userId, thumbName),
    width: meta.width,
    height: meta.height,
  };
}

/** Best-effort delete of an image and its thumbnail. Ignores missing files. */
export async function deleteUpload(originalPath: string): Promise<void> {
  const abs = resolveUploadPath(originalPath);
  const thumbAbs = resolveUploadPath(thumbnailPathFor(originalPath));
  if (abs) await fs.rm(abs, { force: true });
  if (thumbAbs) await fs.rm(thumbAbs, { force: true });
}
