/**
 * Objective quality metrics for generated catalog images.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * Ghost-mannequin quality has been judged by eye: someone looks at a render,
 * says "still too wrinkly", and a prompt tenet gets rewritten. That loop has no
 * memory and no ground truth — a change that fixes wrinkles while blowing out
 * exposure reads as progress, and a regression three prompts later is invisible.
 *
 * These are the numbers that make the loop closed. Every model swap, prompt
 * edit, or LoRA can be scored against the same fixtures and compared.
 *
 * Pure functions over raw pixels, no sharp / fs, so they unit-test without
 * fixtures. scripts/eval-catalog.ts does the decoding and reporting.
 *
 * ── What these metrics can and cannot tell you ──────────────────────────────
 *
 * They measure *photographic* properties: high-frequency surface detail,
 * exposure, background purity, framing. They say nothing about whether the
 * garment looks like the right garment — identity, colour fidelity to the
 * reference, and "is the collar inside out" still need eyes or a VLM judge.
 *
 * Known confound, worth reading before trusting a number: `wrinkleEnergy`
 * measures high-frequency luma detail inside the garment, and a large printed
 * logo or a bold stripe boundary raises it the same way a crease does. It is
 * therefore only comparable *across renders of the same garment*, which is
 * exactly the bakeoff case. Do not compare a printed tee to a plain one.
 */

/** Packed 8-bit RGB, 3 bytes per pixel, row-major. */
export type RgbImage = {
  data: Uint8Array;
  width: number;
  height: number;
};

export type ForegroundMask = {
  /** 1 = garment, 0 = background. Length width*height. */
  mask: Uint8Array;
  /** Fraction of the frame occupied by the garment, 0..1. */
  coverage: number;
  /** Tight bounds of the garment, or null when nothing was found. */
  bbox: { x0: number; y0: number; x1: number; y1: number } | null;
};

export type WrinkleStats = {
  /** Mean |Laplacian| over interior garment pixels, in 0..1 luma units. */
  mean: number;
  /** 90th percentile — catches localised crumpling a mean would average away. */
  p90: number;
  /** Interior pixels actually measured. Small counts mean an unreliable score. */
  samples: number;
};

export type ExposureStats = {
  /** Mean luma of the garment, 0..255. */
  meanLuma: number;
  /** 95th-percentile luma — how bright the bright parts get. */
  p95Luma: number;
  /** Fraction of garment pixels at/above `clipLevel` in all channels, 0..1. */
  clippedRatio: number;
  /** Mean (max-min) channel spread — a saturation proxy that needs no HSV. */
  meanSaturation: number;
};

export type BackgroundStats = {
  /** Mean distance below pure white across background pixels, 0..255. */
  meanDeviation: number;
  /** Worst single background pixel's distance below white, 0..255. */
  maxDeviation: number;
  /** Fraction of background pixels more than `tolerance` off white, 0..1. */
  offWhiteRatio: number;
  samples: number;
};

export type FramingStats = {
  /** Garment bbox area as a fraction of the frame, 0..1. */
  fillRatio: number;
  /** Horizontal bbox-centre offset from frame centre, in frame widths. */
  centerOffsetX: number;
  /** Vertical bbox-centre offset from frame centre, in frame heights. */
  centerOffsetY: number;
  /** IoU of the garment mask against its own mirror, 0..1. 1 = symmetric. */
  symmetry: number;
};

export type CatalogImageReport = {
  coverage: number;
  wrinkle: WrinkleStats;
  exposure: ExposureStats;
  background: BackgroundStats;
  framing: FramingStats;
};

export type ScoreOptions = {
  /** Per-channel tolerance when flood-filling the sampled background colour. */
  backgroundFloodTolerance?: number;
  /** Channel value at/above which a garment pixel counts as clipped. */
  clipLevel?: number;
  /** Background deviation beyond this counts as off-white / shadowed. */
  backgroundTolerance?: number;
  /** Erosion radius for wrinkle sampling, in pixels. */
  erodeRadius?: number;
};

const DEFAULTS = {
  backgroundFloodTolerance: 12,
  clipLevel: 252,
  backgroundTolerance: 6,
  erodeRadius: 3,
} as const;

function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function median(values: number[]): number {
  if (values.length === 0) return 255;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/**
 * Estimate the background colour from the four corners.
 *
 * Assuming white here would be a bug: a render with a strong cream or grey cast
 * falls outside any near-white gate, so the flood fill would never claim it as
 * background and `backgroundPurity` would measure an empty set — reporting a
 * *perfect* background for the exact renders whose background is worst. Sample
 * the actual colour, then measure how far off white it is.
 */
export function sampleBackgroundColor(img: RgbImage): [number, number, number] {
  const { data, width: w, height: h } = img;
  const patch = Math.max(1, Math.round(Math.min(w, h) * 0.02));
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const corners: Array<[number, number]> = [
    [0, 0],
    [w - patch, 0],
    [0, h - patch],
    [w - patch, h - patch],
  ];
  for (const [cx, cy] of corners) {
    for (let y = cy; y < cy + patch && y < h; y++) {
      for (let x = cx; x < cx + patch && x < w; x++) {
        const i = (y * w + x) * 3;
        rs.push(data[i]!);
        gs.push(data[i + 1]!);
        bs.push(data[i + 2]!);
      }
    }
  }
  return [median(rs), median(gs), median(bs)];
}

/**
 * Classify background as pixels matching the sampled background colour and
 * *connected to the frame border*, rather than every pixel of that colour.
 *
 * Connectivity matters for white and cream garments: a plain white tee is
 * near-white everywhere, so a colour test alone would classify the garment as
 * background and every downstream metric would read from an empty set.
 * Flood-filling from the border keeps interior whites — the tee, a collar
 * lining — as foreground. Same reasoning as the contiguous mode of the
 * paint-bucket whitener.
 *
 * Limitation: if the garment runs off the edge of the frame it will be reached
 * by the fill and eaten. That shows up as near-zero `coverage`, which trips the
 * `empty-frame` flag rather than silently skewing the other metrics.
 */
export function foregroundMask(img: RgbImage, opts: ScoreOptions = {}): ForegroundMask {
  const tol = opts.backgroundFloodTolerance ?? DEFAULTS.backgroundFloodTolerance;
  const { data, width: w, height: h } = img;
  const total = w * h;
  if (total === 0) return { mask: new Uint8Array(0), coverage: 0, bbox: null };

  const [br, bg, bb] = sampleBackgroundColor(img);
  const isNearWhite = (p: number) => {
    const i = p * 3;
    return (
      Math.abs(data[i]! - br) <= tol &&
      Math.abs(data[i + 1]! - bg) <= tol &&
      Math.abs(data[i + 2]! - bb) <= tol
    );
  };

  // BFS from every near-white border pixel. Uint8Array queue would overflow;
  // Int32Array holds pixel indices for images up to 2^31 px.
  const isBackground = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  const push = (p: number) => {
    if (isBackground[p] || !isNearWhite(p)) return;
    isBackground[p] = 1;
    queue[tail++] = p;
  };

  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + (w - 1));
  }

  while (head < tail) {
    const p = queue[head++]!;
    const x = p % w;
    const y = (p - x) / w;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (y > 0) push(p - w);
    if (y < h - 1) push(p + w);
  }

  const mask = new Uint8Array(total);
  let count = 0;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let p = 0; p < total; p++) {
    if (isBackground[p]) continue;
    mask[p] = 1;
    count++;
    const x = p % w;
    const y = (p - x) / w;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }

  return {
    mask,
    coverage: count / total,
    bbox: x1 < 0 ? null : { x0, y0, x1, y1 },
  };
}

/** Shrink a mask by `radius` using a chebyshev-neighbourhood erosion. */
export function erodeMask(
  mask: Uint8Array,
  w: number,
  h: number,
  radius: number,
): Uint8Array {
  if (radius <= 0) return mask;
  let current = mask;
  for (let step = 0; step < radius; step++) {
    const next = new Uint8Array(current.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (!current[p]) continue;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) continue;
        if (
          current[p - 1] &&
          current[p + 1] &&
          current[p - w] &&
          current[p + w]
        ) {
          next[p] = 1;
        }
      }
    }
    current = next;
  }
  return current;
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[idx]!;
}

/**
 * High-frequency luma energy inside the garment — the thing that actually reads
 * as "wrinkly". Smooth pressed fabric has near-zero Laplacian; creases,
 * crumpling and crease shadows all raise it.
 *
 * The mask is eroded first because the garment silhouette is by far the
 * strongest edge in the frame. Measured un-eroded, the outline dominates and
 * the score barely moves when the fabric changes.
 */
export function wrinkleEnergy(
  img: RgbImage,
  mask: Uint8Array,
  opts: ScoreOptions = {},
): WrinkleStats {
  const radius = opts.erodeRadius ?? DEFAULTS.erodeRadius;
  const { data, width: w, height: h } = img;
  const interior = erodeMask(mask, w, h, radius);

  const values: number[] = [];
  let sum = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      if (!interior[p]) continue;
      const i = p * 3;
      const c = luma(data[i]!, data[i + 1]!, data[i + 2]!);
      const up = (p - w) * 3;
      const dn = (p + w) * 3;
      const lf = (p - 1) * 3;
      const rt = (p + 1) * 3;
      const lap =
        luma(data[up]!, data[up + 1]!, data[up + 2]!) +
        luma(data[dn]!, data[dn + 1]!, data[dn + 2]!) +
        luma(data[lf]!, data[lf + 1]!, data[lf + 2]!) +
        luma(data[rt]!, data[rt + 1]!, data[rt + 2]!) -
        4 * c;
      const v = Math.abs(lap) / 255;
      values.push(v);
      sum += v;
    }
  }

  if (values.length === 0) return { mean: 0, p90: 0, samples: 0 };
  values.sort((a, b) => a - b);
  return {
    mean: sum / values.length,
    p90: percentile(values, 0.9),
    samples: values.length,
  };
}

/** Exposure and saturation of the garment itself, ignoring the background. */
export function exposureStats(
  img: RgbImage,
  mask: Uint8Array,
  opts: ScoreOptions = {},
): ExposureStats {
  const clipLevel = opts.clipLevel ?? DEFAULTS.clipLevel;
  const { data } = img;
  const lumas: number[] = [];
  let lumaSum = 0;
  let satSum = 0;
  let clipped = 0;

  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue;
    const i = p * 3;
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const l = luma(r, g, b);
    lumas.push(l);
    lumaSum += l;
    satSum += Math.max(r, g, b) - Math.min(r, g, b);
    if (r >= clipLevel && g >= clipLevel && b >= clipLevel) clipped++;
  }

  if (lumas.length === 0) {
    return { meanLuma: 0, p95Luma: 0, clippedRatio: 0, meanSaturation: 0 };
  }
  lumas.sort((a, b) => a - b);
  return {
    meanLuma: lumaSum / lumas.length,
    p95Luma: percentile(lumas, 0.95),
    clippedRatio: clipped / lumas.length,
    meanSaturation: satSum / lumas.length,
  };
}

/**
 * How clean the background is. Catches the grey/cream backgrounds and the
 * contact shadows the prompt forbids — both show up as background pixels
 * measurably below pure white.
 */
export function backgroundPurity(
  img: RgbImage,
  mask: Uint8Array,
  opts: ScoreOptions = {},
): BackgroundStats {
  const tolerance = opts.backgroundTolerance ?? DEFAULTS.backgroundTolerance;
  const { data } = img;
  let sum = 0;
  let max = 0;
  let off = 0;
  let samples = 0;

  for (let p = 0; p < mask.length; p++) {
    if (mask[p]) continue;
    const i = p * 3;
    // Distance below white on the worst channel — a warm cream cast shows up
    // here even when luma alone looks close enough to white.
    const dev = 255 - Math.min(data[i]!, data[i + 1]!, data[i + 2]!);
    sum += dev;
    if (dev > max) max = dev;
    if (dev > tolerance) off++;
    samples++;
  }

  if (samples === 0) {
    return { meanDeviation: 0, maxDeviation: 0, offWhiteRatio: 0, samples: 0 };
  }
  return {
    meanDeviation: sum / samples,
    maxDeviation: max,
    offWhiteRatio: off / samples,
    samples,
  };
}

/** Bbox fill, centring and left/right symmetry of the garment. */
export function framingStats(
  fg: ForegroundMask,
  w: number,
  h: number,
): FramingStats {
  if (!fg.bbox || w === 0 || h === 0) {
    return { fillRatio: 0, centerOffsetX: 0, centerOffsetY: 0, symmetry: 0 };
  }
  const { x0, y0, x1, y1 } = fg.bbox;
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;

  let inter = 0;
  let union = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const a = fg.mask[y * w + x] ?? 0;
      const mirroredX = x1 - (x - x0);
      const b = fg.mask[y * w + mirroredX] ?? 0;
      if (a || b) union++;
      if (a && b) inter++;
    }
  }

  return {
    fillRatio: (bw * bh) / (w * h),
    centerOffsetX: (x0 + x1 + 1) / 2 / w - 0.5,
    centerOffsetY: (y0 + y1 + 1) / 2 / h - 0.5,
    symmetry: union === 0 ? 0 : inter / union,
  };
}

/** Full report for one image. */
export function scoreCatalogImage(
  img: RgbImage,
  opts: ScoreOptions = {},
): CatalogImageReport {
  const fg = foregroundMask(img, opts);
  return {
    coverage: fg.coverage,
    wrinkle: wrinkleEnergy(img, fg.mask, opts),
    exposure: exposureStats(img, fg.mask, opts),
    background: backgroundPurity(img, fg.mask, opts),
    framing: framingStats(fg, img.width, img.height),
  };
}

/**
 * Pass/fail gates. Deliberately loose — these are meant to catch renders that
 * are obviously broken, not to encode taste. Tighten them once a baseline
 * exists for a given garment set.
 */
export const THRESHOLDS = {
  /** Above this, the fabric reads visibly creased. */
  wrinkleMean: 0.02,
  /** Localised crumpling even when the mean looks fine. */
  wrinkleP90: 0.05,
  /** Blown highlights on the garment. */
  clippedRatio: 0.02,
  /** Washed out — the garment is nearly as bright as its background. */
  meanLuma: 225,
  /** Grey/cream cast or a shadow on the background. */
  backgroundOffWhiteRatio: 0.02,
  /** Garment too small in frame, or matting failed and found almost nothing. */
  minCoverage: 0.05,
} as const;

export type Flag =
  | "wrinkly"
  | "wrinkly-local"
  | "blown-highlights"
  | "washed-out"
  | "dirty-background"
  | "empty-frame";

/** Which gates a report trips. Empty array = clean render. */
export function flagsFor(
  report: CatalogImageReport,
  thresholds: typeof THRESHOLDS = THRESHOLDS,
): Flag[] {
  const flags: Flag[] = [];
  if (report.coverage < thresholds.minCoverage) flags.push("empty-frame");
  if (report.wrinkle.mean > thresholds.wrinkleMean) flags.push("wrinkly");
  if (report.wrinkle.p90 > thresholds.wrinkleP90) flags.push("wrinkly-local");
  if (report.exposure.clippedRatio > thresholds.clippedRatio) {
    flags.push("blown-highlights");
  }
  if (report.exposure.meanLuma > thresholds.meanLuma) flags.push("washed-out");
  if (report.background.offWhiteRatio > thresholds.backgroundOffWhiteRatio) {
    flags.push("dirty-background");
  }
  return flags;
}

/**
 * Weights for the composite penalty. Wrinkles and exposure carry the most
 * because they are the two failure modes that survived prompt iteration;
 * adjust as the failure profile changes rather than treating these as fixed.
 */
export const PENALTY_WEIGHTS = {
  wrinkle: 1,
  clipping: 1,
  brightness: 0.6,
  background: 0.8,
  asymmetry: 0.3,
} as const;

/**
 * Single number for ranking variants, lower is better. Each term is normalised
 * against its threshold so a value of 1.0 means "exactly at the gate", making
 * the components readable rather than an opaque blend.
 */
export function penaltyScore(
  report: CatalogImageReport,
  weights: typeof PENALTY_WEIGHTS = PENALTY_WEIGHTS,
): { total: number; terms: Record<keyof typeof PENALTY_WEIGHTS, number> } {
  const terms = {
    wrinkle: report.wrinkle.mean / THRESHOLDS.wrinkleMean,
    clipping: report.exposure.clippedRatio / THRESHOLDS.clippedRatio,
    // Only the excess above the gate counts; a correctly-exposed garment
    // should not accrue brightness penalty just for being light-coloured.
    brightness: Math.max(0, report.exposure.meanLuma - THRESHOLDS.meanLuma) / 30,
    background: report.background.offWhiteRatio / THRESHOLDS.backgroundOffWhiteRatio,
    asymmetry: 1 - report.framing.symmetry,
  };
  const total =
    terms.wrinkle * weights.wrinkle +
    terms.clipping * weights.clipping +
    terms.brightness * weights.brightness +
    terms.background * weights.background +
    terms.asymmetry * weights.asymmetry;
  return { total, terms };
}
