import { describe, expect, it } from "vitest";
import {
  BACKGROUND_SIMILARITY,
  cropWindows,
  MATCH_FLOOR,
  MAX_MATCH_CONFIDENCE,
  matchConfidence,
  matchPhoto,
  rankCandidates,
  SHORTLIST_SIZE,
  type ClosetVector,
} from "@/lib/wear/photo-match";
import { normalizeEmbedding } from "@/lib/wear/embedding";
import { PHOTO_CONFIDENCE_FLOOR } from "@/lib/wear/signals";
import { exifDateToISO, photoDateFromParts, readExifDate } from "@/lib/wear/exif";

/**
 * A unit vector at an exact cosine from REFERENCE (= e1), tilted along its own
 * orthogonal axis so two such vectors are also dissimilar to *each other*.
 *
 * Sharing one tilt axis is the obvious mistake: two vectors both at cos 0.3
 * from e1 sit almost on top of one another (cos ≈ 0.98), which quietly makes
 * "unrelated" fixtures behave like near-duplicates.
 */
const DIMS = 8;
let nextAxis = 1;
function vectorAtCosine(cos: number, axis = nextAxis++): Float32Array {
  const sin = Math.sqrt(Math.max(0, 1 - cos * cos));
  const out = new Float32Array(DIMS);
  out[0] = cos;
  out[axis % (DIMS - 1) + 1] = sin;
  return normalizeEmbedding(out);
}
const REFERENCE = normalizeEmbedding(
  Float32Array.from(Array.from({ length: DIMS }, (_, i) => (i === 0 ? 1 : 0))),
);

describe("matchConfidence", () => {
  it("refuses anything below the measured noise floor", () => {
    // 1% of unrelated pairs in the real closet already score this high, so
    // below it a match is indistinguishable from coincidence.
    expect(matchConfidence(MATCH_FLOOR - 0.01, 0.2)).toBe(0);
    expect(matchConfidence(BACKGROUND_SIMILARITY, 0.5)).toBe(0);
  });

  it("never reaches the confidence of an explicit log", () => {
    expect(matchConfidence(1, 1)).toBeLessThanOrEqual(MAX_MATCH_CONFIDENCE);
    expect(MAX_MATCH_CONFIDENCE).toBeLessThan(1);
  });

  it("stays inside the band the wear log accepts for inference", () => {
    for (const similarity of [0.85, 0.9, 0.95, 1]) {
      for (const margin of [0, 0.01, 0.05, 0.3]) {
        const confidence = matchConfidence(similarity, margin);
        expect(confidence).toBeGreaterThanOrEqual(PHOTO_CONFIDENCE_FLOOR);
        expect(confidence).toBeLessThanOrEqual(MAX_MATCH_CONFIDENCE);
      }
    }
  });

  it("discounts a strong match that a near-duplicate ties", () => {
    // The measured worst case: two pairs of light-wash baggy jeans at 0.96.
    // High similarity, no margin — exactly when a confident guess is wrong.
    const ambiguous = matchConfidence(0.96, 0.003);
    const decisive = matchConfidence(0.96, 0.12);
    expect(ambiguous).toBeLessThan(decisive);
  });

  it("rises with similarity when the margin is held fixed", () => {
    expect(matchConfidence(0.95, 0.08)).toBeGreaterThan(matchConfidence(0.87, 0.08));
  });
});

describe("rankCandidates", () => {
  const closet: ClosetVector[] = [
    { itemId: "exact", vector: vectorAtCosine(0.97) },
    { itemId: "close", vector: vectorAtCosine(0.9) },
    { itemId: "unrelated", vector: vectorAtCosine(0.4) },
  ];

  it("ranks by similarity and drops everything under the floor", () => {
    const ranked = rankCandidates(REFERENCE, closet);
    expect(ranked.map((c) => c.itemId)).toEqual(["exact", "close"]);
    expect(ranked.every((c) => c.similarity >= MATCH_FLOOR)).toBe(true);
  });

  it("gives the leader a positive margin and the alternatives a negative one", () => {
    const [leader, second] = rankCandidates(REFERENCE, closet);
    expect(leader.margin).toBeGreaterThan(0);
    // The runner-up is an alternative, not a second independent finding.
    expect(second.margin).toBeLessThan(0);
    expect(second.confidence).toBeLessThan(leader.confidence);
  });

  it("returns nothing when the closet has no plausible match", () => {
    expect(rankCandidates(REFERENCE, [{ itemId: "x", vector: vectorAtCosine(0.5) }])).toEqual([]);
  });

  it("handles an empty closet", () => {
    expect(rankCandidates(REFERENCE, [])).toEqual([]);
  });
});

describe("matchPhoto", () => {
  const closet: ClosetVector[] = [
    { itemId: "jacket", vector: vectorAtCosine(0.95) },
    { itemId: "similar-jacket", vector: vectorAtCosine(0.88) },
    { itemId: "shoes", vector: vectorAtCosine(0.3) },
  ];

  it("takes the best crop per item rather than averaging over them", () => {
    // Most crops of a photo are wall and floor. Averaging would bury the one
    // crop that actually contains the garment.
    const crops = [vectorAtCosine(0.2), REFERENCE, vectorAtCosine(0.25)];
    const [match] = matchPhoto(crops, closet);
    expect(match.best.itemId).toBe("jacket");
    expect(match.best.similarity).toBeGreaterThan(0.9);
  });

  it("reports one finding per photo with the rest as alternatives", () => {
    // The same jacket across four overlapping crops is one wear, not four.
    const matches = matchPhoto([REFERENCE, REFERENCE, REFERENCE], closet);
    expect(matches).toHaveLength(1);
    expect(matches[0].alternatives.map((a) => a.itemId)).toEqual(["similar-jacket"]);
  });

  it("offers alternatives because top-1 is only ~70% accurate", () => {
    const [match] = matchPhoto([REFERENCE], closet);
    expect(match.alternatives.length).toBeGreaterThan(0);
    expect(match.alternatives.length).toBeLessThanOrEqual(SHORTLIST_SIZE - 1);
  });

  it("returns nothing when no crop clears the floor", () => {
    expect(matchPhoto([vectorAtCosine(0.5)], closet)).toEqual([]);
    expect(matchPhoto([], closet)).toEqual([]);
    expect(matchPhoto([REFERENCE], [])).toEqual([]);
  });
});

describe("cropWindows", () => {
  it("includes the full frame, for flat-lays and mirror selfies", () => {
    expect(cropWindows()).toContainEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it("keeps every window inside the image", () => {
    for (const window of cropWindows()) {
      expect(window.x).toBeGreaterThanOrEqual(0);
      expect(window.y).toBeGreaterThanOrEqual(0);
      expect(window.x + window.w).toBeLessThanOrEqual(1.0001);
      expect(window.y + window.h).toBeLessThanOrEqual(1.0001);
    }
  });

  it("stays small enough to embed on a phone", () => {
    // Each window is a full encoder pass; a grid search would cook the battery.
    expect(cropWindows().length).toBeLessThanOrEqual(10);
  });
});

describe("exifDateToISO", () => {
  it("converts the EXIF colon format", () => {
    expect(exifDateToISO("2026:08:09 18:42:11")).toBe("2026-08-09");
  });

  it("rejects the all-zero date cameras write with an unset clock", () => {
    expect(exifDateToISO("0000:00:00 00:00:00")).toBeNull();
  });

  it("rejects anything that isn't the expected shape", () => {
    expect(exifDateToISO("2026-08-09")).toBeNull();
    expect(exifDateToISO("")).toBeNull();
    expect(exifDateToISO("garbage")).toBeNull();
  });
});

describe("readExifDate", () => {
  it("returns null for data that isn't a JPEG", () => {
    expect(readExifDate(new Uint8Array([1, 2, 3, 4]).buffer)).toBeNull();
    expect(readExifDate(new ArrayBuffer(0))).toBeNull();
  });

  it("returns null for a JPEG with no EXIF block", () => {
    // SOI then SOS: valid enough to parse, no metadata to find.
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02]);
    expect(readExifDate(bytes.buffer)).toBeNull();
  });

  it("reads DateTimeOriginal out of a real EXIF header", () => {
    expect(readExifDate(buildJpegWithExif("2026:03:14 09:26:53"))).toBe("2026-03-14");
  });

  it("reads a big-endian header too", () => {
    expect(readExifDate(buildJpegWithExif("2025:12:25 07:00:00", false))).toBe("2025-12-25");
  });
});

describe("photoDateFromParts", () => {
  it("prefers EXIF over the file timestamp", () => {
    const result = photoDateFromParts(buildJpegWithExif("2026:01:02 10:00:00"), Date.UTC(2026, 7, 9));
    expect(result).toEqual({ iso: "2026-01-02", source: "exif" });
  });

  it("falls back to mtime and says so, so callers can down-weight it", () => {
    // Copying or syncing a photo rewrites mtime, so a whole imported library
    // can collapse onto the import date.
    const local = new Date(2026, 7, 9, 12, 0, 0);
    const result = photoDateFromParts(null, local.getTime());
    expect(result).toEqual({ iso: "2026-08-09", source: "mtime" });
  });
});

/** Minimal JPEG carrying one APP1/EXIF IFD with DateTimeOriginal. */
function buildJpegWithExif(value: string, littleEndian = true): ArrayBuffer {
  const ascii = `${value}\0`;
  const tiffSize = 8 + 2 + 12 + 4 + ascii.length;
  const app1Size = 6 + tiffSize + 2;
  const total = 2 + 2 + app1Size;

  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);
  let offset = 0;

  view.setUint16(offset, 0xffd8); // SOI
  offset += 2;
  view.setUint16(offset, 0xffe1); // APP1
  offset += 2;
  view.setUint16(offset, app1Size);
  offset += 2;

  for (const [i, code] of [0x45, 0x78, 0x69, 0x66, 0x00, 0x00].entries()) {
    view.setUint8(offset + i, code);
  }
  offset += 6;

  const tiffStart = offset;
  view.setUint16(offset, littleEndian ? 0x4949 : 0x4d4d);
  view.setUint16(offset + 2, 42, littleEndian);
  view.setUint32(offset + 4, 8, littleEndian); // IFD0 at +8
  offset += 8;

  view.setUint16(offset, 1, littleEndian); // one entry
  offset += 2;
  view.setUint16(offset, 0x9003, littleEndian); // DateTimeOriginal
  view.setUint16(offset + 2, 2, littleEndian); // ASCII
  view.setUint32(offset + 4, ascii.length, littleEndian);
  const valueOffset = tiffStart + 8 + 2 + 12 + 4;
  view.setUint32(offset + 8, valueOffset - tiffStart, littleEndian);
  offset += 12;

  view.setUint32(offset, 0, littleEndian); // no next IFD
  offset += 4;

  for (let i = 0; i < ascii.length; i += 1) view.setUint8(offset + i, ascii.charCodeAt(i));
  return buffer;
}
