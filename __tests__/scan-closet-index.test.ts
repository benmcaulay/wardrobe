import { describe, it, expect } from "vitest";
import { findClosetMatch, type ClosetHashEntry } from "../lib/server/scan-closet-index";

const HASH_A = "1".repeat(32) + "0".repeat(32);
const HASH_FAR = "0".repeat(32) + "1".repeat(32); // hamming distance 64 from HASH_A

describe("findClosetMatch", () => {
  const index: ClosetHashEntry[] = [
    { itemId: "shirt", name: "Navy tee", category: "top", hash: HASH_A },
  ];

  it("matches an identical garment hash", () => {
    const hit = findClosetMatch(HASH_A, "Navy tee", "top", index);
    expect(hit?.itemId).toBe("shirt");
  });

  it("does not match a visually distant garment", () => {
    expect(findClosetMatch(HASH_FAR, "Red jacket", "outerwear", index)).toBeNull();
  });

  it("returns null against an empty closet", () => {
    expect(findClosetMatch(HASH_A, undefined, undefined, [])).toBeNull();
  });
});
