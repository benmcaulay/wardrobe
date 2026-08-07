import { describe, it, expect } from "vitest";
import { analyzeCloset } from "../lib/wishlist/gaps";

const CATEGORIES = ["Tops", "Bottoms", "Outerwear", "Shoes", "Accessories"];

function owned(counts: Record<string, number>) {
  return Object.entries(counts).flatMap(([category, n]) =>
    Array.from({ length: n }, () => ({ category })),
  );
}

describe("analyzeCloset", () => {
  it("calls a category with nothing in it a gap", () => {
    const report = analyzeCloset({
      owned: owned({ Tops: 8, Bottoms: 4 }),
      wishlist: [],
      categories: CATEGORIES,
    });

    const outerwear = report.coverage.find((c) => c.category === "Outerwear");
    expect(outerwear?.owned).toBe(0);
    expect(outerwear?.status).toBe("gap");
    expect(report.gaps.map((g) => g.category)).toContain("Outerwear");
  });

  it("calls a category with one or two items thin", () => {
    const report = analyzeCloset({
      owned: owned({ Tops: 8, Shoes: 2 }),
      wishlist: [],
      categories: CATEGORIES,
    });
    expect(report.coverage.find((c) => c.category === "Shoes")?.status).toBe("thin");
  });

  it("calls a stacked category saturated", () => {
    const report = analyzeCloset({
      owned: owned({ Tops: 20, Bottoms: 4, Shoes: 3 }),
      wishlist: [],
      categories: CATEGORIES,
    });
    expect(report.coverage.find((c) => c.category === "Tops")?.status).toBe("saturated");
    expect(report.saturated.map((c) => c.category)).toEqual(["Tops"]);
  });

  it("needs an absolute floor, not just a multiple of the median", () => {
    // Median owned is 1, so 2x would flag a 2-item category as saturated.
    const report = analyzeCloset({
      owned: owned({ Tops: 2, Bottoms: 1, Shoes: 1 }),
      wishlist: [],
      categories: CATEGORIES,
    });
    expect(report.coverage.find((c) => c.category === "Tops")?.status).toBe("thin");
    expect(report.saturated).toEqual([]);
  });

  it("ignores empty categories when anchoring the median", () => {
    const report = analyzeCloset({
      owned: owned({ Tops: 6, Bottoms: 6 }),
      wishlist: [],
      categories: [...CATEGORIES, "Suits", "Swim", "Hats"],
    });
    // Median over non-empty categories is 6, so 6 is not saturated.
    expect(report.medianOwned).toBe(6);
    expect(report.coverage.find((c) => c.category === "Tops")?.status).toBe("covered");
  });

  it("judges each wishlist item against its own category", () => {
    const report = analyzeCloset({
      owned: owned({ Tops: 20, Outerwear: 0, Bottoms: 4 }),
      wishlist: [
        { id: "coat", category: "Outerwear" },
        { id: "tee", category: "Tops" },
        { id: "jeans", category: "Bottoms" },
      ],
      categories: CATEGORIES,
    });

    expect(report.verdicts.coat).toBe("fills-gap");
    expect(report.verdicts.tee).toBe("duplicates");
    expect(report.verdicts.jeans).toBe("neutral");
  });

  it("matches categories case- and whitespace-insensitively", () => {
    const report = analyzeCloset({
      owned: owned({ "  tops ": 20 }),
      wishlist: [{ id: "tee", category: "Tops" }],
      categories: ["Tops"],
    });
    expect(report.verdicts.tee).toBe("duplicates");
    expect(report.coverage).toHaveLength(1);
  });

  it("counts wishlist items per category without inflating owned", () => {
    const report = analyzeCloset({
      owned: owned({ Outerwear: 0 }),
      wishlist: [
        { id: "a", category: "Outerwear" },
        { id: "b", category: "Outerwear" },
      ],
      categories: CATEGORIES,
    });
    const outerwear = report.coverage.find((c) => c.category === "Outerwear");
    expect(outerwear?.owned).toBe(0);
    expect(outerwear?.wishlisted).toBe(2);
  });

  it("surfaces a wishlist category that isn't on the roster", () => {
    const report = analyzeCloset({
      owned: [],
      wishlist: [{ id: "x", category: "Jewelry" }],
      categories: CATEGORIES,
    });
    expect(report.coverage.map((c) => c.category)).toContain("Jewelry");
    expect(report.verdicts.x).toBe("fills-gap");
  });

  it("does not treat the uncategorised bucket as a wardrobe gap", () => {
    const report = analyzeCloset({
      owned: owned({ Tops: 6, None: 4 }),
      wishlist: [],
      categories: [...CATEGORIES, "None"],
    });
    expect(report.coverage.map((c) => c.category)).not.toContain("None");
    expect(report.gaps.map((c) => c.category)).not.toContain("None");
  });

  it("stays neutral on an uncategorised wishlist item rather than guessing", () => {
    const report = analyzeCloset({
      owned: owned({ Shoes: 29 }),
      wishlist: [{ id: "sambas", category: "None" }],
      categories: CATEGORIES,
    });
    // Without a category we can't tell a gap from a 29th pair of shoes.
    expect(report.verdicts.sambas).toBe("neutral");
  });

  it("treats an empty-string category as uncategorised too", () => {
    const report = analyzeCloset({
      owned: owned({ Tops: 5 }),
      wishlist: [{ id: "x", category: "  " }],
      categories: CATEGORIES,
    });
    expect(report.verdicts.x).toBe("neutral");
    expect(report.coverage.every((c) => c.category.trim() !== "")).toBe(true);
  });

  it("handles an empty closet without dividing by zero", () => {
    const report = analyzeCloset({ owned: [], wishlist: [], categories: [] });
    expect(report.coverage).toEqual([]);
    expect(report.medianOwned).toBe(0);
    expect(report.gaps).toEqual([]);
  });
});
