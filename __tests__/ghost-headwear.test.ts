import { describe, expect, it } from "vitest";
import { mapCategoryToGhost, mapItemToGhost } from "../lib/services/ghost-mannequin-shared";

describe("headwear ghost shape", () => {
  it("routes hats out of the generic accessory prompt", () => {
    // The bug: a cap shared "a clean retail catalog pose" with belts and bags,
    // so every imported hat faced a different way.
    for (const item of [
      { category: "hat", name: "Chargers 47 Trucker" },
      { category: "hat", name: "Stanford Fitted" },
      { category: "accessory", name: "Black Beanie" },
      { category: "accessory", name: "Camo Snapback" },
      { category: "accessory", name: "Bucket Hat" },
    ]) {
      expect(mapItemToGhost(item)).toBe("headwear");
    }
  });

  it("leaves every other accessory alone", () => {
    for (const item of [
      { category: "accessory", name: "Leather Belt" },
      { category: "accessory", name: "Canvas Tote Bag" },
      { category: "accessory", name: "Ray-Ban Sunglasses" },
      { category: "accessory", name: "Gold Necklace" },
      { category: "accessory", name: "Wool Scarf" },
    ]) {
      expect(mapItemToGhost(item)).toBe("accessory");
    }
  });

  it("does not disturb the other shapes", () => {
    expect(mapItemToGhost({ category: "shoes", name: "Nike Dunk" })).toBe("footwear");
    expect(mapItemToGhost({ category: "t shirt", name: "Evisu Tee" })).toBe("upperbody");
    expect(mapItemToGhost({ category: "jeans", name: "501" })).toBe("lowerbody");
    expect(mapItemToGhost({ category: "jacket", name: "Harrington" })).toBe("upperbody");
  });

  it("works from a category alone", () => {
    expect(mapCategoryToGhost("hat")).toBe("headwear");
    expect(mapCategoryToGhost("accessory")).toBe("accessory");
  });

  it("does not fire on a garment that merely mentions a hat word", () => {
    // "Fitted" and "cap" show up in product titles for non-headwear; the kind
    // has to be accessory before the text is consulted at all.
    expect(mapItemToGhost({ category: "t shirt", name: "Fitted Cap Sleeve Tee" })).toBe("upperbody");
    expect(mapItemToGhost({ category: "jeans", name: "Trucker Fit Denim" })).toBe("lowerbody");
  });
});
