import { describe, expect, it } from "vitest";
import {
  buildPosterior,
  EVIDENCE_HALF_LIFE,
  gaussian,
  noveltyScore,
  PRIOR_STDEV,
  stdevFor,
  thompsonDraw,
  WEAR_PRECISION_WEIGHT,
} from "@/lib/outfit/posterior";
import { buildSlate, BASE_SLOTS, SAFE_TEMPERATURE, type SlateCandidate } from "@/lib/outfit/slate";
import { mulberry32 } from "@/lib/outfit/sampling";

describe("stdevFor", () => {
  it("is most uncertain about an item nothing is known about", () => {
    expect(stdevFor({})).toBeCloseTo(PRIOR_STDEV, 10);
  });

  it("tightens with evidence, and never below zero", () => {
    const none = stdevFor({});
    const some = stdevFor({ comparisons: 5 });
    const lots = stdevFor({ comparisons: 200 });
    expect(some).toBeLessThan(none);
    expect(lots).toBeLessThan(some);
    expect(lots).toBeGreaterThan(0);
  });

  it("counts a wear as weaker evidence than a comparison", () => {
    // Putting something on says you were willing; picking it over two
    // alternatives says you preferred it.
    expect(stdevFor({ wears: 10 })).toBeGreaterThan(stdevFor({ comparisons: 10 }));
    expect(WEAR_PRECISION_WEIGHT).toBeLessThan(1);
  });

  it("still learns from wears alone, so a much-worn item is not 'unknown'", () => {
    // The bug this pins: with the prior worth 16 pseudo-observations, fifty
    // wears left an item looking almost as unknown as an unworn one, and the
    // explore slot kept re-surfacing the user's favourites.
    expect(stdevFor({ wears: 50 })).toBeLessThan(PRIOR_STDEV / 2);
  });

  it("halves uncertainty within a realistic amount of evidence", () => {
    expect(stdevFor({ comparisons: 3 * EVIDENCE_HALF_LIFE })).toBeCloseTo(PRIOR_STDEV / 2, 6);
  });

  it("treats negative counts as no evidence rather than negative precision", () => {
    expect(stdevFor({ comparisons: -5, wears: -5 })).toBeCloseTo(PRIOR_STDEV, 10);
  });
});

describe("noveltyScore", () => {
  it("is 1 for a completely unknown item and falls with evidence", () => {
    expect(noveltyScore({})).toBeCloseTo(1, 10);
    expect(noveltyScore({ wears: 30 })).toBeLessThan(0.6);
  });
});

describe("buildPosterior", () => {
  it("includes items that have evidence but no affinity opinion", () => {
    // These are the *most* uncertain garments in the closet; dropping them
    // would exclude exactly what exploration exists to surface.
    const posterior = buildPosterior(new Map(), new Map([["lonely", { wears: 0 }]]));
    expect(posterior.stdev.get("lonely")).toBeCloseTo(PRIOR_STDEV, 10);
  });
});

describe("gaussian", () => {
  it("has roughly zero mean and unit variance", () => {
    const rng = mulberry32(11);
    const draws = Array.from({ length: 20000 }, () => gaussian(rng));
    const mean = draws.reduce((s, d) => s + d, 0) / draws.length;
    const variance = draws.reduce((s, d) => s + (d - mean) ** 2, 0) / draws.length;
    expect(Math.abs(mean)).toBeLessThan(0.05);
    expect(Math.abs(variance - 1)).toBeLessThan(0.1);
  });

  it("never returns a non-finite value", () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 5000; i += 1) expect(Number.isFinite(gaussian(rng))).toBe(true);
  });
});

describe("thompsonDraw", () => {
  const posterior = buildPosterior(
    new Map([
      ["known", 0.8],
      ["unknown", 0.5],
    ]),
    new Map([
      ["known", { comparisons: 200 }],
      ["unknown", {}],
    ]),
  );

  it("stays inside the affinity range", () => {
    const rng = mulberry32(5);
    for (let i = 0; i < 500; i += 1) {
      for (const value of thompsonDraw(posterior, ["known", "unknown"], rng).values()) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it("varies far more for the item we know nothing about", () => {
    const rng = mulberry32(9);
    const spread = (id: string) => {
      const draws = Array.from({ length: 2000 }, () => thompsonDraw(posterior, [id], rng).get(id)!);
      const mean = draws.reduce((s, d) => s + d, 0) / draws.length;
      return Math.sqrt(draws.reduce((s, d) => s + (d - mean) ** 2, 0) / draws.length);
    };
    expect(spread("unknown")).toBeGreaterThan(spread("known") * 3);
  });
});

/**
 * The Phase 4 claim, and the one worth pinning: the third slot should surface
 * the clothes the user neglects, purely as a side effect of being uncertain
 * about them. If this passes, exploration and utilization really are one
 * mechanism rather than two features.
 */
describe("the explore slot as the utilization engine", () => {
  const color = (hex: string, name: string) => [{ hex, name }];

  // Twelve garments; the "fav-" ones are heavily worn, the "dusty-" ones never.
  const CLOSET: SlateCandidate[] = [
    { id: "fav-top", category: "top", name: "Merino knit", colors: color("#000000", "black") },
    { id: "fav-bottom", category: "bottom", name: "Wool trousers", colors: color("#222222", "black") },
    { id: "fav-shoes", category: "shoes", name: "Leather loafer", colors: color("#111111", "black") },
    { id: "dusty-top", category: "top", name: "Oxford shirt", colors: color("#f2f2f2", "white") },
    { id: "dusty-bottom", category: "bottom", name: "Selvedge jeans", colors: color("#26364f", "indigo") },
    { id: "dusty-shoes", category: "shoes", name: "Canvas sneaker", colors: color("#efefef", "white") },
    { id: "mid-top", category: "top", name: "Silk blouse", colors: color("#1a2a4a", "navy") },
    { id: "mid-bottom", category: "bottom", name: "Chino", colors: color("#8a8a8a", "grey") },
    { id: "mid-shoes", category: "shoes", name: "Chelsea boot", colors: color("#2a2a2a", "charcoal") },
  ];

  const affinity = new Map(
    CLOSET.map((item) => [item.id, item.id.startsWith("fav-") ? 0.85 : 0.5]),
  );
  const evidence = new Map(
    CLOSET.map((item) => [
      item.id,
      item.id.startsWith("fav-")
        ? { comparisons: 40, wears: 60 }
        : item.id.startsWith("dusty-")
          ? {}
          : { comparisons: 3, wears: 4 },
    ]),
  );
  const posterior = buildPosterior(affinity, evidence);

  function slateFor(seed: number) {
    return buildSlate(CLOSET, BASE_SLOTS, {
      context: { affinity },
      posterior,
      rng: mulberry32(seed),
    });
  }

  it("labels the three arms", () => {
    const slate = slateFor(1);
    expect(slate.map((p) => p.strategy)).toEqual(["safe", "alternative", "explore"]);
  });

  it("puts the well-liked, well-known pieces in the safe slot", () => {
    let favInSafe = 0;
    for (let seed = 0; seed < 60; seed += 1) {
      const safe = slateFor(seed).find((p) => p.strategy === "safe");
      favInSafe += safe!.itemIds.filter((id) => id.startsWith("fav-")).length;
    }
    // Near-greedy on the mean, so the high-affinity pieces should dominate.
    expect(favInSafe / 60).toBeGreaterThan(1.5);
  });

  it("surfaces neglected pieces in the explore slot far more often", () => {
    let dustyInSafe = 0;
    let dustyInExplore = 0;
    for (let seed = 0; seed < 120; seed += 1) {
      const slate = slateFor(seed);
      dustyInSafe +=
        slate.find((p) => p.strategy === "safe")?.itemIds.filter((id) => id.startsWith("dusty-"))
          .length ?? 0;
      dustyInExplore +=
        slate.find((p) => p.strategy === "explore")?.itemIds.filter((id) => id.startsWith("dusty-"))
          .length ?? 0;
    }
    expect(dustyInExplore).toBeGreaterThan(dustyInSafe);
  });

  it("keeps the explore slot a real outfit, not a random one", () => {
    // Exploration is a bet on an under-tested garment, not a licence to ignore
    // the slot structure or the compatibility prior.
    for (let seed = 0; seed < 30; seed += 1) {
      const explore = slateFor(seed).find((p) => p.strategy === "explore")!;
      expect(explore.itemIds).toHaveLength(3);
      expect(new Set(explore.itemIds).size).toBe(3);
      const categories = explore.itemIds
        .map((id) => CLOSET.find((c) => c.id === id)!.category)
        .sort();
      expect(categories).toEqual(["bottom", "shoes", "top"]);
    }
  });

  it("still logs a usable propensity on every arm", () => {
    for (const proposal of slateFor(4)) {
      expect(proposal.propensity).toBeGreaterThan(0);
      expect(proposal.propensity).toBeLessThanOrEqual(1);
    }
  });

  it("falls back to plain sampling with no posterior supplied", () => {
    const slate = buildSlate(CLOSET, BASE_SLOTS, {
      context: { affinity },
      rng: mulberry32(2),
      temperature: SAFE_TEMPERATURE,
    });
    expect(slate.length).toBeGreaterThan(0);
    expect(slate[0].strategy).toBe("safe");
  });
});
