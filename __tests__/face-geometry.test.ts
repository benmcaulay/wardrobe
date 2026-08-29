import { describe, it, expect } from "vitest";
import {
  applyAffine,
  ARCFACE_TEMPLATE,
  cosine,
  invertAffine,
  iou,
  l2Normalize,
  nms,
  similarityTransform,
  warpAffineRGB,
  type FaceBox,
  type Point,
} from "../lib/face/geometry";
import {
  attributeFace,
  attributePhoto,
  buildCentroid,
  buildReferenceSet,
  calibrateThreshold,
  MIN_ACCEPTABLE_THRESHOLD,
  SFACE_COSINE_FALLBACK,
} from "../lib/face/reference";

function box(x: number, y: number, w: number, h: number, score = 0.9): FaceBox {
  return { x, y, w, h, score, landmarks: [] };
}

describe("similarityTransform", () => {
  it("recovers a known rotation + scale + translation exactly", () => {
    // 90° rotation, 2x scale, then shift. A similarity transform must reproduce
    // this with zero residual since the mapping is itself a similarity.
    const from: Point[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ];
    const truth = (p: Point): Point => ({ x: -2 * p.y + 5, y: 2 * p.x - 3 });
    const to = from.map(truth);

    const m = similarityTransform(from, to);
    for (const p of from) {
      const got = applyAffine(m, p);
      const want = truth(p);
      expect(got.x).toBeCloseTo(want.x, 6);
      expect(got.y).toBeCloseTo(want.y, 6);
    }
  });

  it("stays a similarity — no shear, uniform scale", () => {
    const from: Point[] = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 0, y: 2 },
    ];
    // Deliberately anisotropic target: a full affine would fit it, a similarity
    // must not. Uniform scale is what keeps the warp from absorbing real facial
    // geometry into the alignment.
    const to: Point[] = [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 0, y: 2 },
    ];
    const [a, b, , c, d] = similarityTransform(from, to);
    expect(Math.hypot(a, c)).toBeCloseTo(Math.hypot(b, d), 6);
    expect(a).toBeCloseTo(d, 6);
    expect(b).toBeCloseTo(-c, 6);
  });

  it("degrades to translation when every source point is identical", () => {
    const from: Point[] = [
      { x: 3, y: 3 },
      { x: 3, y: 3 },
    ];
    const to: Point[] = [
      { x: 8, y: 1 },
      { x: 8, y: 1 },
    ];
    const got = applyAffine(similarityTransform(from, to), { x: 3, y: 3 });
    expect(got.x).toBeCloseTo(8, 6);
    expect(got.y).toBeCloseTo(1, 6);
  });

  it("maps the ArcFace template onto itself as the identity", () => {
    const m = similarityTransform(ARCFACE_TEMPLATE, ARCFACE_TEMPLATE);
    for (const p of ARCFACE_TEMPLATE) {
      const got = applyAffine(m, p);
      expect(got.x).toBeCloseTo(p.x, 4);
      expect(got.y).toBeCloseTo(p.y, 4);
    }
  });

  it("rejects fewer than two point pairs", () => {
    expect(() => similarityTransform([{ x: 0, y: 0 }], [{ x: 1, y: 1 }])).toThrow();
  });
});

describe("invertAffine", () => {
  it("round-trips a point", () => {
    const m = similarityTransform(
      [
        { x: 0, y: 0 },
        { x: 1, y: 2 },
        { x: 3, y: 1 },
      ],
      [
        { x: 4, y: 4 },
        { x: 6, y: 9 },
        { x: 10, y: 5 },
      ],
    );
    const p = { x: 2.5, y: -1.25 };
    const back = applyAffine(invertAffine(m), applyAffine(m, p));
    expect(back.x).toBeCloseTo(p.x, 6);
    expect(back.y).toBeCloseTo(p.y, 6);
  });

  it("throws on a singular matrix", () => {
    expect(() => invertAffine([0, 0, 0, 0, 0, 0])).toThrow();
  });
});

describe("warpAffineRGB", () => {
  it("copies a flat colour through unchanged", () => {
    const src = new Uint8Array(8 * 8 * 3).fill(200);
    const out = warpAffineRGB(src, 8, 8, [1, 0, 0, 0, 1, 0], 4);
    expect(out).toHaveLength(4 * 4 * 3);
    expect([...out].every((v) => v === 200)).toBe(true);
  });

  it("samples pixel centres, not corners", () => {
    // A 2x2 source with distinct rows warped 1:1 into a 2x2 output must keep the
    // rows in order. A half-pixel error here drifts every aligned face.
    const src = new Uint8Array([
      0, 0, 0, 0, 0, 0, // row 0: black
      255, 255, 255, 255, 255, 255, // row 1: white
    ]);
    const out = warpAffineRGB(src, 2, 2, [1, 0, 0, 0, 1, 0], 2);
    expect(out[0]).toBe(0);
    expect(out[(1 * 2 + 0) * 3]).toBe(255);
  });

  it("clamps at the edges rather than reading out of bounds", () => {
    const src = new Uint8Array(4 * 4 * 3).fill(120);
    // Translate far outside the source; every sample should clamp to an edge
    // pixel, so a face at the frame boundary still produces a usable crop.
    const out = warpAffineRGB(src, 4, 4, [1, 0, -100, 0, 1, -100], 3);
    expect([...out].every((v) => v === 120)).toBe(true);
  });
});

describe("nms", () => {
  it("drops heavily overlapping boxes, keeping the strongest", () => {
    const kept = nms([box(0, 0, 10, 10, 0.8), box(1, 1, 10, 10, 0.95)], 0.3);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.score).toBe(0.95);
  });

  it("keeps genuinely separate faces", () => {
    expect(nms([box(0, 0, 10, 10, 0.9), box(100, 100, 10, 10, 0.9)], 0.3)).toHaveLength(2);
  });

  it("computes iou correctly for a known overlap", () => {
    // Two 10x10 boxes offset by 5: intersection 25, union 175.
    expect(iou(box(0, 0, 10, 10), box(5, 5, 10, 10))).toBeCloseTo(25 / 175, 6);
    expect(iou(box(0, 0, 10, 10), box(50, 50, 10, 10))).toBe(0);
  });
});

describe("l2Normalize and cosine", () => {
  it("normalises to unit length", () => {
    const v = l2Normalize(Float32Array.from([3, 4]));
    expect(Math.hypot(v[0]!, v[1]!)).toBeCloseTo(1, 6);
  });

  it("leaves a zero vector alone instead of dividing by zero", () => {
    const v = l2Normalize(Float32Array.from([0, 0]));
    expect([...v]).toEqual([0, 0]);
  });

  it("scores identical vectors at 1 and orthogonal at 0", () => {
    const a = Float32Array.from([1, 0, 0]);
    expect(cosine(a, Float32Array.from([2, 0, 0]))).toBeCloseTo(1, 6);
    expect(cosine(a, Float32Array.from([0, 5, 0]))).toBeCloseTo(0, 6);
    expect(cosine(a, Float32Array.from([-1, 0, 0]))).toBeCloseTo(-1, 6);
  });
});

describe("reference sets", () => {
  const me = l2Normalize(Float32Array.from([1, 0, 0, 0]));
  const her = l2Normalize(Float32Array.from([0, 1, 0, 0]));

  it("builds a unit-length centroid", () => {
    const c = buildCentroid([Float32Array.from([1, 0]), Float32Array.from([0, 1])])!;
    expect(Math.hypot(c[0]!, c[1]!)).toBeCloseTo(1, 6);
    expect(c[0]).toBeCloseTo(c[1]!, 6);
  });

  it("returns null with no embeddings, so callers fall back rather than crash", () => {
    expect(buildCentroid([])).toBeNull();
    expect(buildReferenceSet("me", [])).toBeNull();
  });

  it("normalises before averaging so one high-norm crop cannot dominate", () => {
    const big = Float32Array.from([100, 0]);
    const small = Float32Array.from([0, 1]);
    const c = buildCentroid([big, small])!;
    expect(c[0]).toBeCloseTo(c[1]!, 6);
  });

  it("falls back to the published threshold with one enrolled person", () => {
    const set = buildReferenceSet("me", [me])!;
    expect(calibrateThreshold([set])).toBe(SFACE_COSINE_FALLBACK);
  });

  it("calibrates between two centroids instead of guessing", () => {
    // Orthogonal centroids: closest similarity 0, midpoint 0.5 — below the
    // 0.593 fallback, which is the point. Two people give a measured boundary.
    const sets = [buildReferenceSet("me", [me])!, buildReferenceSet("her", [her])!];
    expect(calibrateThreshold(sets)).toBeCloseTo(0.5, 6);
  });

  it("never calibrates below the safety floor for lookalikes", () => {
    // Near-identical centroids would push the midpoint toward 1.0, not down —
    // the floor guards the opposite case where the maths goes slack.
    const a = l2Normalize(Float32Array.from([1, 0]));
    const b = l2Normalize(Float32Array.from([-1, 0]));
    const sets = [buildReferenceSet("me", [a])!, buildReferenceSet("her", [b])!];
    expect(calibrateThreshold(sets)).toBeGreaterThanOrEqual(MIN_ACCEPTABLE_THRESHOLD);
  });

  it("attributes a face to the closest owner above threshold", () => {
    const sets = [buildReferenceSet("me", [me])!, buildReferenceSet("her", [her])!];
    const v = attributeFace(me, sets, 0.5);
    expect(v.ownerId).toBe("me");
    expect(v.similarity).toBeCloseTo(1, 5);
  });

  it("rejects a stranger rather than assigning the least-bad owner", () => {
    const sets = [buildReferenceSet("me", [me])!, buildReferenceSet("her", [her])!];
    const stranger = l2Normalize(Float32Array.from([0, 0, 1, 0]));
    expect(attributeFace(stranger, sets, 0.5).ownerId).toBeNull();
  });

  it("returns no owner when nobody is enrolled", () => {
    expect(attributeFace(me, [], 0.5).ownerId).toBeNull();
  });

  it("picks the largest matching face, not the highest-scoring one", () => {
    // In a group shot the catalogueable subject is the one in the foreground.
    const winner = attributePhoto([
      { area: 100, verdict: { ownerId: "her", similarity: 0.99, margin: 0.5 } },
      { area: 9000, verdict: { ownerId: "me", similarity: 0.7, margin: 0.1 } },
    ]);
    expect(winner?.ownerId).toBe("me");
  });

  it("returns null when no face in the photo matched", () => {
    expect(attributePhoto([{ area: 500, verdict: { ownerId: null, similarity: 0.2, margin: 0 } }]))
      .toBeNull();
    expect(attributePhoto([])).toBeNull();
  });
});
