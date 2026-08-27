/**
 * Automatic background whitening applied when a new upload is saved to the
 * closet.
 *
 * Same paint-bucket algorithm as the manual Whiten tool
 * ([lib/bucket-whiten.ts]), with two differences forced by it being automatic:
 *
 *  - **Seeds are the four corners**, not a click. A backdrop is rarely uniform
 *    enough for one seed to reach all of it, and each corner re-samples its own
 *    local colour, so a gradient studio sweep still clears.
 *  - **The fill stays contiguous.** Non-contiguous would whiten every pixel in
 *    the frame that happens to match the backdrop colour, including pixels
 *    inside the garment. Connectivity is the only thing protecting a white shirt
 *    on a white sweep.
 *
 * ── On the default tolerance of 1 ────────────────────────────────────────────
 *
 * Deliberately, and it will often paint almost nothing. Tolerance is a
 * per-channel maximum difference from the sampled corner, so 1 only catches
 * pixels essentially identical to it. A JPEG backdrop carries ringing and
 * sensor noise of several levels, so a real photo's "flat white" wall is
 * typically 245–255, not one value — and most of it falls outside a tolerance of
 * 1. The manual tool defaults to 36 for that reason.
 *
 * That is the correct trade for something that runs unattended on every save:
 * it can only ever clean pixels that were already the backdrop colour, so it
 * cannot eat a pale garment. Raise AUTO_WHITEN_TOLERANCE if you want it to
 * actually clear backdrops; `whitenPixelFraction` in the result tells you how
 * much it managed at the current setting.
 */
import sharp from "sharp";
import { log } from "../log";
import { boolEnv, intEnv } from "../env";
import { cornerSeeds, fillToWhiteFromSeeds } from "../bucket-whiten";

/** Matches the manual tool's slider range, so the numbers mean the same thing. */
export const MAX_TOLERANCE = 120;

/** Conservative by default: only pixels already equal to the backdrop. */
export const DEFAULT_AUTO_WHITEN_TOLERANCE = 1;

export function autoWhitenEnabled(): boolean {
  return boolEnv("AUTO_WHITEN_ON_SAVE", true);
}

export function autoWhitenTolerance(): number {
  const raw = intEnv("AUTO_WHITEN_TOLERANCE", DEFAULT_AUTO_WHITEN_TOLERANCE);
  return Math.min(raw, MAX_TOLERANCE);
}

export type AutoWhitenResult = {
  /** JPEG bytes. The input, unchanged, when nothing was painted or on failure. */
  buffer: Buffer;
  /** Pixels painted white as a fraction of the frame. */
  whitenPixelFraction: number;
  /** False when the original was returned untouched. */
  changed: boolean;
};

/**
 * Whiten the backdrop of a saved upload.
 *
 * Never throws: a decode or encode failure returns the original bytes. Losing
 * the user's photo because a cosmetic pass failed would be a bad trade, and this
 * runs inside the save path.
 */
export async function autoWhitenUpload(
  input: Buffer,
  options: { tolerance?: number; quality?: number } = {},
): Promise<AutoWhitenResult> {
  const tolerance = options.tolerance ?? autoWhitenTolerance();
  const unchanged: AutoWhitenResult = { buffer: input, whitenPixelFraction: 0, changed: false };

  try {
    const { data, info } = await sharp(input)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (info.channels !== 4) return unchanged;

    const painted = fillToWhiteFromSeeds(
      data,
      info.width,
      info.height,
      cornerSeeds(info.width, info.height),
      tolerance,
      true,
    );
    const fraction = painted / (info.width * info.height);
    if (painted === 0) {
      log.info("upload.autoWhiten.noop", { tolerance });
      return unchanged;
    }

    // Back to JPEG: these are catalog photos, and the alpha added above is only
    // there because the fill works on RGBA.
    const buffer = await sharp(data, {
      raw: { width: info.width, height: info.height, channels: 4 },
    })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: options.quality ?? 88, mozjpeg: true })
      .toBuffer();

    log.info("upload.autoWhiten.ok", {
      tolerance,
      whitenPixelFraction: Number(fraction.toFixed(4)),
    });
    return { buffer, whitenPixelFraction: fraction, changed: true };
  } catch (err) {
    log.error("upload.autoWhiten.failed", err, { tolerance });
    return unchanged;
  }
}

/**
 * Whiten a stored upload in place, keeping its thumbnail consistent.
 *
 * The thumbnail is re-derived from the whitened original rather than whitened
 * separately: at a tight tolerance the two passes would disagree — a downscaled
 * JPEG has different noise — and a grid tile that still showed a grey backdrop
 * while the detail view was clean would look like a caching bug.
 *
 * Returns what happened, for logging and tests. Never throws.
 */
export async function whitenSavedUpload(
  originalKey: string,
  options: { tolerance?: number } = {},
): Promise<AutoWhitenResult & { key: string }> {
  const { getObject, putObject } = await import("../storage");
  const { thumbnailPathFor } = await import("../image-paths");
  const { THUMB_EDGE_PX } = await import("../uploads");

  const source = await getObject(originalKey);
  if (!source) {
    log.info("upload.autoWhiten.missing", { key: originalKey });
    return { buffer: Buffer.alloc(0), whitenPixelFraction: 0, changed: false, key: originalKey };
  }

  const result = await autoWhitenUpload(source, options);
  if (!result.changed) return { ...result, key: originalKey };

  try {
    const thumb = await sharp(result.buffer)
      .resize({ width: THUMB_EDGE_PX, height: THUMB_EDGE_PX, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 78, mozjpeg: true })
      .toBuffer();
    await Promise.all([
      putObject(originalKey, result.buffer, "image/jpeg"),
      putObject(thumbnailPathFor(originalKey), thumb, "image/jpeg"),
    ]);
  } catch (err) {
    // The original is still whatever it was; nothing partially written matters
    // because both writes are the last step.
    log.error("upload.autoWhiten.writeFailed", err, { key: originalKey });
    return { ...result, changed: false, key: originalKey };
  }
  return { ...result, key: originalKey };
}
