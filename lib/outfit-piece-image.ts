/**
 * Client-safe helpers for outfit canvas piece images. Matches closet tile framing
 * (square container + object-cover + thumbZoom) rather than letterboxing the full
 * ghost canvas with object-contain.
 */

import { cutOutBackdrop } from "@/lib/image-cutout";
import { cutoutPathFor, imageUrl, isGhostImagePath, thumbnailUrl } from "@/lib/image-paths";

export const OUTFIT_PIECE_IMG_CLASS =
  "w-full h-full object-cover select-none pointer-events-none";

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * Strip a flat white *or* black studio backdrop, client-side.
 *
 * This used to be a global "anything over 240 becomes transparent", which also
 * deleted white garments. The decision of what counts as backdrop now lives in
 * lib/image-cutout.ts, which finds the colour from the border and removes only
 * what's connected to it — see that module for why a global threshold can't be
 * extended to black without erasing half a wardrobe.
 *
 * Returns the original URL untouched whenever there's nothing to do or the
 * canvas is unusable (a cross-origin redirect to signed storage will taint it),
 * so a failure here shows the photo as-is rather than nothing at all.
 */
export async function removeFlatBackdrop(src: string): Promise<string> {
  try {
    const img = await loadImage(src);
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    if (canvas.width === 0 || canvas.height === 0) return src;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return src;
    ctx.drawImage(img, 0, 0);

    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    if (!cutOutBackdrop(data.data, canvas.width, canvas.height)) return src;

    ctx.putImageData(data, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    return blob ? URL.createObjectURL(blob) : src;
  } catch {
    return src;
  }
}

/** Prefer the pre-rendered transparent cutout; otherwise strip the backdrop here. */
export async function resolveOutfitPieceDisplayUrl(
  relativePath: string,
  options: { preferThumbnail?: boolean } = {},
): Promise<string> {
  if (isGhostImagePath(relativePath)) {
    const cutout = imageUrl(cutoutPathFor(relativePath));
    try {
      await loadImage(cutout);
      return cutout;
    } catch {
      // Older items may lack a cutout; fall back to removing it in the browser.
    }
  }
  /*
   * The flood fill is linear in pixels, so the source size decides the cost:
   * a full-size photo is a few megapixels where the 400px thumbnail is 160k.
   * The outfit canvas draws pieces large and wants the detail; Pack mode draws
   * them at 56px and does twenty at once, so it asks for the thumbnail.
   */
  const source = options.preferThumbnail ? thumbnailUrl(relativePath) : imageUrl(relativePath);
  return removeFlatBackdrop(source);
}
