/**
 * Client-safe helpers for outfit canvas piece images. Matches closet tile framing
 * (square container + object-cover + thumbZoom) rather than letterboxing the full
 * ghost canvas with object-contain.
 */

import { cutoutPathFor, imageUrl, isGhostImagePath } from "@/lib/image-paths";

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

export async function removeWhiteBackground(src: string): Promise<string> {
  const img = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return src;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i]! >= 240 && px[i + 1]! >= 240 && px[i + 2]! >= 240) px[i + 3] = 0;
  }
  ctx.putImageData(data, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return src;
  return URL.createObjectURL(blob);
}

/** Prefer transparent cutout for ghost images; otherwise strip near-white pixels. */
export async function resolveOutfitPieceDisplayUrl(relativePath: string): Promise<string> {
  if (isGhostImagePath(relativePath)) {
    const cutout = imageUrl(cutoutPathFor(relativePath));
    try {
      await loadImage(cutout);
      return cutout;
    } catch {
      // Older items may lack a cutout; fall back to client-side white removal.
    }
  }
  return removeWhiteBackground(imageUrl(relativePath));
}
