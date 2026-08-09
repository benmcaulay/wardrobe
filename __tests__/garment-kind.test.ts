import { describe, it, expect } from "vitest";
import { classifyGarmentKind, DEFAULT_CATEGORIES, NONE_CATEGORY } from "../lib/categories";

const kind = (category: string, subcategory?: string, name?: string) =>
  classifyGarmentKind({ category, subcategory, name });

describe("classifyGarmentKind", () => {
  it("maps every default category to itself", () => {
    for (const c of DEFAULT_CATEGORIES) {
      expect(kind(c), `default category ${c}`).toBe(c);
    }
  });

  it("maps the natural category names real closets use", () => {
    // These are the actual categories from a live wardrobe; before the shared
    // classifier existed every one of them fell through to "other".
    expect(kind("shirt")).toBe("top");
    expect(kind("sweater/hoodie")).toBe("top");
    expect(kind("pants")).toBe("bottom");
    expect(kind("shorts")).toBe("bottom");
    expect(kind("jacket")).toBe("outerwear");
    expect(kind("hat")).toBe("accessory");
    expect(kind("shoes")).toBe("shoes");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(kind("  JACKET ")).toBe("outerwear");
    expect(kind("Sweater / Hoodie")).toBe("top");
  });

  describe("overlapping terms resolve by specificity", () => {
    it("reads 'dress shirt' as a top, not a dress", () => {
      expect(kind("dress shirt")).toBe("top");
      expect(kind("other", "dress shirt")).toBe("top");
    });

    it("reads 'dress pants' as a bottom", () => {
      expect(kind("dress pants")).toBe("bottom");
    });

    it("reads 'sweatpants' as a bottom, not a sweater", () => {
      expect(kind("sweatpants")).toBe("bottom");
      expect(kind("track pants")).toBe("bottom");
    });

    it("reads 'bootcut jeans' as a bottom, not footwear", () => {
      expect(kind("bootcut jeans")).toBe("bottom");
      expect(kind("boot cut denim")).toBe("bottom");
    });

    it("still reads plain boots as shoes", () => {
      expect(kind("boots")).toBe("shoes");
      expect(kind("chelsea boot")).toBe("shoes");
    });

    it("reads a blazer and a vest as outerwear", () => {
      expect(kind("blazer")).toBe("outerwear");
      expect(kind("vest")).toBe("outerwear");
    });
  });

  describe("falling back past the category", () => {
    it("uses subcategory and name when the category is vague", () => {
      expect(kind("other", "parka")).toBe("outerwear");
      expect(kind("other", null as unknown as string, "Wool Overcoat")).toBe("outerwear");
      expect(kind("misc", undefined, "Linen Tank")).toBe("top");
    });

    it("uses the name when the category is the None placeholder", () => {
      expect(kind(NONE_CATEGORY, undefined, "Running Sneakers")).toBe("shoes");
    });

    it("prefers the category over the name when the category is meaningful", () => {
      // A dress that happens to be shirt-shaped is still a dress.
      expect(kind("dress", undefined, "Beach Shirt Dress")).toBe("dress");
    });
  });

  describe("unknown input", () => {
    it("returns other for a category we can't place", () => {
      expect(kind("loungewear")).toBe("other");
      expect(kind("gear")).toBe("other");
    });

    it("returns other for empty input rather than throwing", () => {
      expect(classifyGarmentKind({})).toBe("other");
      expect(kind("")).toBe("other");
      expect(classifyGarmentKind({ category: null, subcategory: null, name: null })).toBe("other");
    });
  });
});
