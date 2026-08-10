import { describe, expect, it } from "vitest";
import {
  cosineSimilarity,
  decodeEmbedding,
  EMBEDDING_DIMS,
  encodeEmbedding,
  isValidEmbeddingPayload,
  normalizeEmbedding,
} from "@/lib/wear/embedding";

const vec = (values: number[]) => Float32Array.from(values);

describe("embedding codec", () => {
  it("round-trips a vector through bytes", () => {
    const original = vec([0.5, -0.25, 0, 1]);
    const restored = decodeEmbedding(encodeEmbedding(original));
    expect(Array.from(restored)).toEqual([0.5, -0.25, 0, 1]);
  });

  it("uses four bytes per float", () => {
    expect(encodeEmbedding(new Float32Array(EMBEDDING_DIMS)).byteLength).toBe(EMBEDDING_DIMS * 4);
  });

  it("decodes correctly from a view into a larger pooled buffer", () => {
    // Prisma hands back Uint8Arrays that are often views into a shared buffer;
    // reading .buffer without honouring byteOffset returns the wrong slice.
    const original = vec([1, 2, 3, 4]);
    const bytes = encodeEmbedding(original);
    const padded = new Uint8Array(bytes.byteLength + 8);
    padded.set(bytes, 8);
    const view = padded.subarray(8);
    expect(Array.from(decodeEmbedding(view))).toEqual([1, 2, 3, 4]);
  });

  it("rejects a byte length that is not a whole number of floats", () => {
    expect(() => decodeEmbedding(new Uint8Array(7))).toThrow(/multiple of 4/);
  });

  it("survives a little-endian round trip for negative and fractional values", () => {
    const original = vec([-1.5, 0.125, -0.0625, 3.25]);
    expect(Array.from(decodeEmbedding(encodeEmbedding(original)))).toEqual([
      -1.5, 0.125, -0.0625, 3.25,
    ]);
  });
});

describe("normalizeEmbedding", () => {
  it("scales to unit length", () => {
    const normalized = normalizeEmbedding(vec([3, 4]));
    expect(normalized[0]).toBeCloseTo(0.6, 6);
    expect(normalized[1]).toBeCloseTo(0.8, 6);
  });

  it("leaves a zero vector alone instead of producing NaNs", () => {
    // NaNs here would propagate silently through every score they touch.
    const normalized = normalizeEmbedding(vec([0, 0, 0]));
    expect(Array.from(normalized)).toEqual([0, 0, 0]);
  });
});

describe("cosineSimilarity", () => {
  it("scores identical directions at 1 and opposite at -1", () => {
    expect(cosineSimilarity(vec([1, 0]), vec([2, 0]))).toBeCloseTo(1, 6);
    expect(cosineSimilarity(vec([1, 0]), vec([-1, 0]))).toBeCloseTo(-1, 6);
  });

  it("scores orthogonal vectors at 0", () => {
    expect(cosineSimilarity(vec([1, 0]), vec([0, 1]))).toBeCloseTo(0, 6);
  });

  it("is unaffected by magnitude, normalized or not", () => {
    const raw = cosineSimilarity(vec([3, 4]), vec([4, 3]));
    const normalized = cosineSimilarity(normalizeEmbedding(vec([3, 4])), normalizeEmbedding(vec([4, 3])));
    expect(raw).toBeCloseTo(normalized, 6);
  });

  it("returns 0 rather than NaN when a vector is empty", () => {
    expect(cosineSimilarity(vec([0, 0]), vec([1, 1]))).toBe(0);
  });

  it("refuses to compare mismatched dimensions", () => {
    expect(() => cosineSimilarity(vec([1, 2]), vec([1, 2, 3]))).toThrow(/dimension mismatch/);
  });
});

describe("isValidEmbeddingPayload", () => {
  it("accepts a well-formed payload", () => {
    expect(isValidEmbeddingPayload(new Uint8Array(EMBEDDING_DIMS * 4), EMBEDDING_DIMS)).toBe(true);
  });

  it("rejects a length that disagrees with the declared dims", () => {
    expect(isValidEmbeddingPayload(new Uint8Array(16), EMBEDDING_DIMS)).toBe(false);
    expect(isValidEmbeddingPayload(new Uint8Array(0), 0)).toBe(false);
  });
});
