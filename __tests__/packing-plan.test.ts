import { describe, expect, it } from "vitest";
import {
  bucketFor,
  buildPackingPlan,
  climateScore,
  coverThenFill,
  coveredDays,
  garmentWarmth,
  computeUsage,
  isPants,
  isShorts,
  packItems,
  seasonScore,
  selectItems,
  targetCounts,
  type CategoryBucket,
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

describe("buildPackingPlan shortfall warnings", () => {
  const bags = [{ id: "carryon", volumeLiters: 40 }];

  it("warns when a whole essential category is missing from the closet", () => {
    // Shoes and accessories only — no tops, no bottoms. This is exactly the
    // shape the category-mapping bug produced, and it used to come back with
    // an empty `warnings` array, i.e. reported as a successful plan.
    const items: PackableItem[] = [
      { id: "s1", category: "shoes", name: "sneakers" },
      { id: "a1", category: "accessory", name: "cap" },
    ];
    const plan = buildPackingPlan({ items, bags, days: 8, band: "hot", rainChance: 0.1 });

    expect(plan.warnings.some((w) => /tops/.test(w))).toBe(true);
    expect(plan.warnings.some((w) => /bottoms/.test(w))).toBe(true);
  });

  it("names every missing essential category in one warning", () => {
    const plan = buildPackingPlan({ items: [], bags, days: 4, band: "mild", rainChance: 0 });
    const shortfall = plan.warnings.find((w) => /Nothing in your closet matched/.test(w));
    expect(shortfall).toBeDefined();
    expect(shortfall).toMatch(/tops, bottoms, shoes or outerwear/);
  });

  it("stays quiet when every essential category is filled", () => {
    const items: PackableItem[] = [
      { id: "t1", category: "shirt", season: ["summer"], name: "tee" },
      { id: "b1", category: "shorts", season: ["summer"], name: "shorts" },
      { id: "b2", category: "pants", season: ["summer"], name: "chinos" },
      { id: "o1", category: "jacket", season: ["summer"], name: "light jacket" },
      { id: "s1", category: "shoes", season: ["summer"], name: "sandals" },
    ];
    const plan = buildPackingPlan({ items, bags, days: 3, band: "hot", rainChance: 0 });
    expect(plan.warnings.filter((w) => /Nothing in your closet matched/.test(w))).toEqual([]);
  });

  it("does not warn about a category the trip never asked for", () => {
    // Dresses have a target of 0 in cold weather, so their absence is correct.
    const items: PackableItem[] = [
      { id: "t1", category: "shirt", season: ["winter"], name: "thermal" },
      { id: "b1", category: "pants", season: ["winter"], name: "jeans" },
      { id: "o1", category: "jacket", season: ["winter"], name: "parka" },
      { id: "s1", category: "shoes", season: ["winter"], name: "boots" },
    ];
    const plan = buildPackingPlan({ items, bags, days: 5, band: "cold", rainChance: 0 });
    expect(plan.warnings.some((w) => /dresses/.test(w))).toBe(false);
  });
});

describe("garmentWarmth uses an accessory scale", () => {
  it("does not score a denim cap as denim", () => {
    // Matched the jeans/denim rule and scored 2, which reads as a cold-weather
    // garment and won slots in mild climates over actual shirts.
    expect(garmentWarmth({ id: "c", category: "hat", name: "Evisu Denim Cap" })).toBe(0.3);
  });

  it("keeps cold-weather accessories warm", () => {
    expect(garmentWarmth({ id: "s", category: "accessory", name: "Wool Scarf" })).toBe(2);
    expect(garmentWarmth({ id: "g", category: "accessory", name: "Leather Gloves" })).toBe(2);
  });

  it("leaves real garments on the garment scale", () => {
    expect(garmentWarmth({ id: "j", category: "pants", name: "Baggy Jeans" })).toBe(2);
    expect(garmentWarmth({ id: "p", category: "jacket", name: "Parka" })).toBe(3);
  });
});

describe("climateScore discriminates on colour", () => {
  const top = (name: string, colors: { name: string; hex: string }[]): PackableItem => ({
    id: name, category: "shirt", name, colors,
  });
  const black = top("black shirt", [{ name: "black", hex: "#000" }]);
  const orange = top("orange shirt", [{ name: "orange", hex: "#f80" }]);

  it("prefers the more versatile colour between otherwise identical garments", () => {
    // The whole point of the term: before it, these two scored identically and
    // the winner was whichever the database returned first.
    expect(climateScore(black, "mild")).toBeGreaterThan(climateScore(orange, "mild"));
  });

  it("does not let colour override climate fit", () => {
    // A well-coloured tee must still lose to a poorly-coloured shirt in mild
    // weather — climate is the senior term.
    const neutralTee = { ...top("black tee", [{ name: "black", hex: "#000" }]), name: "black tee" };
    expect(climateScore(orange, "mild")).toBeGreaterThan(climateScore(neutralTee, "mild"));
  });

  it("keeps season dominant when the tag exists", () => {
    const inSeason: PackableItem = { ...orange, season: ["summer"] };
    expect(climateScore(inSeason, "hot")).toBeGreaterThan(climateScore(black, "hot"));
  });

  it("does not punish an item that has no colour data", () => {
    const noColour = top("plain shirt", []);
    expect(climateScore(noColour, "mild")).toBeGreaterThan(climateScore(orange, "mild"));
    expect(climateScore(noColour, "mild")).toBeLessThan(climateScore(black, "mild"));
  });

  it("reads an unhyphenated tee as a tee", () => {
    // "Vagabond T Shirt" fell through to the shirt rule and outscored an
    // identical "T-shirt" by a full point purely on spelling.
    expect(garmentWarmth({ id: "a", category: "shirt", name: "Vagabond T Shirt" })).toBe(
      garmentWarmth({ id: "b", category: "shirt", name: "Vagabond T-shirt" }),
    );
  });
});

describe("coveredDays", () => {
  it("is a minimum across essentials, not a sum", () => {
    // Eight tops and no bottoms dresses you for zero days. The old packer
    // scored exactly this arrangement highly, because it measured litres.
    expect(coveredDays({ top: 8, shoes: 1 }, 8)).toBe(0);
    expect(coveredDays({ bottom: 8, shoes: 1 }, 8)).toBe(0);
  });

  it("needs shoes", () => {
    expect(coveredDays({ top: 8, bottom: 8 }, 8)).toBe(0);
  });

  it("applies re-wear: one bottom covers several days", () => {
    expect(coveredDays({ top: 2, bottom: 1, shoes: 1 }, 8)).toBe(3);
  });

  it("caps at the trip length", () => {
    expect(coveredDays({ top: 40, bottom: 40, shoes: 1 }, 5)).toBe(5);
  });

  it("lets a dress cover both halves", () => {
    expect(coveredDays({ dress: 4, shoes: 1 }, 6)).toBe(6);
  });

  it("is zero for an empty bag", () => {
    expect(coveredDays({}, 7)).toBe(0);
  });
});

describe("coverThenFill", () => {
  const item = (id: string, bucket: CategoryBucket, volumeLiters: number): SelectedItem => ({
    id, bucket, volumeLiters, weightGrams: volumeLiters * 200, seasonOk: true,
  });
  const targets = { top: 8, bottom: 4, dress: 0, outerwear: 1, shoes: 2, accessory: 3, other: 0 };

  it("does not let bulk evict every top — the original failure", () => {
    // 18 L against ~24 L of candidates. FFD packed largest-first and left zero
    // tops; coverage-first must keep tops.
    const selected: SelectedItem[] = [
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => item(`top${n}`, "top", 1.2)),
      ...[1, 2, 3, 4].map((n) => item(`bot${n}`, "bottom", 2.2)),
      item("jacket", "outerwear", 3.5),
      item("shoe1", "shoes", 3.5),
      item("shoe2", "shoes", 3.5),
    ];
    const { assignments, counts } = coverThenFill(selected, [{ id: "bag", volumeLiters: 18 }], {
      days: 8, targets,
    });
    expect(counts.top ?? 0).toBeGreaterThanOrEqual(3);
    expect(assignments.bag.length).toBeGreaterThan(0);
  });

  it("guarantees the floor before spending space on extras", () => {
    const selected: SelectedItem[] = [
      item("top1", "top", 1), item("bot1", "bottom", 1),
      item("shoe1", "shoes", 1), item("jacket", "outerwear", 1),
      item("shoe2", "shoes", 1),
    ];
    const { counts } = coverThenFill(selected, [{ id: "bag", volumeLiters: 4 }], { days: 5, targets });
    expect(counts.top).toBe(1);
    expect(counts.bottom).toBe(1);
    expect(counts.shoes).toBe(1);
    expect(counts.outerwear).toBe(1);
  });

  it("never exceeds a bucket's target", () => {
    const selected = [...Array(20)].map((_, i) => item(`top${i}`, "top", 0.1));
    const { counts } = coverThenFill(selected, [{ id: "bag", volumeLiters: 100 }], {
      days: 30, targets: { ...targets, top: 3 },
    });
    expect(counts.top).toBe(3);
  });

  it("does not over-pack a huge bag for a short trip", () => {
    // With unlimited space the only thing stopping a 20-top pack is the
    // day-scaled target, so use the real one rather than a synthetic target.
    const realTargets = targetCounts(3, "mild", 0, 100);
    const selected: SelectedItem[] = [
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => item(`top${n}`, "top", 1)),
      ...[1, 2, 3].map((n) => item(`bot${n}`, "bottom", 1)),
      item("shoe1", "shoes", 1),
    ];
    const { counts } = coverThenFill(selected, [{ id: "bag", volumeLiters: 100 }], {
      days: 3, targets: realTargets,
    });
    expect(counts.top).toBeLessThanOrEqual(realTargets.top);
    expect(counts.top).toBeLessThan(8);
  });

  it("spreads across multiple bags", () => {
    const selected: SelectedItem[] = [
      item("top1", "top", 3), item("bot1", "bottom", 3),
      item("shoe1", "shoes", 3), item("jacket", "outerwear", 3),
    ];
    const { assignments, unplaced } = coverThenFill(
      selected, [{ id: "a", volumeLiters: 6 }, { id: "b", volumeLiters: 6 }], { days: 2, targets },
    );
    expect(unplaced).toHaveLength(0);
    expect(assignments.a.length + assignments.b.length).toBe(4);
  });

  it("respects a weight cap", () => {
    const selected: SelectedItem[] = [
      { id: "h1", bucket: "shoes", volumeLiters: 1, weightGrams: 900, seasonOk: true },
      { id: "h2", bucket: "shoes", volumeLiters: 1, weightGrams: 900, seasonOk: true },
    ];
    const { unplaced } = coverThenFill(selected, [{ id: "bag", volumeLiters: 50, maxWeightKg: 1 }], {
      days: 3, targets,
    });
    expect(unplaced).toHaveLength(1);
  });

  it("handles no bags and no items without throwing", () => {
    expect(coverThenFill([], [], { days: 5, targets }).unplaced).toEqual([]);
    const only = coverThenFill([item("t", "top", 1)], [], { days: 5, targets });
    expect(only.unplaced).toEqual(["t"]);
  });

  it("is deterministic", () => {
    const selected: SelectedItem[] = [
      ...[1, 2, 3, 4].map((n) => item(`top${n}`, "top", 1.2)),
      ...[1, 2].map((n) => item(`bot${n}`, "bottom", 2.2)),
      item("shoe1", "shoes", 3.5),
    ];
    const bags = [{ id: "bag", volumeLiters: 9 }];
    const a = coverThenFill(selected, bags, { days: 6, targets });
    const b = coverThenFill(selected, bags, { days: 6, targets });
    expect(a.assignments).toEqual(b.assignments);
    expect(a.unplaced).toEqual(b.unplaced);
  });
});
