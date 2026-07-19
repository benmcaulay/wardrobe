import { describe, it, expect } from "vitest";
import {
  hammingDistance,
  photosLikelyDuplicate,
  titlesLikelySame,
} from "../lib/image-dhash";

describe("image-dhash", () => {
  it("counts hamming distance", () => {
    expect(hammingDistance("1010", "1011")).toBe(1);
    expect(hammingDistance("1010", "0101")).toBe(4);
  });

  it("matches similar titles", () => {
    expect(titlesLikelySame("Navy knit sweater", "navy sweater")).toBe(true);
    expect(titlesLikelySame("Red dress", "Blue jeans")).toBe(false);
  });

  it("groups visually close photos with similar titles", () => {
    const hashA = "1".repeat(64);
    const hashB = "1".repeat(60) + "0".repeat(4);
    expect(
      photosLikelyDuplicate({
        hashA,
        hashB,
        nameA: "Navy crewneck sweater",
        nameB: "Navy sweater",
        categoryA: "top",
        categoryB: "top",
      }),
    ).toBe(true);
  });
});
