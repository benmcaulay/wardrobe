import { describe, it, expect } from "vitest";
import {
  mapClassifierCategory,
  normalizeClassification,
  normalizeScanDetection,
  parseClassifierJson,
} from "../lib/services/garmentClassifier";
import { NONE_CATEGORY } from "../lib/categories";

describe("garmentClassifier", () => {
  it("parses JSON wrapped in markdown fences", () => {
    const raw = parseClassifierJson(
      'Here you go:\n```json\n{"isGarment":true,"category":"top","name":"Navy sweater","confidence":0.92}\n```',
    );
    expect(raw?.isGarment).toBe(true);
    expect(raw?.name).toBe("Navy sweater");
  });

  it("maps vision categories to wardrobe categories", () => {
    expect(mapClassifierCategory("shoes")).toBe("shoes");
    expect(mapClassifierCategory("outerwear")).toBe("outerwear");
    expect(mapClassifierCategory("other")).toBe(NONE_CATEGORY);
  });

  it("skips low-confidence non-garments", () => {
    const out = normalizeClassification({
      isGarment: false,
      category: "other",
      name: "Beach",
      confidence: 0.95,
      reason: "Scenery",
    });
    expect(out.isGarment).toBe(false);
    expect(out.skipReason).toBe("Scenery");
  });

  it("extracts palette colors, pattern, and material", () => {
    const scan = normalizeScanDetection({
      isGarment: true,
      garments: [
        {
          category: "top",
          name: "Striped tee",
          confidence: 0.9,
          colors: ["Blue", "white", "fuchsia"],
          pattern: "Striped",
          material: "Cotton",
        },
      ],
    });
    const g = scan.garments[0]!;
    // Known palette colors map (case-insensitive); unknown "fuchsia" is dropped.
    expect(g.colors.map((c) => c.name)).toEqual(["blue", "white"]);
    expect(g.colors[0]?.hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(g.pattern).toBe("striped");
    expect(g.material).toBe("cotton");
  });

  it("drops filler attribute values", () => {
    const scan = normalizeScanDetection({
      isGarment: true,
      garments: [
        { category: "top", name: "Tee", confidence: 0.9, pattern: "none", material: "unknown" },
      ],
    });
    const g = scan.garments[0]!;
    expect(g.pattern).toBeUndefined();
    expect(g.material).toBeUndefined();
    expect(g.colors).toEqual([]);
  });

  it("splits multi-garment flat-lay detections", () => {
    const scan = normalizeScanDetection({
      isGarment: true,
      garments: [
        { category: "top", name: "White tee", confidence: 0.9 },
        { category: "bottom", name: "Blue jeans", confidence: 0.88 },
      ],
    });
    expect(scan.garments).toHaveLength(2);
    expect(scan.garments[0]?.category).toBe("top");
    expect(scan.garments[1]?.category).toBe("bottom");
  });
});
