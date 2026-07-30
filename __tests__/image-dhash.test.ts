import { describe, it, expect } from "vitest";
import {
  garmentSignature,
  garmentsLikelyDuplicate,
  hammingDistance,
  photosLikelyDuplicate,
  titlesLikelySame,
} from "../lib/image-dhash";

const c = (...names: string[]) => names.map((name) => ({ hex: "#000", name }));

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

  describe("garment signature dedup", () => {
    // Two wearing-shots of DIFFERENT shirts: similar framing but not the same
    // frame (hamming 12 > the 8 near-identical threshold).
    const poseA = "1".repeat(52) + "0".repeat(12);
    const poseB = "1".repeat(40) + "0".repeat(24); // hamming 12 from poseA

    it("does NOT merge different garments that just share a pose", () => {
      const blackTee = { hash: poseA, category: "top", colors: c("black"), pattern: "solid" };
      const blueGraphicTee = { hash: poseB, category: "top", colors: c("blue"), pattern: "graphic" };
      expect(garmentsLikelyDuplicate(blackTee, blueGraphicTee)).toBe(false);
    });

    it("merges the same garment across different photos via matching signature", () => {
      const far = "1".repeat(32) + "0".repeat(32); // very different frames
      const a = { hash: "1".repeat(64), category: "top", colors: c("black"), pattern: "graphic" };
      const b = { hash: far, category: "top", colors: c("black"), pattern: "graphic" };
      expect(garmentsLikelyDuplicate(a, b)).toBe(true);
    });

    it("merges near-identical frames regardless of attributes", () => {
      const a = { hash: "1".repeat(64), category: "None", colors: [], pattern: undefined };
      const b = { hash: "1".repeat(62) + "00", category: "None", colors: [], pattern: undefined };
      expect(garmentsLikelyDuplicate(a, b)).toBe(true);
    });

    it("returns no signature without category or colors", () => {
      expect(garmentSignature("None", c("black"), "solid")).toBeNull();
      expect(garmentSignature("top", [], "solid")).toBeNull();
      expect(garmentSignature("top", c("black"), "solid")).toBe("top|black|solid");
    });
  });
});
