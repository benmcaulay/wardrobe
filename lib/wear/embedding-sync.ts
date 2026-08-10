/**
 * Drives the closet through the on-device encoder and syncs the vectors up.
 *
 * Deliberately NOT auto-started. First run pulls ~73 MB of model and ONNX
 * runtime, which is not something to spend on someone's cellular plan without
 * asking — the surface that offers it (Phase 1) decides when and how. This
 * module is the mechanism; the consent is somebody else's call.
 *
 * Everything here is client-only.
 */

"use client";

import { listItemsNeedingEmbedding, saveItemEmbeddings } from "@/lib/actions/embeddings";
import { imageUrl } from "@/lib/image-paths";
import type {
  EmbeddingWorkerRequest,
  EmbeddingWorkerResponse,
} from "@/lib/wear/embedding-worker";

/** Vectors held back before a round trip. Small enough to lose little on a
 *  cancelled run, large enough not to chatter. */
const UPLOAD_BATCH = 25;

export type SyncProgress = {
  done: number;
  total: number;
  failed: number;
  backend?: string;
};

export type SyncOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: SyncProgress) => void;
  /** Proceed even when the connection looks metered. Requires a deliberate
   *  user choice upstream — the default refuses. */
  allowMetered?: boolean;
};

export type SyncResult =
  | { ok: true; embedded: number; failed: number; skipped?: never }
  | { ok: false; skipped: "metered" | "unsupported"; embedded: 0; failed: 0 };

type Connection = { saveData?: boolean; effectiveType?: string };

/**
 * Best-effort metered-connection check. The Network Information API is absent
 * on Safari, so this can only catch the cases it can see — it is a courtesy,
 * not a guarantee, and the caller still owes the user an explicit prompt.
 */
export function looksMetered(): boolean {
  const connection = (navigator as Navigator & { connection?: Connection }).connection;
  if (!connection) return false;
  if (connection.saveData) return true;
  return connection.effectiveType === "slow-2g" || connection.effectiveType === "2g";
}

function createWorker(): Worker {
  return new Worker(new URL("./embedding-worker.ts", import.meta.url), { type: "module" });
}

/**
 * Embed every item missing a current-model vector, uploading in batches.
 *
 * Resumable by construction: `listItemsNeedingEmbedding` is the queue, and an
 * item leaves it only once its vector is stored. An abort mid-run costs at most
 * the current batch, and the next call picks up exactly where this stopped.
 */
export async function runEmbeddingSync(options: SyncOptions = {}): Promise<SyncResult> {
  if (typeof Worker === "undefined") {
    return { ok: false, skipped: "unsupported", embedded: 0, failed: 0 };
  }
  if (!options.allowMetered && looksMetered()) {
    return { ok: false, skipped: "metered", embedded: 0, failed: 0 };
  }

  const pending = await listItemsNeedingEmbedding();
  if (pending.length === 0) return { ok: true, embedded: 0, failed: 0 };

  const worker = createWorker();
  let embedded = 0;
  let failed = 0;
  let batch: { itemId: string; vector: number[] }[] = [];

  const flush = async () => {
    if (batch.length === 0) return;
    const outgoing = batch;
    batch = [];
    const response = await saveItemEmbeddings(outgoing);
    if (!response.ok) throw new Error(response.error);
  };

  try {
    await new Promise<void>((resolve, reject) => {
      let index = 0;
      let backend: string | undefined;

      const abort = () => {
        worker.terminate();
        reject(new DOMException("Aborted", "AbortError"));
      };
      options.signal?.addEventListener("abort", abort, { once: true });

      const next = () => {
        if (index >= pending.length) {
          resolve();
          return;
        }
        const item = pending[index++];
        const request: EmbeddingWorkerRequest = {
          type: "embed",
          itemId: item.itemId,
          url: imageUrl(item.imagePath),
        };
        worker.postMessage(request);
      };

      worker.addEventListener("message", (event: MessageEvent<EmbeddingWorkerResponse>) => {
        const message = event.data;

        void (async () => {
          try {
            if (message.type === "ready") {
              backend = message.backend;
              options.onProgress?.({ done: 0, total: pending.length, failed: 0, backend });
              next();
              return;
            }

            if (message.type === "fatal") {
              reject(new Error(message.error));
              return;
            }

            if (message.type === "embedded") {
              batch.push({ itemId: message.itemId, vector: message.vector });
              embedded += 1;
              if (batch.length >= UPLOAD_BATCH) await flush();
            } else {
              failed += 1;
            }

            options.onProgress?.({
              done: embedded + failed,
              total: pending.length,
              failed,
              backend,
            });
            next();
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        })();
      });

      worker.addEventListener("error", (event) => reject(new Error(event.message)));
      worker.postMessage({ type: "warmup" } satisfies EmbeddingWorkerRequest);
    });

    await flush();
    return { ok: true, embedded, failed };
  } finally {
    worker.terminate();
  }
}
