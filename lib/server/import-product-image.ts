/**
 * Download the best photo from a web listing and save it as an upload.
 *
 * Extracted from app/closet/add/actions.ts, which had these as private helpers,
 * because adding a picture from the web is now reachable from two places: the
 * add flow (where it becomes the garment's original photo) and the item page
 * (where it becomes another catalog view). Two copies of "which of these URLs is
 * actually the product and not the site logo" is exactly one copy too many.
 *
 * The reference is what a catalog render copies identity from, so resolution
 * sets the ceiling on output detail: search thumbnails run 245–686px while the
 * app stores originals up to 1536px. Candidates are therefore the merchant
 * page's own images *plus* the search thumbnail, and the winner is chosen by
 * measurement rather than by order — see lib/import-image-choice.ts for why
 * ordering cannot be trusted.
 */

import { chooseBestImportImage } from "@/lib/import-image-choice";
import { log } from "@/lib/log";
import { saveImageBuffer, type SavedUpload } from "@/lib/uploads";
import { resolveProductMetadata } from "@/lib/product-match";
import type { ProductMatch } from "@/lib/services/reverseImageSearch";

/** Cap on downloads per import, so a page listing many images stays cheap. */
export const MAX_IMPORT_CANDIDATES = 4;

export type ImportCandidate = {
  buffer: Buffer;
  width: number;
  height: number;
  source: string;
};

/** Download a candidate image, or null if it is unusable. */
export async function fetchImageBytes(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Wardrobe/1.0 (+https://github.com/benmcaulay/wardrobe)" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
}

/**
 * Download the candidates and let {@link chooseBestImportImage} pick.
 *
 * The rule lives in lib/import-image-choice.ts so it can be tested without the
 * network — and it has to be a rule rather than an ordering, because a merchant
 * page's og:image is sometimes the site logo rather than the product.
 */
export async function pickBestImage(
  urls: readonly string[],
): Promise<ImportCandidate | null> {
  const sharp = (await import("sharp")).default;
  const seen = new Set<string>();
  const candidates: ImportCandidate[] = [];

  for (const url of urls) {
    if (candidates.length >= MAX_IMPORT_CANDIDATES) break;
    if (!url || seen.has(url)) continue;
    seen.add(url);

    const buffer = await fetchImageBytes(url);
    if (!buffer) continue;
    try {
      const meta = await sharp(buffer).metadata();
      candidates.push({ buffer, width: meta.width ?? 0, height: meta.height ?? 0, source: url });
    } catch {
      /* not a decodable image */
    }
  }

  const best = chooseBestImportImage(candidates);
  if (best === -1) {
    for (const c of candidates) {
      log.info("listing.import.rejected", {
        url: c.source.slice(0, 80),
        width: c.width,
        height: c.height,
      });
    }
    return null;
  }
  return candidates[best]!;
}

export type ImportedListingImage =
  | { ok: true; saved: SavedUpload; enriched: Awaited<ReturnType<typeof resolveProductMetadata>> }
  | { ok: false; error: string };

/**
 * The whole path: enrich the match, gather candidates, pick, download, save.
 *
 * Enrichment runs first because it is what surfaces the full-size image, and it
 * is best-effort: a failure there still leaves the search thumbnail, which is a
 * small photo the user chose over a dead end.
 */
export async function importListingImage(
  match: ProductMatch,
  userId: string,
): Promise<ImportedListingImage> {
  const thumb = match.thumbnailUrl?.trim();

  let enriched = null;
  try {
    enriched = await resolveProductMetadata(match);
  } catch {
    /* enrichment is best-effort; the thumbnail is still importable */
  }

  const urls = [...(enriched?.imageUrls ?? []), ...(thumb ? [thumb] : [])];
  if (urls.length === 0) {
    return { ok: false, error: "This listing has no product photo to import." };
  }

  const best = await pickBestImage(urls);
  if (best) {
    log.info("listing.import", {
      picked: `${best.width}x${best.height}`,
      fromMerchantPage: best.source !== thumb,
      candidates: urls.length,
    });
    return { ok: true, saved: await saveImageBuffer(best.buffer, userId), enriched };
  }

  // Nothing qualified. Take the thumbnail anyway rather than refusing the
  // import: a small photo the user chose beats a dead end.
  const fallback = thumb ? await fetchImageBytes(thumb) : null;
  if (!fallback) {
    return { ok: false, error: "Could not download the product photo." };
  }
  log.info("listing.import", { picked: "thumbnail-fallback", bytes: fallback.length });
  return { ok: true, saved: await saveImageBuffer(fallback, userId), enriched };
}
