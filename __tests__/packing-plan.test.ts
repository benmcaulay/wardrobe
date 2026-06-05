import { describe, expect, it } from "vitest";
import {
  bucketFor,
  buildPackingPlan,
  climateScore,
  computeUsage,
  isPants,
  isShorts,
  packItems,
  seasonScore,
  selectItems,
  targetCounts,
  type PackableItem,
  type SelectedItem,
} from "@/lib/packing/plan";

describe("bucketFor", () => {
  it("maps known categories and folds unknowns into 'other'", () => {
    expect(bucketFor("Top")).toBe("top");
    expect(bucketFor("outerwear")).toBe("outerwear");
    expect(bucketFor("loungewear")).toBe("other");
  });
});

describe("targetCounts", () => {
  it("scales tops with trip length and clamps", () => {
    expect(targetCounts(7, "warm", 0).top).toBe(6);
    expect(targetCounts(40, "warm", 0).top).toBe(14);
  });

  it("always keeps a one-jacket baseline, packing more when cold", () => {
    expect(targetCounts(7, "hot", 0).outerwear).toBe(1);
    expect(targetCounts(7, "cold", 0).outerwear).toBe(2);
  });

  it("keeps bottoms >= 2 so the shorts + pants baseline fits", () => {
    expect(targetCounts(1, "warm", 0).bottom).toBeGreaterThanOrEqual(2);
  });

  it("caps shoes at one pair for a small total load", () => {
    expect(targetCounts(8, "warm", 0, 18).shoes).toBe(1);
    expect(targetCounts(8, "warm", 0, 60).shoes).toBe(2);
  });

  it("only suggests dresses in warm/hot climates", () => {
    expect(targetCounts(8, "hot", 0).dress).toBeGreaterThan(0);
    expect(targetCounts(8, "cold", 0).dress).toBe(0);
  });
});

describe("garment classification", () => {
  it("recognises shorts and pants", () => {
    expect(isShorts({ id: "s", category: "bottom", name: "Navy Shorts" })).toBe(true);
    expect(isPants({ id: "p", category: "bottom", subcategory: "jeans" })).toBe(true);
    expect(isPants({ id: "s", category: "bottom", name: "Navy Shorts" })).toBe(false);
  });

  it("prefers light garments in heat and warm ones in the cold", () => {
    const tee = { id: "t", category: "top", name: "cotton tee" };
    const sweater = { id: "w", category: "top", subcategory: "sweater" };
    expect(climateScore(tee, "hot")).toBeGreaterThan(climateScore(sweater, "hot"));
    expect(climateScore(sweater, "cold")).toBeGreaterThan(climateScore(tee, "cold"));
  });
});

describe("seasonScore", () => {
  it("treats untagged items as neutral", () => {
    expect(seasonScore(undefined, "hot")).toBe(1);
    expect(seasonScore([], "hot")).toBe(1);
  });

  it("scores matching seasons high and mismatches zero", () => {
    expect(seasonScore(["summer"], "hot")).toBe(2);
    expect(seasonScore(["winter"], "hot")).toBe(0);
  });
});

describe("selectItems", () => {
  const targets = targetCounts(4, "warm", 0); // top: 3, bottom: 2, ...

  it("prefers in-season pieces and drops wrong-season ones when alternatives exist", () => {
    const items: PackableItem[] = [
      { id: "summerTee", category: "top", season: ["summer"], name: "tee" },
      { id: "winterKnit", category: "top", season: ["winter"], subcategory: "sweater" },
      { id: "allSeason", category: "top", season: [] },
    ];
    const selected = selectItems(items, "warm", targets);
    const ids = selected.map((s) => s.id);
    expect(ids).toContain("summerTee");
    expect(ids).toContain("allSeason");
    expect(ids).not.toContain("winterKnit");
  });

  it("backfills the baseline shirt with an off-season piece if nothing else fits", () => {
    const items: PackableItem[] = [{ id: "w1", category: "top", season: ["winter"] }];
    const selected = selectItems(items, "hot", targets);
    // The one-shirt baseline is met even though it's off-season.
    expect(selected.filter((s) => s.bucket === "top")).toHaveLength(1);
    expect(selected[0].seasonOk).toBe(false);
  });

  it("guarantees a shorts + pants baseline for bottoms", () => {
    const items: PackableItem[] = [
      { id: "shorts", category: "bottom", season: ["summer"], name: "linen shorts" },
      { id: "jeans", category: "bottom", season: ["summer"], subcategory: "jeans" },
    ];
    const selected = selectItems(items, "hot", targetCounts(1, "hot", 0));
    const ids = selected.map((s) => s.id);
    expect(ids).toContain("shorts");
    expect(ids).toContain("jeans");
  });
});

describe("packItems", () => {
  const items: SelectedItem[] = [
    { id: "a", bucket: "top", weightGrams: 200, volumeLiters: 6, seasonOk: true },
    { id: "b", bucket: "top", weightGrams: 200, volumeLiters: 6, seasonOk: true },
    { id: "c", bucket: "top", weightGrams: 200, volumeLiters: 3, seasonOk: true },
  ];

  it("first-fit-decreasing across bags by volume", () => {
    const { assignments, unplaced } = packItems(items, [
      { id: "bag1", volumeLiters: 10 },
      { id: "bag2", volumeLiters: 10 },
    ]);
    expect(unplaced).toHaveLength(0);
    expect(assignments.bag1).toEqual(["a", "c"]);
    expect(assignments.bag2).toEqual(["b"]);
  });

  it("respects a weight cap and reports unplaced items", () => {
    const heavy: SelectedItem[] = [
      { id: "x", bucket: "shoes", weightGrams: 800, volumeLiters: 1, seasonOk: true },
      { id: "y", bucket: "shoes", weightGrams: 800, volumeLiters: 1, seasonOk: true },
    ];
    const { assignments, unplaced } = packItems(heavy, [
      { id: "only", volumeLiters: 50, maxWeightKg: 1 },
    ]);
    expect(assignments.only).toEqual(["x"]);
    expect(unplaced).toEqual(["y"]);
  });
});

describe("computeUsage", () => {
  it("sums volume/weight per bag and flags over-capacity", () => {
    const estimates = new Map([
      ["a", { weightGrams: 500, volumeLiters: 8 }],
      ["b", { weightGrams: 500, volumeLiters: 5 }],
    ]);
    const { perBag, totals } = computeUsage({ bag1: ["a", "b"] }, [{ id: "bag1", volumeLiters: 10 }], estimates);
    expect(totals.count).toBe(2);
    expect(totals.weightGrams).toBe(1000);
    expect(perBag[0].overVolume).toBe(true);
  });
});

describe("buildPackingPlan", () => {
  it("selects climate-appropriate items, prefers a light jacket, and packs what fits", () => {
    const items: PackableItem[] = [
      { id: "tee1", category: "top", season: ["summer"], name: "tee" },
      { id: "tee2", category: "top", season: ["summer"], name: "tee" },
      { id: "shorts", category: "bottom", season: ["summer"], subcategory: "shorts" },
      { id: "jeans", category: "bottom", season: ["summer"], subcategory: "jeans" },
      { id: "sandals", category: "shoes", season: ["summer"], subcategory: "sandals" },
      { id: "windbreaker", category: "outerwear", season: ["summer"], subcategory: "jacket" },
      { id: "parka", category: "outerwear", season: ["winter"], subcategory: "parka" },
    ];
    const plan = buildPackingPlan({
      items,
      bags: [{ id: "carryon", volumeLiters: 40 }],
      days: 4,
      band: "hot",
      rainChance: 0.1,
    });

    const selectedIds = new Set(plan.selected.map((s) => s.id));
    const outerwear = plan.selected.filter((s) => s.bucket === "outerwear");
    // Baseline of exactly one jacket, and the light one wins for a hot trip.
    expect(outerwear).toHaveLength(1);
    expect(outerwear[0].id).toBe("windbreaker");
    // Shorts + pants baseline both present.
    expect(selectedIds.has("shorts")).toBe(true);
    expect(selectedIds.has("jeans")).toBe(true);
    // Everything selected and fitting is accounted for.
    expect(plan.totals.count).toBe(plan.selected.length - plan.unplaced.length);
    expect(plan.warnings).not.toContain("Add at least one bag to pack into.");
  });

  it("packs a single pair of shoes for a small bag", () => {
    const items: PackableItem[] = [
      { id: "sandals", category: "shoes", season: ["summer"], subcategory: "sandals" },
      { id: "slides", category: "shoes", season: ["summer"], subcategory: "slides" },
      { id: "sneakers", category: "shoes", season: [], subcategory: "sneakers" },
    ];
    const plan = buildPackingPlan({
      items,
      bags: [{ id: "daypack", volumeLiters: 18 }],
      days: 8,
      band: "hot",
      rainChance: 0,
    });
    expect(plan.selected.filter((s) => s.bucket === "shoes")).toHaveLength(1);
  });

  it("warns when there are no bags", () => {
    const plan = buildPackingPlan({
      items: [{ id: "t", category: "top", season: ["summer"] }],
      bags: [],
      days: 3,
      band: "warm",
      rainChance: 0,
    });
    expect(plan.warnings).toContain("Add at least one bag to pack into.");
  });
});
