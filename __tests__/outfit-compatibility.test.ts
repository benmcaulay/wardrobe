import { describe, expect, it } from "vitest";
import {
  formalityCoherence,
  formalitySpread,
  FREE_SPREAD,
  itemFormality,
} from "@/lib/outfit/formality";
import { climateFit, outfitWarmth } from "@/lib/outfit/climate";
import {
  isBoldPattern,
  patternPenalty,
  scoreAddition,
  scoreOutfit,
  TERM_WEIGHTS,
} from "@/lib/outfit/compatibility";
import { bilinearCompatibility, hasBilinearWeights, pairKey } from "@/lib/outfit/bilinear";
import { DEFAULT_TEMPERATURE, mulberry32, scoredOrder } from "@/lib/outfit/sampling";

describe("itemFormality", () => {
  it("puts black tie at the top and loungewear at the bottom", () => {
    expect(itemFormality({ category: "outerwear", name: "Tuxedo jacket" })).toBe(10);
    expect(itemFormality({ category: "bottom", name: "Fleece sweatpants" })).toBeLessThanOrEqual(2);
  });

  it("reads formality from the name when the category is vague", () => {
    // Category is 100% populated but often generic; the name is what rescues it.
    expect(itemFormality({ category: "shoes", name: "Patent oxford" })).toBeGreaterThan(8);
    expect(itemFormality({ category: "shoes", name: "Canvas sneaker" })).toBeLessThan(5);
  });

  it("resolves the compound terms that a broader rule would swallow", () => {
    // "dress shirt" is business attire, not a dress.
    expect(itemFormality({ category: "top", name: "White dress shirt" })).toBe(8);
    expect(itemFormality({ category: "bottom", name: "Dress trousers" })).toBe(8);
  });

  it("falls back to a mid-scale baseline for an unrecognised item", () => {
    const score = itemFormality({ category: "top", name: "Thing" });
    expect(score).toBeGreaterThan(3);
    expect(score).toBeLessThan(7);
  });
});

describe("formality coherence", () => {
  it("measures spread, so one wrong piece is not diluted by three right ones", () => {
    expect(formalitySpread([8, 8, 8, 2])).toBe(6);
    // Variance would have called this nearly fine; spread does not.
    expect(formalityCoherence([8, 8, 8, 2])).toBeLessThan(0.5);
  });

  it("does not punish ordinary smart-casual mixing", () => {
    expect(formalityCoherence([6.5, 6, 5])).toBe(1);
    expect(formalitySpread([6.5, 6, 5])).toBeLessThanOrEqual(FREE_SPREAD);
  });

  it("scores a single item as perfectly coherent", () => {
    expect(formalityCoherence([4])).toBe(1);
    expect(formalityCoherence([])).toBe(1);
  });

  it("catches a gross mismatch", () => {
    const tuxedo = itemFormality({ category: "outerwear", name: "Tuxedo jacket" });
    const sweatpants = itemFormality({ category: "bottom", name: "Fleece sweatpants" });
    expect(formalityCoherence([tuxedo, sweatpants])).toBe(0);
  });

  it("does not condemn blazer-with-jeans, which is a real outfit", () => {
    // The honest limit of a one-dimensional ladder: blazer + jeans and suit +
    // running trainers are the same spread, and only one of them is a mistake.
    // So the term is tuned to flag gross mismatches and merely nudge the
    // middle, rather than pretending to a precision it does not have.
    const blazer = itemFormality({ category: "outerwear", name: "Wool blazer" });
    const jeans = itemFormality({ category: "bottom", name: "Selvedge jeans" });
    expect(formalityCoherence([blazer, jeans])).toBeGreaterThan(0.5);
  });
});

describe("climate fit", () => {
  const coat = { id: "c", category: "outerwear", name: "Wool parka" };
  const tee = { id: "t", category: "top", name: "Cotton tee" };
  const shorts = { id: "s", category: "bottom", name: "Linen shorts" };

  it("lets the heaviest layer carry the look rather than averaging it away", () => {
    // A parka over a tee is warm. An average over the pieces would call it mild
    // and put you outside underdressed.
    const layered = outfitWarmth([coat, tee]);
    expect(layered).toBeGreaterThan(outfitWarmth([tee]));
    expect(layered).toBeGreaterThan(2);
  });

  it("prefers light clothes in heat and heavy ones in cold", () => {
    expect(climateFit([tee, shorts], "hot")).toBeGreaterThan(climateFit([coat, tee], "hot"));
    expect(climateFit([coat, tee], "cold")).toBeGreaterThan(climateFit([tee, shorts], "cold"));
  });

  it("punishes underdressing for cold harder than overdressing, at equal miss", () => {
    // Compare the same magnitude of error in each direction. Two different
    // outfits would be comparing miss sizes, not the asymmetry.
    const knit = { id: "k", category: "top", name: "Wool sweater" }; // warmth 2
    const underCool = climateFit([knit], "cold"); // 2 vs 2.6 → miss -0.6
    const overWarm = climateFit([knit], "mild"); // 2 vs 1.4 → miss +0.6
    expect(underCool).toBeLessThan(overWarm);
  });

  it("keeps ranking candidates even when the whole closet is wrong for the weather", () => {
    // A linear ramp floors both of these at exactly 0, which silently removes
    // the climate term from ranking in the weather where it matters most.
    const knit = { id: "k", category: "top", name: "Wool sweater" }; // warmth 2
    const hopeless = climateFit([tee, shorts], "cold"); // warmth 0, miss -2.6
    const merelyBad = climateFit([knit, shorts], "cold"); // warmth 2, miss -0.6
    expect(hopeless).toBeGreaterThan(0);
    expect(merelyBad).toBeGreaterThan(hopeless);
  });

  it("stays neutral with no forecast rather than penalising every candidate", () => {
    expect(climateFit([tee, shorts], null)).toBe(0.75);
    expect(climateFit([], "cold")).toBe(0.75);
  });
});

describe("pattern rules", () => {
  it("recognises loud patterns and ignores quiet ones", () => {
    expect(isBoldPattern("Leopard print")).toBe(true);
    expect(isBoldPattern("floral")).toBe(true);
    expect(isBoldPattern("pinstripe")).toBe(false);
    expect(isBoldPattern("solid")).toBe(false);
  });

  it("is exactly neutral when the field is unpopulated", () => {
    // `pattern` is sparse on real data, so as a weighted term it would drag
    // every untagged look toward the middle. As a multiplier it does nothing.
    expect(patternPenalty([{ id: "a", category: "top" }, { id: "b", category: "bottom" }])).toBe(1);
    expect(patternPenalty([{ id: "a", category: "top", pattern: null }])).toBe(1);
  });

  it("allows one focal pattern but penalises two", () => {
    const one = patternPenalty([
      { id: "a", category: "top", pattern: "floral" },
      { id: "b", category: "bottom", pattern: "solid" },
    ]);
    const two = patternPenalty([
      { id: "a", category: "top", pattern: "floral" },
      { id: "b", category: "bottom", pattern: "plaid" },
    ]);
    expect(one).toBe(1);
    expect(two).toBeLessThan(1);
  });
});

describe("scoreOutfit", () => {
  const black = [{ hex: "#000000", name: "black" }];
  const white = [{ hex: "#ffffff", name: "white" }];
  const red = [{ hex: "#c81e1e", name: "red" }];
  const chartreuse = [{ hex: "#9cd91e", name: "chartreuse" }];

  it("prefers a coherent look to a clashing one", () => {
    const good = scoreOutfit([
      { id: "a", category: "top", name: "Merino knit", colors: black },
      { id: "b", category: "bottom", name: "Wool trousers", colors: white },
    ]);
    const bad = scoreOutfit([
      { id: "a", category: "top", name: "Running jersey", colors: red },
      { id: "b", category: "bottom", name: "Dress trousers", colors: chartreuse },
    ]);
    expect(good.score).toBeGreaterThan(bad.score);
  });

  it("reports which terms had an opinion", () => {
    const result = scoreOutfit([
      { id: "a", category: "top", colors: black },
      { id: "b", category: "bottom", colors: white },
    ]);
    expect(result.color).not.toBeNull();
    expect(result.formality).not.toBeNull();
    // No band supplied and no trained bilinear weights.
    expect(result.climate).toBeNull();
    expect(result.bilinear).toBeNull();
  });

  it("renormalizes around missing terms instead of scoring absence", () => {
    // An item with no colours must not be dragged down for it — the remaining
    // terms should carry the score.
    const result = scoreOutfit([
      { id: "a", category: "top", name: "Merino knit" },
      { id: "b", category: "bottom", name: "Wool trousers" },
    ]);
    expect(result.score).toBeGreaterThan(0.5);
  });

  it("returns zero for an empty look rather than a neutral score", () => {
    expect(scoreOutfit([]).score).toBe(0);
  });

  it("keeps every score inside [0, 1] even with a pattern penalty applied", () => {
    const result = scoreOutfit([
      { id: "a", category: "top", pattern: "leopard", colors: red },
      { id: "b", category: "bottom", pattern: "plaid", colors: chartreuse },
      { id: "c", category: "shoes", pattern: "floral", colors: chartreuse },
    ]);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });
});

describe("scoreAddition", () => {
  const black = [{ hex: "#000000", name: "black" }];
  const red = [{ hex: "#c81e1e", name: "red" }];
  const chartreuse = [{ hex: "#9cd91e", name: "chartreuse" }];

  it("ranks a harmonious candidate above a clashing one", () => {
    const placed = [{ id: "p", category: "top", name: "Silk blouse", colors: red }];
    const safe = scoreAddition(placed, {
      id: "a",
      category: "bottom",
      name: "Wool trousers",
      colors: black,
    });
    const clashing = scoreAddition(placed, {
      id: "b",
      category: "bottom",
      name: "Wool trousers",
      colors: chartreuse,
    });
    expect(safe).toBeGreaterThan(clashing);
  });

  it("is neutral with nothing placed yet", () => {
    expect(scoreAddition([], { id: "a", category: "top", colors: black })).toBe(0.6);
  });
});

describe("bilinear term", () => {
  it("is inert until Polyvore weights are trained", () => {
    // Reporting null rather than a cosine stand-in is the point: a stand-in
    // would optimise for visual *similarity*, which is the exact failure the
    // type-aware term exists to prevent.
    expect(hasBilinearWeights()).toBe(false);
    expect(bilinearCompatibility("top", new Float32Array(512), "bottom", new Float32Array(512))).toBeNull();
  });

  it("keys category pairs symmetrically", () => {
    expect(pairKey("top", "bottom")).toBe(pairKey("bottom", "top"));
    expect(pairKey("Top", "BOTTOM")).toBe(pairKey("bottom", "top"));
  });

  it("carries a real weight, so trained weights change the blend without code changes", () => {
    expect(TERM_WEIGHTS.bilinear).toBeGreaterThan(0);
  });
});

describe("scoredOrder", () => {
  const items = [
    { item: "best", score: 0.95 },
    { item: "mid", score: 0.6 },
    { item: "worst", score: 0.2 },
  ];

  it("puts high scorers first far more often than not", () => {
    let firstIsBest = 0;
    for (let seed = 0; seed < 400; seed += 1) {
      if (scoredOrder(items, mulberry32(seed))[0] === "best") firstIsBest += 1;
    }
    expect(firstIsBest / 400).toBeGreaterThan(0.85);
  });

  it("still reaches the weaker options, so the button stays useful", () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 400; seed += 1) {
      seen.add(scoredOrder(items, mulberry32(seed))[0]);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("returns every candidate exactly once", () => {
    const order = scoredOrder(items, mulberry32(7));
    expect([...order].sort()).toEqual(["best", "mid", "worst"]);
  });

  it("collapses to a deterministic ranking at zero temperature", () => {
    expect(scoredOrder(items, mulberry32(1), 0)).toEqual(["best", "mid", "worst"]);
  });

  it("does not overflow at very low temperature", () => {
    const order = scoredOrder(items, mulberry32(3), 1e-3);
    expect(order).toHaveLength(3);
    expect(order.every((entry) => typeof entry === "string")).toBe(true);
  });

  it("handles degenerate input without dropping candidates", () => {
    const flat = [
      { item: "a", score: 0 },
      { item: "b", score: 0 },
    ];
    expect(scoredOrder(flat, mulberry32(2))).toHaveLength(2);
    expect(scoredOrder([], mulberry32(2), DEFAULT_TEMPERATURE)).toEqual([]);
  });
});
