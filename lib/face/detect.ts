/**
 * YuNet face detection (MIT, OpenCV Zoo) in the Node job worker.
 *
 * Server-side rather than in the browser, for three reasons: the photos are
 * already uploaded to S3 by `uploadScanBatch` before a scan starts, so this
 * adds no new exposure; there is no ~100 MB iOS Safari page budget here; and
 * `onnxruntime-web@1.26.0-dev` ships only threaded/JSEP WASM variants, so the
 * documented transformers.js #1242 workaround is unavailable to us anyway.
 *
 * The model emits raw per-stride heads and does its post-processing in OpenCV's
 * C++. We are not linking OpenCV, so the anchor decode and NMS live here.
 */

import sharp from "sharp";
import type { InferenceSession, Tensor } from "onnxruntime-node";
import { log } from "@/lib/log";
import { faceModelPath } from "./models";
import { nms, type FaceBox, type Point } from "./geometry";

/** YuNet's three output strides; each has its own cls/obj/bbox/kps head. */
const STRIDES = [8, 16, 32] as const;

/**
 * Detector input size. YuNet is fully convolutional so this is a speed/recall
 * dial, not a fixed contract: bigger finds smaller faces and costs more.
 * 320x320 is OpenCV's default and misses faces below roughly 10 px.
 */
export const DETECT_SIZE = 640;

/**
 * Minimum detection score. OpenCV's default is 0.9 and its docs call that
 * "already biased toward precision"; we keep it, because a false face becomes a
 * garment filed under the wrong person.
 */
export const MIN_FACE_SCORE = 0.9;

const NMS_IOU = 0.3;

let sessionPromise: Promise<InferenceSession> | null = null;

async function getSession(): Promise<InferenceSession> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const ort = await import("onnxruntime-node");
      return ort.InferenceSession.create(faceModelPath("yunet.onnx"), {
        graphOptimizationLevel: "all",
        logSeverityLevel: 4,
      });
    })().catch((err) => {
      // Reset so a transient failure (missing artifact, cold FS) can retry.
      sessionPromise = null;
      throw err;
    });
  }
  return sessionPromise;
}

export type DetectedFace = FaceBox & {
  /** Box area in original-image pixels, used to pick the photo's main subject. */
  area: number;
};

/** Decoded RGB plane plus the scale factors back to original coordinates. */
type Prepared = {
  rgb: Buffer;
  width: number;
  height: number;
  origWidth: number;
  origHeight: number;
};

async function prepare(imageBuffer: Buffer): Promise<Prepared> {
  const meta = await sharp(imageBuffer).metadata();
  const origWidth = meta.width ?? DETECT_SIZE;
  const origHeight = meta.height ?? DETECT_SIZE;
  // `fit: "fill"` rather than letterboxing: YuNet's decode assumes the grid
  // covers the whole input, and undoing letterbox padding is one more place to
  // get an off-by-one wrong. Anisotropic scale is corrected on the way out.
  const { data } = await sharp(imageBuffer)
    .removeAlpha()
    .resize(DETECT_SIZE, DETECT_SIZE, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { rgb: data, width: DETECT_SIZE, height: DETECT_SIZE, origWidth, origHeight };
}

/**
 * Pack HWC RGB bytes into the NCHW BGR float tensor YuNet expects.
 *
 * OpenCV feeds this model BGR, unnormalised (0-255). Getting either wrong
 * yields plausible-looking garbage rather than an error.
 */
function toInputTensor(TensorCtor: typeof Tensor, p: Prepared): Tensor {
  const { rgb, width, height } = p;
  const plane = width * height;
  const data = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    data[i] = rgb[i * 3 + 2]!; // B
    data[plane + i] = rgb[i * 3 + 1]!; // G
    data[2 * plane + i] = rgb[i * 3]!; // R
  }
  return new TensorCtor("float32", data, [1, 3, height, width]);
}

function head(results: Record<string, Tensor>, name: string): Float32Array {
  const t = results[name];
  if (!t) throw new Error(`YuNet output missing: ${name}`);
  return t.data as Float32Array;
}

/**
 * Decode one stride's heads into boxes in detector-input coordinates.
 *
 * Mirrors OpenCV's `FaceDetectorYNImpl::postProcess`: anchors are cell origins,
 * boxes are (offset, log-scale) relative to the cell, landmarks are cell-
 * relative offsets, and the score is the geometric mean of the classification
 * and objectness heads.
 */
function decodeStride(
  results: Record<string, Tensor>,
  stride: number,
  inputW: number,
  inputH: number,
): FaceBox[] {
  const cls = head(results, `cls_${stride}`);
  const obj = head(results, `obj_${stride}`);
  const bbox = head(results, `bbox_${stride}`);
  const kps = head(results, `kps_${stride}`);

  const cols = Math.floor(inputW / stride);
  const rows = Math.floor(inputH / stride);
  const out: FaceBox[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const clsScore = Math.min(Math.max(cls[idx] ?? 0, 0), 1);
      const objScore = Math.min(Math.max(obj[idx] ?? 0, 0), 1);
      const score = Math.sqrt(clsScore * objScore);
      if (score < MIN_FACE_SCORE) continue;

      const b = idx * 4;
      const cx = (c + (bbox[b] ?? 0)) * stride;
      const cy = (r + (bbox[b + 1] ?? 0)) * stride;
      const w = Math.exp(bbox[b + 2] ?? 0) * stride;
      const h = Math.exp(bbox[b + 3] ?? 0) * stride;

      const k = idx * 10;
      const landmarks: Point[] = [];
      for (let n = 0; n < 5; n++) {
        landmarks.push({
          x: ((kps[k + 2 * n] ?? 0) + c) * stride,
          y: ((kps[k + 2 * n + 1] ?? 0) + r) * stride,
        });
      }

      out.push({ x: cx - w / 2, y: cy - h / 2, w, h, score, landmarks });
    }
  }
  return out;
}

/** Rescale detector-space geometry back onto the original image. */
function toOriginalScale(box: FaceBox, p: Prepared): DetectedFace {
  const sx = p.origWidth / p.width;
  const sy = p.origHeight / p.height;
  const scaled: FaceBox = {
    x: box.x * sx,
    y: box.y * sy,
    w: box.w * sx,
    h: box.h * sy,
    score: box.score,
    landmarks: box.landmarks.map((l) => ({ x: l.x * sx, y: l.y * sy })),
  };
  return { ...scaled, area: scaled.w * scaled.h };
}

/**
 * Every face in one photo, in original-image coordinates, strongest first.
 *
 * Returns [] rather than throwing on a decode failure: one unreadable photo in
 * a roll must not abort the scan.
 */
export async function detectFaces(imageBuffer: Buffer): Promise<DetectedFace[]> {
  try {
    const [session, ort, prepared] = await Promise.all([
      getSession(),
      import("onnxruntime-node"),
      prepare(imageBuffer),
    ]);

    const input = toInputTensor(ort.Tensor, prepared);
    const results = (await session.run({ [session.inputNames[0]!]: input })) as unknown as Record<
      string,
      Tensor
    >;

    const raw = STRIDES.flatMap((stride) =>
      decodeStride(results, stride, prepared.width, prepared.height),
    );
    return nms(raw, NMS_IOU)
      .map((b) => toOriginalScale(b, prepared))
      .sort((a, b) => b.score - a.score);
  } catch (err) {
    log.error("face.detect.failed", err);
    return [];
  }
}
