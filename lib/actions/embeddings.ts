"use server";

/**
 * Sync path for on-device item embeddings (docs/OUTFIT_INTELLIGENCE.md §3).
 *
 * The browser computes vectors; the server only stores them. It never runs the
 * encoder and never computes a similarity — this exists so a second device
 * doesn't have to re-embed the whole closet, and so backup/restore has
 * something to carry.
 *
 * Vectors arrive as plain number[] rather than base64. It is roughly 3× the
 * bytes on the wire, which at 512 floats is nothing, and it keeps a single
 * float→bytes implementation (lib/wear/embedding.ts) instead of a base64 codec
 * that has to behave identically in a browser worker and in Node.
 */

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  CURRENT_EMBEDDING_MODEL,
  EMBEDDING_DIMS,
  encodeEmbedding,
  normalizeEmbedding,
} from "@/lib/wear/embedding";

export type EmbeddingSyncResponse = { ok: true; stored: number } | { ok: false; error: string };

export type PendingEmbedding = {
  itemId: string;
  /** Ghost image when available — a cleanly-cut garment embeds better than a
   *  catalogue shot full of background, and most items have one by now. */
  imagePath: string;
};

/**
 * Items whose embedding is missing or was produced by a superseded encoder.
 * The client worker walks this list and posts results back in batches.
 */
export async function listItemsNeedingEmbedding(limit = 200): Promise<PendingEmbedding[]> {
  const user = await requireUser();

  const items = await prisma.wardrobeItem.findMany({
    where: {
      userId: user.id,
      OR: [{ embedding: { is: null } }, { embedding: { model: { not: CURRENT_EMBEDDING_MODEL } } }],
    },
    select: { id: true, originalImagePath: true, ghostImagePath: true },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 500),
  });

  return items.map((item) => ({
    itemId: item.id,
    imagePath: item.ghostImagePath ?? item.originalImagePath,
  }));
}

export type EmbeddingUpload = { itemId: string; vector: number[] };

/**
 * Store a batch of client-computed vectors.
 *
 * Rejects the whole batch on a malformed entry rather than storing what it can:
 * a wrong-length or non-finite vector means the client encoder is broken, and
 * silently persisting the good half would leave a closet scored against a mix
 * of working and missing embeddings — which degrades quietly instead of
 * failing loudly.
 */
export async function saveItemEmbeddings(
  uploads: EmbeddingUpload[],
): Promise<EmbeddingSyncResponse> {
  const user = await requireUser();
  if (uploads.length === 0) return { ok: true, stored: 0 };
  if (uploads.length > 500) return { ok: false, error: "Batch too large" };

  for (const upload of uploads) {
    if (upload.vector.length !== EMBEDDING_DIMS) {
      return { ok: false, error: `Expected ${EMBEDDING_DIMS} dims for ${upload.itemId}` };
    }
    if (!upload.vector.every((value) => Number.isFinite(value))) {
      return { ok: false, error: `Non-finite value in vector for ${upload.itemId}` };
    }
  }

  const itemIds = uploads.map((upload) => upload.itemId);
  const owned = new Set(
    (
      await prisma.wardrobeItem.findMany({
        where: { id: { in: itemIds }, userId: user.id },
        select: { id: true },
      })
    ).map((item) => item.id),
  );

  const writable = uploads.filter((upload) => owned.has(upload.itemId));
  if (writable.length === 0) return { ok: true, stored: 0 };

  await prisma.$transaction(
    writable.map((upload) => {
      // Normalize on write so every reader can treat similarity as a dot
      // product without re-checking, and so a client that forgets to normalize
      // can't skew scores against one that doesn't.
      const bytes = encodeEmbedding(normalizeEmbedding(Float32Array.from(upload.vector)));
      const vector = Buffer.from(bytes);
      return prisma.itemEmbedding.upsert({
        where: { itemId: upload.itemId },
        create: {
          itemId: upload.itemId,
          vector,
          dims: EMBEDDING_DIMS,
          model: CURRENT_EMBEDDING_MODEL,
        },
        update: { vector, dims: EMBEDDING_DIMS, model: CURRENT_EMBEDDING_MODEL },
      });
    }),
  );

  return { ok: true, stored: writable.length };
}
