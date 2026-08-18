import sharp from "sharp";
import {
  exposureStats,
  foregroundMask,
  type RgbImage,
} from "../eval/catalog-image";

/**
 * Deterministic exposure correction for generated catalog images.
 *
 * ── Why this is not a prompt ────────────────────────────────────────────────
 *
 * "Too bright" went through two rounds of prompt work — a whole
 * `Correct exposure — never brightened` tenet — and the model still decides how
 * bright the garment is. Exposure is arithmetic, not aesthetics: measure the
 * garment's mean luma, and if it is above target, apply a curve that brings it
 * to target. Same input, same output, every time, for free.
 *
 * ── Why gamma rather than a linear gain ─────────────────────────────────────
 *
 * A linear multiply darkens *everything*, so the pure-white background turns
 * grey and the whole point of the pipeline is lost. A gamma curve on normalised
 * values fixes 0 and 1 in place — pure white stays exactly #ffffff while
 * midtones come down. That property is load-bearing here, not a nicety.
 *
 * Measurement reuses lib/eval/catalog-image.ts, so the thing being corrected is
 * measured by the same code that grades the result.
 */

export type ExposureOptions = {
  /** Garment mean luma to aim for when the render comes back too bright. */
  targetMeanLuma?: number;
  /** Only correct once the garment exceeds this, so normal renders pass through. */
  triggerMeanLuma?: number;
  /** Upper bound on correction strength; prevents a mangled render from being crushed. */
  maxGamma?: number;
  /** Restore colour up to this mean channel spread. 0 disables saturation work. */
  targetSaturation?: number;
  /** Upper bound on saturation multiplication. */
  maxSaturationBoost?: number;
  /** Compress highlights once this fraction of the garment is clipped. */
  triggerClippedRatio?: number;
  /** Value the garment's brightest pixels are compressed down to. */
  highlightCeiling?: number;
  /** Where the highlight shoulder starts. Below this, tones are untouched. */
  highlightShoulder?: number;
};

export const EXPOSURE_DEFAULTS = {
  targetMeanLuma: 190,
  triggerMeanLuma: 205,
  maxGamma: 2.2,
  targetSaturation: 0,
  maxSaturationBoost: 1.6,
  triggerClippedRatio: 0.005,
  highlightCeiling: 247,
  highlightShoulder: 232,
} as const;

export type ExposureCorrection = {
  /** 1 = no tonal change. */
  gamma: number;
  /** 1 = no saturation change. */
  saturationBoost: number;
  /** Ceiling for the highlight shoulder, or null when highlights are fine. */
  highlightCeiling: number | null;
  measuredMeanLuma: number;
  measuredSaturation: number;
  measuredClippedRatio: number;
  /** False when the render was already fine and nothing was touched. */
  applied: boolean;
};

/**
 * Gamma that maps `meanLuma` onto `target` under out = 255·(in/255)^g.
 *
 * Returns 1 (no-op) when the image is already at or below target, or when the
 * measurement is degenerate — a mean of 0 or 255 has no usable log.
 */
export function gammaForTarget(
  meanLuma: number,
  target: number,
  maxGamma: number = EXPOSURE_DEFAULTS.maxGamma,
): number {
  if (!Number.isFinite(meanLuma) || meanLuma <= target) return 1;
  if (meanLuma >= 255 || meanLuma <= 0 || target <= 0) return 1;
  const g = Math.log(target / 255) / Math.log(meanLuma / 255);
  if (!Number.isFinite(g) || g <= 1) return 1;
  return Math.min(maxGamma, g);
}

/** Multiplier that lifts `measured` channel spread toward `target`. */
export function saturationBoostFor(
  measured: number,
  target: number,
  maxBoost: number = EXPOSURE_DEFAULTS.maxSaturationBoost,
): number {
  if (target <= 0 || measured <= 0 || measured >= target) return 1;
  return Math.min(maxBoost, target / measured);
}

export type ToneCurveOptions = {
  /**
   * Restrict the curve to foreground pixels (1 = apply). Supply this whenever
   * the curve is not white-preserving — the highlight shoulder moves 255 down,
   * which would turn a #ffffff background grey if applied everywhere.
   */
  mask?: Uint8Array;
  /** Compress [shoulder, 255] into [shoulder, ceiling]. */
  highlightCeiling?: number | null;
  highlightShoulder?: number;
};

/**
 * Build the 256-entry per-channel curve. Kept separate so it can be asserted
 * directly: the shoulder's whole job is that its top entry lands on the ceiling.
 */
export function buildToneLut(
  gamma: number,
  highlightCeiling: number | null,
  highlightShoulder: number = EXPOSURE_DEFAULTS.highlightShoulder,
): Uint8Array {
  const lut = new Uint8Array(256);
  const span = 255 - highlightShoulder;
  for (let v = 0; v < 256; v++) {
    let out = gamma !== 1 ? 255 * Math.pow(v / 255, gamma) : v;
    if (highlightCeiling !== null && out > highlightShoulder && span > 0) {
      // Linear shoulder: everything above `shoulder` is squeezed into
      // [shoulder, ceiling] so no garment pixel can sit at the clip level.
      const t = (out - highlightShoulder) / span;
      out = highlightShoulder + t * (highlightCeiling - highlightShoulder);
    }
    lut[v] = Math.max(0, Math.min(255, Math.round(out)));
  }
  return lut;
}

/**
 * Apply the tone curve in place over packed RGB.
 *
 * Saturation is applied around each pixel's own luma so hue is preserved, and
 * every write is clamped to 0..255.
 *
 * Without a mask the gamma term alone is safe — it fixes 0 and 1, so pure white
 * stays pure white. The highlight shoulder is *not* white-preserving, which is
 * exactly why it can fix clipped garment pixels that gamma cannot touch; pass a
 * mask with it so the background is left alone.
 */
export function applyToneCurve(
  data: Uint8Array,
  gamma: number,
  saturationBoost: number,
  opts: ToneCurveOptions = {},
): void {
  const ceiling = opts.highlightCeiling ?? null;
  const doGamma = gamma !== 1;
  const doSat = saturationBoost !== 1;
  const doShoulder = ceiling !== null;
  if (!doGamma && !doSat && !doShoulder) return;

  const lut = buildToneLut(gamma, ceiling, opts.highlightShoulder);
  const mask = opts.mask;

  for (let i = 0, p = 0; i < data.length; i += 3, p++) {
    if (mask && !mask[p]) continue;
    let r = lut[data[i]!]!;
    let g = lut[data[i + 1]!]!;
    let b = lut[data[i + 2]!]!;
    if (doSat) {
      const y = 0.299 * r + 0.587 * g + 0.114 * b;
      r = Math.round(y + (r - y) * saturationBoost);
      g = Math.round(y + (g - y) * saturationBoost);
      b = Math.round(y + (b - y) * saturationBoost);
    }
    data[i] = r < 0 ? 0 : r > 255 ? 255 : r;
    data[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
    data[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
  }
}

/** Decide the correction for an already-decoded image. */
export function planCorrection(
  img: RgbImage,
  opts: ExposureOptions = {},
): ExposureCorrection {
  const targetMeanLuma = opts.targetMeanLuma ?? EXPOSURE_DEFAULTS.targetMeanLuma;
  const triggerMeanLuma = opts.triggerMeanLuma ?? EXPOSURE_DEFAULTS.triggerMeanLuma;
  const maxGamma = opts.maxGamma ?? EXPOSURE_DEFAULTS.maxGamma;
  const targetSaturation = opts.targetSaturation ?? EXPOSURE_DEFAULTS.targetSaturation;
  const maxBoost = opts.maxSaturationBoost ?? EXPOSURE_DEFAULTS.maxSaturationBoost;

  const fg = foregroundMask(img);
  const stats = exposureStats(img, fg.mask);

  // Nothing found to measure — a fully white or fully filled frame. Correcting
  // on a garbage measurement would be worse than leaving it alone.
  if (fg.coverage <= 0 || stats.meanLuma <= 0) {
    return {
      gamma: 1,
      saturationBoost: 1,
      highlightCeiling: null,
      measuredMeanLuma: stats.meanLuma,
      measuredSaturation: stats.meanSaturation,
      measuredClippedRatio: stats.clippedRatio,
      applied: false,
    };
  }

  const gamma =
    stats.meanLuma > triggerMeanLuma
      ? gammaForTarget(stats.meanLuma, targetMeanLuma, maxGamma)
      : 1;
  const saturationBoost = saturationBoostFor(
    stats.meanSaturation,
    targetSaturation,
    maxBoost,
  );

  // Clipping is a separate failure from overall brightness: a render can average
  // a perfectly reasonable 155 and still have blown patches. Gating the whole
  // correction on mean luma misses exactly that case, so highlights get their
  // own trigger.
  const triggerClipped = opts.triggerClippedRatio ?? EXPOSURE_DEFAULTS.triggerClippedRatio;
  const highlightCeiling =
    stats.clippedRatio > triggerClipped
      ? (opts.highlightCeiling ?? EXPOSURE_DEFAULTS.highlightCeiling)
      : null;

  return {
    gamma,
    saturationBoost,
    highlightCeiling,
    measuredMeanLuma: stats.meanLuma,
    measuredSaturation: stats.meanSaturation,
    measuredClippedRatio: stats.clippedRatio,
    applied: gamma !== 1 || saturationBoost !== 1 || highlightCeiling !== null,
  };
}

const MEASURE_EDGE = 512;

/**
 * Measure a catalog image and correct its exposure if it is too bright.
 *
 * Measurement runs on a 512px copy (cheap, and matches the scale the eval
 * thresholds were set at) while the correction is applied at full resolution.
 * Returns the input buffer untouched when no correction is warranted, so the
 * common case costs one decode and no re-encode.
 */
export async function normalizeCatalogExposure(
  input: Buffer,
  opts: ExposureOptions = {},
): Promise<{ buffer: Buffer; correction: ExposureCorrection }> {
  const small = await sharp(input)
    .flatten({ background: "#ffffff" })
    .resize({ width: MEASURE_EDGE, height: MEASURE_EDGE, fit: "inside" })
    .raw()
    .toColourspace("srgb")
    .toBuffer({ resolveWithObject: true });

  const correction = planCorrection(
    {
      data: new Uint8Array(small.data),
      width: small.info.width,
      height: small.info.height,
    },
    opts,
  );
  if (!correction.applied) return { buffer: input, correction };

  const full = await sharp(input)
    .flatten({ background: "#ffffff" })
    .raw()
    .toColourspace("srgb")
    .toBuffer({ resolveWithObject: true });
  if (full.info.channels !== 3) {
    throw new Error(`Expected 3 channels after flatten, got ${full.info.channels}`);
  }

  const pixels = new Uint8Array(full.data);
  // The mask is recomputed at full resolution rather than upscaled from the
  // measurement pass: a scaled mask leaves a halo of mis-assigned pixels along
  // the silhouette, which the shoulder would then darken into a visible fringe.
  const mask = foregroundMask({
    data: pixels,
    width: full.info.width,
    height: full.info.height,
  }).mask;
  applyToneCurve(pixels, correction.gamma, correction.saturationBoost, {
    mask,
    highlightCeiling: correction.highlightCeiling,
    highlightShoulder: opts.highlightShoulder,
  });

  const buffer = await sharp(pixels, {
    raw: { width: full.info.width, height: full.info.height, channels: 3 },
  })
    .png()
    .toBuffer();

  return { buffer, correction };
}
