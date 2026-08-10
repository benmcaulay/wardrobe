/**
 * The on-device image encoder (docs/OUTFIT_INTELLIGENCE.md §3).
 *
 * MobileCLIP-S2 vision tower via transformers.js, served entirely from our own
 * origin — `pnpm embedding:fetch` stages the weights into /public/models and
 * the ONNX runtime into /public/ort. Nothing is fetched from a CDN at runtime:
 * a third-party request would leak that this user is scanning and when, which
 * is precisely the property on-device inference was chosen to protect.
 *
 * Browser-only. Importing this from a server component will fail at `env`
 * configuration, deliberately — there is no server-side encoder and a silent
 * fallback to one would quietly undo the privacy guarantee.
 */

import {
  AutoProcessor,
  CLIPVisionModelWithProjection,
  env,
  RawImage,
  type PreTrainedModel,
  type Processor,
} from "@huggingface/transformers";
import { CURRENT_EMBEDDING_MODEL, EMBEDDING_DIMS, normalizeEmbedding } from "@/lib/wear/embedding";

/** Directory name under /public/models — see scripts/fetch-embedding-model.ts. */
const LOCAL_MODEL_ID = "mobileclip-s2";

export type EncoderBackend = "webgpu" | "wasm";

export type EncoderHandle = {
  model: PreTrainedModel;
  processor: Processor;
  backend: EncoderBackend;
};

let handle: Promise<EncoderHandle> | null = null;

function configureEnv(): void {
  // Local only. If a file is missing we want a hard failure at load, not a
  // silent reach for huggingface.co.
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = "/models/";
  if (env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.wasmPaths = "/ort/";
    // Threads need cross-origin isolation (COOP/COEP), which this app does not
    // set — and enabling it would break the third-party image and Stripe
    // embeds. Single-threaded is the honest default; see the note in §3 about
    // budgeting 5–10× slower on the WASM path.
    env.backends.onnx.wasm.numThreads = 1;
  }
}

async function hasWebGPU(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    return (await gpu.requestAdapter()) != null;
  } catch {
    return false;
  }
}

/**
 * Load the encoder once per page. Concurrent callers share the same promise, so
 * a closet sync and a camera-roll scan starting together don't each pull 37 MB
 * through the ONNX parser.
 */
export function loadEncoder(): Promise<EncoderHandle> {
  if (handle) return handle;

  handle = (async () => {
    configureEnv();

    const backend: EncoderBackend = (await hasWebGPU()) ? "webgpu" : "wasm";
    const processor = await AutoProcessor.from_pretrained(LOCAL_MODEL_ID);

    // fp16, never q8. Measured on 136 real garments, int8 quantization drops
    // top-1 retrieval from 69.9% to 0.7% — chance — with a negative margin
    // between the correct item and the best wrong one. See
    // scripts/benchmark-wear-retrieval.ts. The smaller download is worthless if
    // the vectors it produces can't rank anything.
    let model: PreTrainedModel;
    try {
      model = await CLIPVisionModelWithProjection.from_pretrained(LOCAL_MODEL_ID, {
        dtype: "fp16",
        device: backend,
      });
    } catch {
      // WASM fp16 support varies by ORT build and platform. fp32 is twice the
      // bytes and universally supported; a slow correct encoder beats a fast
      // broken one.
      model = await CLIPVisionModelWithProjection.from_pretrained(LOCAL_MODEL_ID, {
        dtype: "fp32",
        device: backend,
      });
    }

    return { model, processor, backend };
  })().catch((error) => {
    // Don't cache a failed load — a transient fetch error would otherwise
    // poison the encoder for the rest of the session.
    handle = null;
    throw error;
  });

  return handle;
}

export type EncodeSource = string | Blob | RawImage;

async function toRawImage(source: EncodeSource): Promise<RawImage> {
  if (source instanceof RawImage) return source;
  if (typeof source === "string") return RawImage.fromURL(source);
  return RawImage.fromBlob(source);
}

/**
 * Embed one image into a unit-length vector.
 *
 * Normalized here rather than at the call site so every consumer — closet sync,
 * camera-roll matching, redundancy clustering — compares vectors on the same
 * footing and can treat similarity as a plain dot product.
 */
export async function embedImage(source: EncodeSource): Promise<Float32Array> {
  const { model, processor } = await loadEncoder();
  const image = await toRawImage(source);
  const inputs = await processor(image);
  const { image_embeds: embeds } = await model(inputs);

  const vector = Float32Array.from(embeds.data as Iterable<number>);
  if (vector.length !== EMBEDDING_DIMS) {
    // A dimension surprise means the staged weights are not the model this code
    // was written against. Fail loudly: a wrong-width vector would be rejected
    // by the sync action anyway, but far away from the actual cause.
    throw new Error(
      `${CURRENT_EMBEDDING_MODEL} produced ${vector.length} dims, expected ${EMBEDDING_DIMS}`,
    );
  }
  return normalizeEmbedding(vector);
}

/** Embed several images in sequence, yielding to the event loop between each. */
export async function embedImages(
  sources: EncodeSource[],
  onProgress?: (done: number, total: number) => void,
): Promise<Float32Array[]> {
  const out: Float32Array[] = [];
  for (const [index, source] of sources.entries()) {
    out.push(await embedImage(source));
    onProgress?.(index + 1, sources.length);
  }
  return out;
}
