import { describe, expect, it } from "vitest";
import {
  chooseBestImportImage,
  isUsableImportImage,
  MAX_IMPORT_ASPECT,
  MIN_IMPORT_EDGE_PX,
} from "@/lib/import-image-choice";

describe("isUsableImportImage", () => {
  it("accepts ordinary product photos", () => {
    expect(isUsableImportImage({ width: 600, height: 600 })).toBe(true);
    expect(isUsableImportImage({ width: 1000, height: 1334 })).toBe(true);
    expect(isUsableImportImage({ width: 245, height: 245 })).toBe(true);
  });

  it("rejects anything below the edge floor", () => {
    expect(isUsableImportImage({ width: MIN_IMPORT_EDGE_PX - 1, height: 900 })).toBe(false);
    expect(isUsableImportImage({ width: 64, height: 64 })).toBe(false);
  });

  /**
   * The case that motivated the whole rule: Journeys' og:image is a 146x62 site
   * wordmark. Preferring the merchant image by position would have imported a
   * logo in place of a perfectly good 600x600 product photo.
   */
  it("rejects a site logo strip on both size and shape", () => {
    expect(isUsableImportImage({ width: 146, height: 62 })).toBe(false);
  });

  it("rejects banners that are large but the wrong shape", () => {
    expect(isUsableImportImage({ width: 2000, height: 400 })).toBe(false);
    expect(isUsableImportImage({ width: 400, height: 2000 })).toBe(false);
  });

  it("allows shapes right at the aspect limit", () => {
    expect(isUsableImportImage({ width: 600, height: 600 * MAX_IMPORT_ASPECT })).toBe(true);
    expect(isUsableImportImage({ width: 600, height: 600 * MAX_IMPORT_ASPECT + 1 })).toBe(false);
  });

  it("rejects degenerate dimensions rather than throwing", () => {
    expect(isUsableImportImage({ width: 0, height: 0 })).toBe(false);
    expect(isUsableImportImage({ width: -100, height: 500 })).toBe(false);
    expect(isUsableImportImage({ width: Number.NaN, height: 500 })).toBe(false);
  });
});

describe("chooseBestImportImage", () => {
  it("upgrades to the merchant hero when it is genuinely bigger", () => {
    // Farfetch, measured live: 1000x1334 hero vs a 596x596 search thumbnail.
    const picked = chooseBestImportImage([
      { width: 1000, height: 1334 },
      { width: 596, height: 596 },
    ]);
    expect(picked).toBe(0);
  });

  it("keeps the thumbnail when the merchant image is a logo", () => {
    // Journeys, measured live.
    const picked = chooseBestImportImage([
      { width: 146, height: 62 },
      { width: 600, height: 600 },
    ]);
    expect(picked).toBe(1);
  });

  it("ranks by shortest edge, not by pixel count", () => {
    // 1800x300 has more pixels than 700x700 but is a strip; and it fails aspect
    // anyway, so the square wins on both counts.
    expect(chooseBestImportImage([{ width: 1800, height: 300 }, { width: 700, height: 700 }])).toBe(1);
    // Both valid: the one with the larger shortest edge wins.
    expect(chooseBestImportImage([{ width: 1200, height: 800 }, { width: 900, height: 900 }])).toBe(1);
  });

  it("prefers the earlier candidate on a tie, so the merchant page wins", () => {
    expect(chooseBestImportImage([{ width: 800, height: 800 }, { width: 800, height: 800 }])).toBe(0);
  });

  it("returns -1 when nothing qualifies, so the caller can fall back", () => {
    expect(chooseBestImportImage([{ width: 146, height: 62 }, { width: 50, height: 50 }])).toBe(-1);
    expect(chooseBestImportImage([])).toBe(-1);
  });
});
