/**
 * Web Worker that runs the on-device encoder.
 *
 * Embedding a closet is tens of seconds of solid compute. On the main thread
 * that is a frozen UI and, on mobile, a browser that starts killing the tab.
 * The worker also keeps the ONNX session off the render path entirely, so a
 * navigation mid-scan doesn't tear down a half-initialised runtime.
 *
 * Instantiated by lib/wear/embedding-sync.ts — not imported directly.
 */

import { RawImage } from "@huggingface/transformers";
import { embedImage, loadEncoder } from "@/lib/wear/encoder";
import { cropWindows } from "@/lib/wear/photo-match";

export type EmbeddingWorkerRequest =
  | { type: "warmup" }
  | { type: "embed"; itemId: string; url: string }
  /** A camera-roll photo. The File is transferred, never uploaded. */
  | { type: "scanPhoto"; photoId: string; file: File };

export type EmbeddingWorkerResponse =
  | { type: "ready"; backend: string }
  | { type: "embedded"; itemId: string; vector: number[] }
  /** One vector per crop window; matching happens on the main thread. */
  | { type: "scanned"; photoId: string; vectors: number[][] }
  | { type: "failed"; itemId: string; error: string }
  | { type: "fatal"; error: string };

const post = (message: EmbeddingWorkerResponse) => self.postMessage(message);

/** Encoder input size — matching the processor avoids a second resample. */
const CROP_PX = 256;

/**
 * Embed each crop window of a photo.
 *
 * No garment detector is staged, so localization is a handful of overlapping
 * windows (see `cropWindows`). Every window is a full encoder pass, which is
 * why the list is short: on a phone this is the difference between a scan that
 * finishes and one that cooks the battery.
 *
 * Decoding and cropping happen here in the worker via OffscreenCanvas, so a
 * large photo never crosses to the main thread and the UI stays responsive.
 */
async function embedCrops(file: File): Promise<number[][]> {
  const bitmap = await createImageBitmap(file);
  const canvas = new OffscreenCanvas(CROP_PX, CROP_PX);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("OffscreenCanvas 2D context unavailable");

  const out: number[][] = [];
  try {
    for (const window of cropWindows()) {
      const sx = Math.round(window.x * bitmap.width);
      const sy = Math.round(window.y * bitmap.height);
      const sw = Math.max(1, Math.round(window.w * bitmap.width));
      const sh = Math.max(1, Math.round(window.h * bitmap.height));

      ctx.clearRect(0, 0, CROP_PX, CROP_PX);
      ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, CROP_PX, CROP_PX);

      const { data } = ctx.getImageData(0, 0, CROP_PX, CROP_PX);
      // RGBA → RGB: the processor expects three channels, and an alpha plane
      // would be read as image content.
      const rgb = new Uint8ClampedArray(CROP_PX * CROP_PX * 3);
      for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
        rgb[j] = data[i];
        rgb[j + 1] = data[i + 1];
        rgb[j + 2] = data[i + 2];
      }

      const image = new RawImage(rgb, CROP_PX, CROP_PX, 3);
      out.push(Array.from(await embedImage(image)));
    }
  } finally {
    // Bitmaps hold decoded pixels; a few unreleased full-resolution photos is
    // enough to get a mobile tab killed mid-scan.
    bitmap.close();
  }
  return out;
}

self.addEventListener("message", async (event: MessageEvent<EmbeddingWorkerRequest>) => {
  const request = event.data;

  try {
    if (request.type === "warmup") {
      const { backend } = await loadEncoder();
      post({ type: "ready", backend });
      return;
    }

    if (request.type === "scanPhoto") {
      try {
        post({
          type: "scanned",
          photoId: request.photoId,
          vectors: await embedCrops(request.file),
        });
      } catch (error) {
        post({
          type: "failed",
          itemId: request.photoId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    if (request.type === "embed") {
      try {
        const vector = await embedImage(request.url);
        // Structured clone can't send a Float32Array view cheaply without
        // transferring its buffer, and the buffer is reused downstream — a
        // plain array is a few extra KB and avoids a detached-buffer bug.
        post({ type: "embedded", itemId: request.itemId, vector: Array.from(vector) });
      } catch (error) {
        // One unreadable image (deleted upload, broken re-encode) must not kill
        // the run — the driver records the failure and moves to the next item.
        post({
          type: "failed",
          itemId: request.itemId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } catch (error) {
    // Anything escaping the per-item guard is a broken encoder, not a broken
    // image: the runtime failed to init, or the staged weights are wrong.
    post({ type: "fatal", error: error instanceof Error ? error.message : String(error) });
  }
});
