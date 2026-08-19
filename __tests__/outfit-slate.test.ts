import { describe, expect, it } from "vitest";
import {
  BASE_SLOTS,
  buildSlate,
  MIN_DISTINCT_ITEMS,
  slotsForBand,
  usablePropensity,
  type SlateCandidate,
} from "@/lib/outfit/slate";
import { scoreOutfit } from "@/lib/outfit/compatibility";
import { mulberry32 } from "@/lib/outfit/sampling";

const color = (hex: string, name: string) => [{ hex, name }];

const CLOSET: SlateCandidate[] = [
  { id: "t1", category: "top", name: "Merino knit", colors: color("#000000", "black") },
  { id: "t2", category: "top", name: "Oxford shirt", colors: color("#ffffff", "white") },
  { id: "t3", category: "top", name: "Running jersey", colors: color("#9cd91e", "chartreuse") },
  { id: "b1", category: "bottom", name: "Wool trousers", colors: color("#888888", "grey") },
  { id: "b2", category: "bottom", name: "Selvedge jeans", colors: color("#26364f", "indigo") },
  { id: "b3", category: "bottom", name: "Board shorts", colors: color("#e01e8c", "pink") },
  { id: "s1", category: "shoes", name: "Leather loafer", colors: color("#1a1a1a", "black") },
  { id: "s2", category: "shoes", name: "Canvas sneaker", colors: color("#f0f0f0", "white") },
  { id: "s3", category: "shoes", name: "Running trainers", colors: color("#1ec8c8", "teal") },
  { id: "o1", category: "outerwear", name: "Wool overcoat", colors: color("#2a2a2a", "charcoal") },
];

describe("slotsForBand", () => {
  it("adds an optional outer layer only when it is cold enough to want one", () => {
    expect(slotsForBand("hot")).toEqual(BASE_SLOTS);
    expect(slotsForBand("mild")).toEqual(BASE_SLOTS);
    expect(slotsForBand(null)).toEqual(BASE_SLOTS);

    const cold = slotsForBand("cold");
    expect(cold).toHaveLength(4);
    expect(cold[3]).toEqual({ kind: "outerwear", optional: true });
  });
});

describe("buildSlate", () => {
  it("returns three proposals with one piece per slot", () => {
    const slate = buildSlate(CLOSET, BASE_SLOTS, { rng: mulberry32(1) });
    expect(slate).toHaveLength(3);
    for (const proposal of slate) {
      expect(proposal.itemIds).toHaveLength(3);
      expect(new Set(proposal.itemIds).size).toBe(3);
    }
  });

  it("makes the proposals genuinely distinct from one another", () => {
    // Three variations of the same outfit is a worse offer than one honest one,
    // and it teaches the preference model nothing — "picked A over two clones
    // of A" carries no signal.
    for (let seed = 0; seed < 40; seed += 1) {
      const slate = buildSlate(CLOSET, BASE_SLOTS, { rng: mulberry32(seed) });
      for (let i = 0; i < slate.length; i += 1) {
        for (let j = i + 1; j < slate.length; j += 1) {
          const overlap = slate[i].itemIds.filter((id) => slate[j].itemIds.includes(id)).length;
          expect(slate[i].itemIds.length - overlap).toBeGreaterThanOrEqual(MIN_DISTINCT_ITEMS);
        }
      }
    }
  });

  it("never proposes an excluded item", () => {
    const exclude = new Set(["t1", "t2"]);
    for (let seed = 0; seed < 20; seed += 1) {
      const slate = buildSlate(CLOSET, BASE_SLOTS, { rng: mulberry32(seed), exclude });
      for (const proposal of slate) {
        expect(proposal.itemIds).not.toContain("t1");
        expect(proposal.itemIds).not.toContain("t2");
        // Only t3 is left for the top slot, so every proposal must use it.
        expect(proposal.itemIds).toContain("t3");
      }
    }
  });

  it("returns fewer proposals rather than padding with near-duplicates", () => {
    // One viable option per slot: a second distinct proposal is impossible.
    const tiny: SlateCandidate[] = [
      { id: "t", category: "top", name: "Tee", colors: color("#000000", "black") },
      { id: "b", category: "bottom", name: "Jeans", colors: color("#26364f", "indigo") },
      { id: "s", category: "shoes", name: "Sneaker", colors: color("#ffffff", "white") },
    ];
    const slate = buildSlate(tiny, BASE_SLOTS, { rng: mulberry32(4) });
    expect(slate).toHaveLength(1);
  });

  it("returns nothing when a required slot cannot be filled", () => {
    const noShoes = CLOSET.filter((item) => item.category !== "shoes");
    expect(buildSlate(noShoes, BASE_SLOTS, { rng: mulberry32(5) })).toEqual([]);
  });

  it("skips an optional slot instead of failing the proposal", () => {
    const noOuter = CLOSET.filter((item) => item.category !== "outerwear");
    const slate = buildSlate(noOuter, slotsForBand("cold"), { rng: mulberry32(6) });
    expect(slate.length).toBeGreaterThan(0);
    expect(slate[0].itemIds).toHaveLength(3);
  });

  it("reports the score of the finished look, not a running marginal", () => {
    const slate = buildSlate(CLOSET, BASE_SLOTS, { rng: mulberry32(9) });
    for (const proposal of slate) {
      const items = proposal.itemIds.map((id) => CLOSET.find((c) => c.id === id)!);
      expect(proposal.score).toBeCloseTo(scoreOutfit(items).score, 10);
    }
  });

  it("favours coherent looks over clashing ones", () => {
    const meanScore = (temperature: number) => {
      let total = 0;
      let n = 0;
      for (let seed = 0; seed < 120; seed += 1) {
        for (const p of buildSlate(CLOSET, BASE_SLOTS, { rng: mulberry32(seed), temperature })) {
          total += p.score;
          n += 1;
        }
      }
      return total / n;
    };
    expect(meanScore(0.05)).toBeGreaterThan(meanScore(1));
  });
});

describe("propensity", () => {
  it("is a probability", () => {
    for (let seed = 0; seed < 60; seed += 1) {
      for (const proposal of buildSlate(CLOSET, BASE_SLOTS, { rng: mulberry32(seed) })) {
        expect(proposal.propensity).toBeGreaterThan(0);
        expect(proposal.propensity).toBeLessThanOrEqual(1);
      }
    }
  });

  it("is 1 when there was no choice to make", () => {
    // One candidate per slot: the policy could not have done anything else, so
    // P(shown | policy) is exactly 1. Anything less would bias an IPS estimate.
    const tiny: SlateCandidate[] = [
      { id: "t", category: "top", name: "Tee", colors: color("#000000", "black") },
      { id: "b", category: "bottom", name: "Jeans", colors: color("#26364f", "indigo") },
      { id: "s", category: "shoes", name: "Sneaker", colors: color("#ffffff", "white") },
    ];
    const [proposal] = buildSlate(tiny, BASE_SLOTS, { rng: mulberry32(11) });
    expect(proposal.propensity).toBeCloseTo(1, 10);
  });

  it("matches the empirical frequency of what actually gets proposed", () => {
    // The real check on a logged propensity: over many draws, the recorded
    // probability of a given outfit should match how often it comes up. If
    // these disagree, every future off-policy estimate is quietly wrong.
    const counts = new Map<string, number>();
    const claimed = new Map<string, number>();
    const RUNS = 4000;

    for (let seed = 0; seed < RUNS; seed += 1) {
      // Take only the first proposal: later ones are conditioned on the
      // distinctness constraint and are not draws from the raw policy.
      const [first] = buildSlate(CLOSET, BASE_SLOTS, { rng: mulberry32(seed), count: 1 });
      if (!first) continue;
      const key = first.itemIds.join(",");
      counts.set(key, (counts.get(key) ?? 0) + 1);
      claimed.set(key, first.propensity);
    }

    // Check the outfits common enough for the frequency estimate to mean
    // something; rare ones are dominated by sampling noise.
    let checked = 0;
    for (const [key, count] of counts) {
      if (count < 60) continue;
      const empirical = count / RUNS;
      const stated = claimed.get(key)!;
      expect(Math.abs(empirical - stated)).toBeLessThan(0.05);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe("usablePropensity", () => {
  /**
   * The propensity round-trips through the browser, so a bad value can arrive.
   * slate.ts is explicit that recording the wrong one is worse than recording
   * none — a corrupt number biases every future off-policy estimate with
   * nothing in the data to show it happened. So the gate refuses rather than
   * coerces.
   */
  it("accepts a probability", () => {
    expect(usablePropensity(0.25)).toBe(0.25);
    expect(usablePropensity(1)).toBe(1);
    expect(usablePropensity(1e-9)).toBe(1e-9);
  });

  it("refuses anything that is not one", () => {
    // Zero would divide by zero in an importance weight.
    expect(usablePropensity(0)).toBeNull();
    expect(usablePropensity(-0.5)).toBeNull();
    // Above 1 is unreachable by multiplying softmax terms, so it is corrupt.
    expect(usablePropensity(1.0001)).toBeNull();
    expect(usablePropensity(Number.NaN)).toBeNull();
    expect(usablePropensity(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("refuses non-numbers rather than coercing them", () => {
    expect(usablePropensity(undefined)).toBeNull();
    expect(usablePropensity(null)).toBeNull();
    expect(usablePropensity("0.5")).toBeNull();
    expect(usablePropensity({})).toBeNull();
  });

  it("passes through what buildSlate actually produces", () => {
    const proposals = buildSlate(CLOSET, BASE_SLOTS, { rng: mulberry32(7) });
    expect(proposals.length).toBeGreaterThan(0);
    for (const proposal of proposals) {
      expect(usablePropensity(proposal.propensity)).toBe(proposal.propensity);
    }
  });
});
