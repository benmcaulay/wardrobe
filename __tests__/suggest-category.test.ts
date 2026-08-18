import { describe, expect, it } from "vitest";
import { suggestCategoryFromItem } from "@/lib/categories";

/** The user's real closet vocabulary, in picker order. */
const OPTIONS = ["shirt", "hat", "shoes", "sweater/hoodie", "shorts", "pants", "jacket", "accessory"];

describe("suggestCategoryFromItem", () => {
  it("picks a label from the user's own list, not a canonical name", () => {
    // "top" is never offered to this user; "shirt" is.
    expect(suggestCategoryFromItem({ name: "Chargers AFC Champs Tee" }, OPTIONS)).toBe("shirt");
    expect(suggestCategoryFromItem({ name: "Nike Air Max Sneakers" }, OPTIONS)).toBe("shoes");
    expect(suggestCategoryFromItem({ name: "Wool Overcoat" }, OPTIONS)).toBe("jacket");
    expect(suggestCategoryFromItem({ name: "Yankees Cap" }, OPTIONS)).toBe("hat");
  });

  it("returns null rather than guessing when nothing is inferable", () => {
    // A wrong category is worse than an empty one — the gate explains itself.
    expect(suggestCategoryFromItem({ name: "IKEA HÖGVIND Table Lamp" }, OPTIONS)).toBeNull();
    expect(suggestCategoryFromItem({ name: "Thing" }, OPTIONS)).toBeNull();
    expect(suggestCategoryFromItem({ name: "" }, OPTIONS)).toBeNull();
  });

  it("prefers an explicit category over the name", () => {
    expect(
      suggestCategoryFromItem({ category: "shoes", name: "Sweater Weather Sneaker" }, OPTIONS),
    ).toBe("shoes");
  });

  it("returns null when the user's list has no label of the inferred kind", () => {
    // Inferred "shoes" but this closet only offers tops — don't force a wrong fit.
    expect(suggestCategoryFromItem({ name: "Running Sneakers" }, ["shirt", "sweater/hoodie"])).toBeNull();
  });

  it("respects the user's ordering when several labels share a kind", () => {
    expect(suggestCategoryFromItem({ name: "Cotton Tee" }, ["sweater/hoodie", "shirt"])).toBe(
      "sweater/hoodie",
    );
    expect(suggestCategoryFromItem({ name: "Cotton Tee" }, ["shirt", "sweater/hoodie"])).toBe("shirt");
  });

  it("handles the canonical defaults too", () => {
    const defaults = ["top", "bottom", "dress", "outerwear", "shoes", "accessory"];
    expect(suggestCategoryFromItem({ name: "Linen Shirt" }, defaults)).toBe("top");
    expect(suggestCategoryFromItem({ name: "Summer Dress" }, defaults)).toBe("dress");
  });
});

describe("suggestCategoryFromItem — same-kind disambiguation", () => {
  it("does not call jeans shorts", () => {
    // GarmentKind lumps both into "bottom"; taking the first match picked
    // "shorts" for jeans, which is an actively wrong suggestion.
    expect(suggestCategoryFromItem({ name: "Levi's 501 Jeans" }, OPTIONS)).toBe("pants");
    expect(suggestCategoryFromItem({ name: "Blue", subcategory: "chinos" }, OPTIONS)).toBe("pants");
    expect(suggestCategoryFromItem({ name: "Dickies Work Trousers" }, OPTIONS)).toBe("pants");
  });

  it("still calls shorts shorts", () => {
    expect(suggestCategoryFromItem({ name: "Patagonia Baggies Shorts" }, OPTIONS)).toBe("shorts");
    // "trunks" is now in the classifier's vocabulary and is unambiguously a
    // bottom, so it resolves to the nearest same-kind label the user offers.
    expect(suggestCategoryFromItem({ name: "Swim Trunks" }, OPTIONS)).toBe("shorts");
  });

  it("separates sweaters from shirts", () => {
    expect(suggestCategoryFromItem({ name: "Merino Wool Sweater" }, OPTIONS)).toBe("sweater/hoodie");
    expect(suggestCategoryFromItem({ name: "Champion Hoodie" }, OPTIONS)).toBe("sweater/hoodie");
    expect(suggestCategoryFromItem({ name: "Oxford Shirt" }, OPTIONS)).toBe("shirt");
  });

  it("separates jackets from shirts", () => {
    expect(suggestCategoryFromItem({ name: "Harrington Jacket" }, OPTIONS)).toBe("jacket");
    expect(suggestCategoryFromItem({ name: "Wool Overcoat" }, OPTIONS)).toBe("jacket");
  });

  it("falls back to the user's ordering when nothing disambiguates", () => {
    expect(suggestCategoryFromItem({ name: "Cotton Tee" }, ["sweater/hoodie", "shirt"])).toBe(
      "sweater/hoodie",
    );
  });
});
