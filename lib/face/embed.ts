/**
 * SFace embedding (Apache-2.0, OpenCV Zoo) for the Mode B reference gate.
 *
 * SFace and not ArcFace/`buffalo_l`: InsightFace's *code* is MIT but its
 * pretrained models are "available for non-commercial research purposes only",
 * and this project intends to go commercial. See
 * docs/CAMERA_ROLL_PERSON_ISOLATION.md §0 for the licence-clean stack and the
 * accuracy that choice costs.
 *
 * Every vector produced here is transient. Nothing in this module writes.
 */

import sharp from "sharp";
import type { InferenceSession, Tensor } from "onnxruntime-node";
import { log } from "@/lib/log";
import { faceModelPath } from "./models";
import {
  ARCFACE_TEMPLATE,
  FACE_CROP_SIZE,
  l2Normalize,
  similarityTransform,
  warpAffineRGB,
  type FaceBox,
} from "./geometry";

let sessionPromise: Promise<InferenceSession> | null = null;

async function getSession(): Promise<InferenceSession> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const ort = await import("onnxruntime-node");
      return ort.InferenceSession.create(faceModelPath("sface.onnx"), {
        graphOptimizationLevel: "all",
        logSeverityLevel: 4,
      });
    })().catch((err) => {
      sessionPromise = null;
      throw err;
    });
  }
  return sessionPromise;
}

/** Decoded once per photo and reused across every face in it. */
export type DecodedImage = { rgb: Buffer; width: number; height: number };

export async function decodeImage(imageBuffer: Buffer): Promise<DecodedImage> {
  const { data, info } = await sharp(imageBuffer)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { rgb: data, width: info.width, height: info.height };
}

/**
 * Landmark-align a face onto ArcFace's canonical 112x112 template.
 *
 * Not optional. Immich measured cosine distances of 0.3–0.94 between a manually
 * cropped face and an aligned crop of the *same* face — wider than the entire
 * same/different-person margin — which is why they refuse hand-drawn boxes.
 */
export function alignFace(image: DecodedImage, face: FaceBox): Uint8ClampedArray {
  const transform = similarityTransform(face.landmarks, ARCFACE_TEMPLATE);
  return warpAffineRGB(image.rgb, image.width, image.height, transform, FACE_CROP_SIZE);
}

/**
 * Embed aligned crops in one batch.
 *
 * SFace takes NCHW BGR at 0-255, matching how OpenCV feeds it. The returned
 * vectors are L2-normalised so downstream cosine is a dot product.
 */
export async function embedAlignedFaces(
  crops: readonly Uint8ClampedArray[],
): Promise<Float32Array[]> {
  if (crops.length === 0) return [];

  const [session, ort] = await Promise.all([getSession(), import("onnxruntime-node")]);
  const plane = FACE_CROP_SIZE * FACE_CROP_SIZE;
  const out: Float32Array[] = [];

  for (const crop of crops) {
    const data = new Float32Array(3 * plane);
    for (let i = 0; i < plane; i++) {
      data[i] = crop[i * 3 + 2]!; // B
      data[plane + i] = crop[i * 3 + 1]!; // G
      data[2 * plane + i] = crop[i * 3]!; // R
    }
    const tensor = new ort.Tensor("float32", data, [1, 3, FACE_CROP_SIZE, FACE_CROP_SIZE]);
    const result = (await session.run({ [session.inputNames[0]!]: tensor })) as unknown as Record<
      string,
      Tensor
    >;
    const vec = result[session.outputNames[0]!]?.data as Float32Array | undefined;
    if (!vec) continue;
    out.push(l2Normalize(Float32Array.from(vec)));
  }
  return out;
}

/** Detect-align-embed for one image buffer. Returns [] on any failure. */
export async function embedFacesInImage(
  imageBuffer: Buffer,
  faces: readonly FaceBox[],
): Promise<Float32Array[]> {
  if (faces.length === 0) return [];
  try {
    const image = await decodeImage(imageBuffer);
    return await embedAlignedFaces(faces.map((f) => alignFace(image, f)));
  } catch (err) {
    log.error("face.embed.failed", err);
    return [];
  }
}
