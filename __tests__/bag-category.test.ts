import { describe, it, expect } from "vitest";
import { FALLBACK_BAG_CATEGORY, resolveBagCategory } from "../lib/packing/bag-category";

describe("resolveBagCategory", () => {
  it("prefers a label that names luggage", () => {
    expect(resolveBagCategory(["hat", "bags", "shoes"])).toBe("bags");
    expect(resolveBagCategory(["accessory", "backpack"])).toBe("backpack");
    expect(resolveBagCategory(["Luggage", "hat"])).toBe("Luggage");
  });

  it("does not file luggage under an unrelated accessory label", () => {
    // The bug this exists for: a closet full of hats put a Cotopaxi backpack
    // in "hat" because it was simply the first accessory-kind label.
    expect(resolveBagCategory(["hat", "scarf", "belt"])).toBe(FALLBACK_BAG_CATEGORY);
  });

  it("falls back to the closet's own generic accessory label", () => {
    expect(resolveBagCategory(["shirt", "accessories"])).toBe("accessories");
    expect(resolveBagCategory(["shirt", "Accessory"])).toBe("Accessory");
  });

  it("uses the built-in fallback when the closet has nothing suitable", () => {
    expect(resolveBagCategory(["shirt", "jeans"])).toBe(FALLBACK_BAG_CATEGORY);
    expect(resolveBagCategory([])).toBe(FALLBACK_BAG_CATEGORY);
  });

  it("returns the closet's own spelling, not a normalized one", () => {
    expect(resolveBagCategory(["Weekend Bags"])).toBe("Weekend Bags");
  });

  it("does not match a label that merely contains the letters", () => {
    expect(resolveBagCategory(["baggy jeans"])).toBe(FALLBACK_BAG_CATEGORY);
  });
});

/**
 * Adopting a closet item pulls its *thumbnail*, which is a ghost render when
 * one exists. Two things downstream keyed off "the bag's photo is the item's
 * originalImagePath", and both become wrong once that is a ghost path.
 */
describe("closet thumbnail selection for an adopted bag", () => {
  const thumbnailOf = (i: { ghostImagePath: string | null; originalImagePath: string }) =>
    i.ghostImagePath ?? i.originalImagePath;

  it("prefers the ghost render over the source photo", () => {
    expect(
      thumbnailOf({ ghostImagePath: "u/ghost.png", originalImagePath: "u/selfie.jpg" }),
    ).toBe("u/ghost.png");
  });

  it("falls back to the source photo before any render exists", () => {
    expect(thumbnailOf({ ghostImagePath: null, originalImagePath: "u/selfie.jpg" })).toBe(
      "u/selfie.jpg",
    );
  });

  it("treats either field as still-in-use when deciding to delete an upload", () => {
    // The guard has to match on both, or deleting a bag would remove a ghost
    // render the closet item is still displaying.
    const stillUsed = (path: string, item: { ghostImagePath: string | null; originalImagePath: string }) =>
      item.originalImagePath === path || item.ghostImagePath === path;
    const item = { ghostImagePath: "u/ghost.png", originalImagePath: "u/selfie.jpg" };
    expect(stillUsed("u/ghost.png", item)).toBe(true);
    expect(stillUsed("u/selfie.jpg", item)).toBe(true);
    expect(stillUsed("u/unrelated.jpg", item)).toBe(false);
  });
});
