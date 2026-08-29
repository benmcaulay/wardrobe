/**
 * Pure geometry for the face gate (docs/CAMERA_ROLL_PERSON_ISOLATION.md §5, Phase 4).
 *
 * No ONNX, no I/O — everything here is a function of numbers, so it can be
 * tested without staging a 38 MB model. The two non-obvious pieces are the
 * similarity transform and why alignment is mandatory rather than a refinement:
 *
 * Immich measured cosine distances of 0.3–0.94 between a hand-cropped face and
 * a landmark-aligned crop *of the same face* — a spread wider than the entire
 * same-person/different-person margin. Feeding an unaligned crop to SFace does
 * not degrade the score, it randomises it. That is why Immich refuses manual
 * boxes outright, and why this file exists instead of a `sharp().extract()`.
 */

export type Point = { x: number; y: number };

export type FaceBox = {
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
  /** Five landmarks in YuNet order: right eye, left eye, nose, right mouth, left mouth. */
  landmarks: Point[];
};

/**
 * ArcFace's canonical 112x112 landmark template.
 *
 * SFace was trained on crops warped onto exactly these coordinates, so they are
 * not tunable — they are part of the model's input contract. YuNet emits its
 * five points in the same order, so the correspondence is index-to-index.
 */
export const ARCFACE_TEMPLATE: readonly Point[] = [
  { x: 38.2946, y: 51.6963 },
  { x: 73.5318, y: 51.5014 },
  { x: 56.0252, y: 71.7366 },
  { x: 41.5493, y: 92.3655 },
  { x: 70.7299, y: 92.2041 },
] as const;

export const FACE_CROP_SIZE = 112;

/** 2x3 affine matrix, row-major: [a, b, tx, c, d, ty]. */
export type Affine = [number, number, number, number, number, number];

/**
 * Least-squares similarity transform (rotation + uniform scale + translation)
 * mapping `from` onto `to` — the Umeyama estimate, restricted to the similarity
 * case so the crop cannot shear or stretch a face into matching the template.
 *
 * Full affine would fit the five points better and embed worse: it would absorb
 * genuine facial geometry, which is the signal, into the warp.
 */
export function similarityTransform(from: readonly Point[], to: readonly Point[]): Affine {
  const n = Math.min(from.length, to.length);
  if (n < 2) throw new Error("similarityTransform needs at least 2 point pairs");

  let fromMeanX = 0;
  let fromMeanY = 0;
  let toMeanX = 0;
  let toMeanY = 0;
  for (let i = 0; i < n; i++) {
    fromMeanX += from[i]!.x;
    fromMeanY += from[i]!.y;
    toMeanX += to[i]!.x;
    toMeanY += to[i]!.y;
  }
  fromMeanX /= n;
  fromMeanY /= n;
  toMeanX /= n;
  toMeanY /= n;

  // Cross-covariance of the centred point sets, plus the source variance that
  // normalises the scale term.
  let sxx = 0;
  let sxy = 0;
  let fromVar = 0;
  for (let i = 0; i < n; i++) {
    const fx = from[i]!.x - fromMeanX;
    const fy = from[i]!.y - fromMeanY;
    const tx = to[i]!.x - toMeanX;
    const ty = to[i]!.y - toMeanY;
    sxx += fx * tx + fy * ty;
    sxy += fx * ty - fy * tx;
    fromVar += fx * fx + fy * fy;
  }

  if (fromVar === 0) {
    // Degenerate: every source point identical. Translate, do not rotate.
    return [1, 0, toMeanX - fromMeanX, 0, 1, toMeanY - fromMeanY];
  }

  const a = sxx / fromVar;
  const b = sxy / fromVar;
  return [
    a,
    -b,
    toMeanX - (a * fromMeanX - b * fromMeanY),
    b,
    a,
    toMeanY - (b * fromMeanX + a * fromMeanY),
  ];
}

/** Invert a 2x3 affine. Throws when the matrix is singular. */
export function invertAffine(m: Affine): Affine {
  const [a, b, tx, c, d, ty] = m;
  const det = a * d - b * c;
  if (det === 0) throw new Error("invertAffine: singular matrix");
  const ia = d / det;
  const ib = -b / det;
  const ic = -c / det;
  const id = a / det;
  return [ia, ib, -(ia * tx + ib * ty), ic, id, -(ic * tx + id * ty)];
}

export function applyAffine(m: Affine, p: Point): Point {
  return { x: m[0] * p.x + m[1] * p.y + m[2], y: m[3] * p.x + m[4] * p.y + m[5] };
}

/**
 * Inverse-warp an RGB buffer into a `size`x`size` crop with bilinear sampling.
 *
 * Iterating over destination pixels and pulling from the source (rather than
 * pushing forward) is what avoids holes when the transform scales up.
 */
export function warpAffineRGB(
  src: Uint8Array | Uint8ClampedArray | Buffer,
  srcWidth: number,
  srcHeight: number,
  forward: Affine,
  size: number = FACE_CROP_SIZE,
): Uint8ClampedArray {
  const inv = invertAffine(forward);
  const out = new Uint8ClampedArray(size * size * 3);

  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      // +0.5 samples the pixel centre; without it the crop drifts half a pixel
      // up-left, which is small but systematic across every face.
      const sx = inv[0] * (dx + 0.5) + inv[1] * (dy + 0.5) + inv[2] - 0.5;
      const sy = inv[3] * (dx + 0.5) + inv[4] * (dy + 0.5) + inv[5] - 0.5;

      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      const di = (dy * size + dx) * 3;

      for (let ch = 0; ch < 3; ch++) {
        const p00 = sampleClamped(src, srcWidth, srcHeight, x0, y0, ch);
        const p10 = sampleClamped(src, srcWidth, srcHeight, x0 + 1, y0, ch);
        const p01 = sampleClamped(src, srcWidth, srcHeight, x0, y0 + 1, ch);
        const p11 = sampleClamped(src, srcWidth, srcHeight, x0 + 1, y0 + 1, ch);
        const top = p00 + (p10 - p00) * fx;
        const bottom = p01 + (p11 - p01) * fx;
        out[di + ch] = top + (bottom - top) * fy;
      }
    }
  }
  return out;
}

/** Edge-clamped pixel fetch, so a face at the frame boundary still warps. */
function sampleClamped(
  src: Uint8Array | Uint8ClampedArray | Buffer,
  width: number,
  height: number,
  x: number,
  y: number,
  channel: number,
): number {
  const cx = x < 0 ? 0 : x >= width ? width - 1 : x;
  const cy = y < 0 ? 0 : y >= height ? height - 1 : y;
  return src[(cy * width + cx) * 3 + channel] ?? 0;
}

export function iou(a: FaceBox, b: FaceBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const iw = x2 - x1;
  const ih = y2 - y1;
  if (iw <= 0 || ih <= 0) return 0;
  const inter = iw * ih;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/** Greedy non-maximum suppression, highest score first. */
export function nms(boxes: FaceBox[], threshold = 0.3): FaceBox[] {
  const sorted = [...boxes].sort((p, q) => q.score - p.score);
  const kept: FaceBox[] = [];
  for (const candidate of sorted) {
    if (kept.every((k) => iou(candidate, k) <= threshold)) kept.push(candidate);
  }
  return kept;
}

/** L2-normalise in place and return, so cosine reduces to a dot product. */
export function l2Normalize(v: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i]! * v[i]!;
  const norm = Math.sqrt(sum);
  if (norm === 0) return v;
  for (let i = 0; i < v.length; i++) v[i] = v[i]! / norm;
  return v;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
