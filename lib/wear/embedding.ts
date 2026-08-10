/**
 * Wire format for item embeddings (docs/OUTFIT_INTELLIGENCE.md §3).
 *
 * Inference runs in the browser, so the client computes a vector and uploads
 * *the vector, not the image*. The server never computes a similarity — it is a
 * sync store that stops a second device re-embedding the whole closet. That is
 * why ItemEmbedding.vector is BYTEA and not pgvector: no extension, no
 * docker-compose change, and 512 float32s is 2 KB.
 *
 * Little-endian float32 is chosen because it is what every platform this runs
 * on is natively, so encode/decode is a memcpy in practice. It is written
 * explicitly rather than relying on platform order so a row written on one
 * device always decodes on another.
 *
 * Deliberately isomorphic — Uint8Array/DataView only, no Buffer — because this
 * module is imported from both the browser worker and server actions.
 */

/** Dimension of the on-device encoder's output (MobileCLIP-S2). */
export const EMBEDDING_DIMS = 512;

/**
 * Encoder identity — model *and* dtype, because quantization changes the space
 * as much as a different architecture would. Vectors from different encoders
 * are not comparable, so bumping this invalidates every stored row:
 * `listItemsNeedingEmbedding` treats a mismatch as "not embedded" and the
 * client recomputes.
 *
 * Was `-int8`, which was both the wrong dtype to ship and — once the encoder
 * moved to fp16 — an actively misleading label: rows from two incompatible
 * spaces would have carried the same identity and never been invalidated.
 * See scripts/benchmark-wear-retrieval.ts for why int8 is not an option.
 */
export const CURRENT_EMBEDDING_MODEL = "mobileclip-s2-fp16";

const BYTES_PER_FLOAT = 4;

export function encodeEmbedding(vector: Float32Array): Uint8Array {
  const bytes = new Uint8Array(vector.length * BYTES_PER_FLOAT);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < vector.length; i += 1) {
    view.setFloat32(i * BYTES_PER_FLOAT, vector[i], true);
  }
  return bytes;
}

export function decodeEmbedding(bytes: Uint8Array): Float32Array {
  if (bytes.byteLength % BYTES_PER_FLOAT !== 0) {
    throw new Error(`Embedding byte length ${bytes.byteLength} is not a multiple of 4`);
  }
  const out = new Float32Array(bytes.byteLength / BYTES_PER_FLOAT);
  // Offset explicitly: a Uint8Array from Prisma may be a view into a larger
  // pooled buffer, and reading bytes.buffer without it returns the wrong slice.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = view.getFloat32(i * BYTES_PER_FLOAT, true);
  }
  return out;
}

/**
 * Scale to unit length so downstream similarity is a plain dot product.
 * Vectors are stored normalized; a zero vector is returned unchanged rather
 * than producing NaNs that would silently poison every score it touches.
 */
export function normalizeEmbedding(vector: Float32Array): Float32Array {
  let sumSquares = 0;
  for (let i = 0; i < vector.length; i += 1) sumSquares += vector[i] * vector[i];
  if (sumSquares === 0) return vector;
  const inverse = 1 / Math.sqrt(sumSquares);
  const out = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i += 1) out[i] = vector[i] * inverse;
  return out;
}

/**
 * Cosine similarity. Normalizes defensively rather than trusting the caller —
 * an un-normalized vector sneaking in produces plausible-looking but wrong
 * scores, which is far worse than the handful of extra multiplications.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Embedding dimension mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let aSquares = 0;
  let bSquares = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    aSquares += a[i] * a[i];
    bSquares += b[i] * b[i];
  }
  if (aSquares === 0 || bSquares === 0) return 0;
  return dot / Math.sqrt(aSquares * bSquares);
}

/** Reject malformed uploads before they reach the database. */
export function isValidEmbeddingPayload(bytes: Uint8Array, dims: number): boolean {
  return (
    Number.isInteger(dims) &&
    dims > 0 &&
    dims <= 4096 &&
    bytes.byteLength === dims * BYTES_PER_FLOAT
  );
}
