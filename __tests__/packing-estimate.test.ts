import { describe, expect, it } from "vitest";
import { estimateItemPacking, formatVolume, formatWeight } from "@/lib/packing/estimate";

describe("estimateItemPacking", () => {
  it("uses the category base when nothing else matches", () => {
    const est = estimateItemPacking({ category: "top" });
    expect(est.source).toBe("heuristic");
    expect(est.weightGrams).toBe(200);
    expect(est.volumeLiters).toBeCloseTo(1.2, 5);
  });

  it("prefers subcategory/name keywords over the category base", () => {
    const tee = estimateItemPacking({ category: "top", name: "Plain tee" });
    const sweater = estimateItemPacking({ category: "top", subcategory: "sweater" });
    expect(tee.volumeLiters).toBeLessThan(sweater.volumeLiters);
    expect(sweater.weightGrams).toBe(450);
  });

  it("applies a material multiplier", () => {
    const cotton = estimateItemPacking({ category: "bottom", subcategory: "trousers", material: "cotton" });
    const denim = estimateItemPacking({ category: "bottom", subcategory: "trousers", material: "denim" });
    expect(denim.weightGrams).toBeGreaterThan(cotton.weightGrams);
    expect(denim.volumeLiters).toBeGreaterThan(cotton.volumeLiters);
  });

  it("honours a stored override on both fields", () => {
    const est = estimateItemPacking({ category: "top", weightGrams: 999, volumeLiters: 5 });
    expect(est.source).toBe("override");
    expect(est.weightGrams).toBe(999);
    expect(est.volumeLiters).toBe(5);
  });

  it("fills only the missing field from the heuristic when partially overridden", () => {
    const est = estimateItemPacking({ category: "top", weightGrams: 333 });
    expect(est.weightGrams).toBe(333);
    expect(est.volumeLiters).toBeCloseTo(1.2, 5);
    expect(est.source).toBe("heuristic");
  });

  it("never goes below the floors", () => {
    const est = estimateItemPacking({ category: "accessory", subcategory: "ring", material: "silk" });
    expect(est.weightGrams).toBeGreaterThanOrEqual(20);
    expect(est.volumeLiters).toBeGreaterThanOrEqual(0.1);
  });

  it("formats weight and volume for display", () => {
    expect(formatWeight(200)).toBe("200 g");
    expect(formatWeight(1200)).toBe("1.2 kg");
    expect(formatWeight(2000)).toBe("2 kg");
    expect(formatVolume(1.25)).toBe("1.3 L");
  });
});
