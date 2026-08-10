"use client";

/**
 * Client driver for camera-roll wear inference (docs/OUTFIT_INTELLIGENCE.md §7).
 *
 * Photos in, findings out. Nothing is uploaded: each file is read for its EXIF
 * date, handed to the worker for cropping and embedding, matched against the
 * closet vectors in memory, and then dropped. What eventually reaches the
 * server is a list of item ids, dates and scores.
 *
 * Expect modest precision. Measured top-1 retrieval on studio images is 69.9%,
 * and a worn garment in a household photo is a harder problem than that — which
 * is why every finding lands as a low-confidence wear for the user to confirm
 * rather than as a fact. See lib/wear/photo-match.ts for the numbers.
 */

import { EXIF_HEAD_BYTES, photoDateFromParts, type PhotoDate } from "@/lib/wear/exif";
import { matchPhoto, type ClosetVector, type PhotoMatch } from "@/lib/wear/photo-match";
import type {
  EmbeddingWorkerRequest,
  EmbeddingWorkerResponse,
} from "@/lib/wear/embedding-worker";

export type PhotoFinding = {
  photoName: string;
  date: PhotoDate;
  match: PhotoMatch;
};

export type ScanProgress = { done: number; total: number; found: number };

export type ScanOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: ScanProgress) => void;
};

/**
 * Read only the head of the file for EXIF.
 *
 * A camera roll is easily gigabytes; pulling whole photos into memory to find a
 * 20-byte timestamp would be enough to get a mobile tab killed. Metadata lives
 * in the first APP1 segment, well inside this slice.
 */
async function readDate(file: File): Promise<PhotoDate> {
  try {
    const head = await file.slice(0, EXIF_HEAD_BYTES).arrayBuffer();
    return photoDateFromParts(head, file.lastModified);
  } catch {
    return photoDateFromParts(null, file.lastModified);
  }
}

function createWorker(): Worker {
  return new Worker(new URL("./embedding-worker.ts", import.meta.url), { type: "module" });
}

/**
 * Scan a set of photos against the closet.
 *
 * Sequential rather than parallel: there is one encoder session and one GPU,
 * so concurrency here buys nothing and costs peak memory — the thing most
 * likely to end a scan early on a phone.
 */
export async function scanPhotos(
  files: File[],
  closet: readonly ClosetVector[],
  options: ScanOptions = {},
): Promise<PhotoFinding[]> {
  if (files.length === 0 || closet.length === 0) return [];

  const worker = createWorker();
  const findings: PhotoFinding[] = [];

  try {
    await new Promise<void>((resolve, reject) => {
      let index = 0;
      let processed = 0;

      const abort = () => {
        worker.terminate();
        reject(new DOMException("Aborted", "AbortError"));
      };
      options.signal?.addEventListener("abort", abort, { once: true });

      const next = () => {
        if (index >= files.length) {
          resolve();
          return;
        }
        const file = files[index++];
        void (async () => {
          const request: EmbeddingWorkerRequest = {
            type: "scanPhoto",
            photoId: `${index - 1}`,
            file,
          };
          worker.postMessage(request);
        })();
      };

      worker.addEventListener("message", (event: MessageEvent<EmbeddingWorkerResponse>) => {
        const message = event.data;
        void (async () => {
          try {
            if (message.type === "ready") {
              next();
              return;
            }
            if (message.type === "fatal") {
              reject(new Error(message.error));
              return;
            }

            if (message.type === "scanned") {
              const file = files[Number(message.photoId)];
              const vectors = message.vectors.map((v) => Float32Array.from(v));
              const matches = matchPhoto(vectors, closet);
              if (matches.length > 0) {
                findings.push({
                  photoName: file.name,
                  date: await readDate(file),
                  match: matches[0],
                });
              }
            }
            // "failed" means one unreadable photo — a HEIC the browser can't
            // decode, a truncated file. Skip it and keep going.

            processed += 1;
            options.onProgress?.({
              done: processed,
              total: files.length,
              found: findings.length,
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

    return findings;
  } finally {
    worker.terminate();
  }
}

/**
 * Group findings into one wear per (item, day).
 *
 * Twelve photos from one afternoon are one wearing, not twelve. Without this
 * a single event would inflate `effectiveWears` by an order of magnitude and
 * hand the recurrence model a burst of same-day wears that never happened.
 * Confidence takes the best evidence across the group rather than summing.
 */
export function groupFindingsByDay(
  findings: readonly PhotoFinding[],
): { itemIds: string[]; wornOnISO: string; confidence: number }[] {
  const byKey = new Map<string, { itemId: string; iso: string; confidence: number }>();

  for (const finding of findings) {
    const { itemId, confidence } = finding.match.best;
    const key = `${itemId}|${finding.date.iso}`;
    const existing = byKey.get(key);
    if (!existing || confidence > existing.confidence) {
      byKey.set(key, { itemId, iso: finding.date.iso, confidence });
    }
  }

  // Items seen on the same day are grouped into one event: they were plausibly
  // worn together, which is also what makes the row usable as set-level
  // compatibility evidence once confirmed.
  const byDay = new Map<string, { itemIds: string[]; confidence: number }>();
  for (const entry of byKey.values()) {
    const day = byDay.get(entry.iso);
    if (day) {
      day.itemIds.push(entry.itemId);
      day.confidence = Math.max(day.confidence, entry.confidence);
    } else {
      byDay.set(entry.iso, { itemIds: [entry.itemId], confidence: entry.confidence });
    }
  }

  return [...byDay.entries()]
    .map(([wornOnISO, value]) => ({ wornOnISO, ...value }))
    .sort((a, b) => (a.wornOnISO < b.wornOnISO ? 1 : -1));
}
