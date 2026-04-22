// TODO: replace with a real background-removal call (remove.bg, Photoroom,
// Replicate rembg, or fal.ai).
// remove.bg: https://www.remove.bg/api
// Photoroom: https://www.photoroom.com/api
// Replicate rembg: https://replicate.com/cjwbw/rembg

export type BackgroundRemovalResult = {
  /** DB-relative path to the transparent-background cutout, or null when unavailable. */
  cutoutImagePath: string | null;
};

/**
 * No-op stub. A real implementation should produce a PNG cutout and store it
 * next to the original, then return the DB-relative path. Callers currently
 * treat a null result as "no cutout available, fall back to the original".
 */
export async function removeBackground(_imagePath: string): Promise<BackgroundRemovalResult> {
  return { cutoutImagePath: null };
}
