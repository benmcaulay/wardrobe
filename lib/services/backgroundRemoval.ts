// TODO (server-side): if the client-side @imgly/background-removal becomes
// unworkable (huge WASM bundle, no GPU on user's device, etc.), swap to a
// server-side provider here. Recommended:
// - remove.bg: https://www.remove.bg/api
// - Photoroom: https://www.photoroom.com/api
// - Replicate rembg: https://replicate.com/cjwbw/rembg
// Today the real work happens in the browser via lib/client/background-removal.ts;
// this module exists as a stub seam so a server-side fallback is one file change.

export type BackgroundRemovalResult = {
  /** DB-relative path to the transparent-background cutout, or null when unavailable. */
  cutoutImagePath: string | null;
};

/**
 * No-op server-side stub. Real removal happens client-side; see
 * lib/client/background-removal.ts. Callers treat a null result as
 * "no cutout available, fall back to the original".
 */
export async function removeBackground(_imagePath: string): Promise<BackgroundRemovalResult> {
  return { cutoutImagePath: null };
}
