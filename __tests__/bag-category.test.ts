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
