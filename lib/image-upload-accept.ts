/** Shared image upload rules (safe for client + server). */
export const ALLOWED_IMAGE_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/heic-sequence",
] as const;

export const IMAGE_UPLOAD_ACCEPT =
  "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif";

const ALLOWED_EXT = /\.(jpe?g|png|webp|heic|heif)$/i;

/** Accept by MIME or extension (Photos drag-drop often omits MIME). */
export function isAllowedImageUpload(file: Pick<File, "type" | "name">): boolean {
  if (file.type && (ALLOWED_IMAGE_MIME as readonly string[]).includes(file.type)) return true;
  return ALLOWED_EXT.test(file.name);
}
