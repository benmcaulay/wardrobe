import { describe, expect, it } from "vitest";
import {
  DEFAULT_REGULARIZATION,
  fitBradleyTerry,
  utilityToScore,
  type Comparison,
} from "@/lib/outfit/bradley-terry";
import {
  buildAffinityMap,
  LAMBDA_HALF_LIFE,
  lambdaFor,
  NEUTRAL_AFFINITY,
  outfitAffinity,
} from "@/lib/outfit/affinity";

describe("fitBradleyTerry", () => {
  it("ranks a consistent winner above a consistent loser", () => {
    const comparisons: Comparison[] = Array.from({ length: 8 }, () => ({
      winners: ["good"],
      losers: ["bad"],
    }));
    const { theta } = fitBradleyTerry(comparisons);
    expect(theta.get("good")!).toBeGreaterThan(theta.get("bad")!);
  });

  it("centres the solution, since the model is shift-invariant", () => {
    const { theta } = fitBradleyTerry([{ winners: ["a"], losers: ["b"] }]);
    const mean = [...theta.values()].reduce((s, v) => s + v, 0) / theta.size;
    expect(Math.abs(mean)).toBeLessThan(1e-9);
  });

  it("averages over a set rather than summing, so bigger outfits don't win on size", () => {
    // A 4-piece set beating a 1-piece set must not be read as "those four items
    // are each four times better".
    const { theta } = fitBradleyTerry([
      { winners: ["w1", "w2", "w3", "w4"], losers: ["l1"] },
    ]);
    const winnerAvg = ["w1", "w2", "w3", "w4"].reduce((s, k) => s + theta.get(k)!, 0) / 4;
    expect(winnerAvg).toBeGreaterThan(theta.get("l1")!);
    expect(Math.abs(winnerAvg)).toBeLessThan(1);
  });

  it("keeps utilities finite on one-sided evidence", () => {
    // Unregularized, an item that only ever wins runs off to infinity.
    const comparisons: Comparison[] = Array.from({ length: 200 }, () => ({
      winners: ["always"],
      losers: ["never"],
    }));
    const { theta } = fitBradleyTerry(comparisons);
    for (const value of theta.values()) {
      expect(Number.isFinite(value)).toBe(true);
      expect(Math.abs(value)).toBeLessThan(20);
    }
  });

  it("moves less under heavier regularization", () => {
    const comparisons: Comparison[] = Array.from({ length: 5 }, () => ({
      winners: ["a"],
      losers: ["b"],
    }));
    const loose = fitBradleyTerry(comparisons, { regularization: 0.05 });
    const tight = fitBradleyTerry(comparisons, { regularization: 5 });
    expect(Math.abs(tight.theta.get("a")!)).toBeLessThan(Math.abs(loose.theta.get("a")!));
    expect(DEFAULT_REGULARIZATION).toBeGreaterThan(0);
  });

  it("respects per-comparison weights", () => {
    const strong = fitBradleyTerry([{ winners: ["a"], losers: ["b"], weight: 1 }]);
    const weak = fitBradleyTerry([{ winners: ["a"], losers: ["b"], weight: 0.1 }]);
    expect(strong.theta.get("a")!).toBeGreaterThan(weak.theta.get("a")!);
  });

  it("counts evidence per item, which drives the ramp", () => {
    const { evidence } = fitBradleyTerry([
      { winners: ["a"], losers: ["b"] },
      { winners: ["a"], losers: ["c"] },
    ]);
    expect(evidence.get("a")).toBe(2);
    expect(evidence.get("b")).toBe(1);
  });

  it("ignores degenerate comparisons and empty input", () => {
    expect(fitBradleyTerry([]).theta.size).toBe(0);
    expect(fitBradleyTerry([{ winners: [], losers: ["x"] }]).theta.size).toBe(0);
  });
});

describe("utilityToScore", () => {
  it("maps zero utility to neutral", () => {
    expect(utilityToScore(0)).toBeCloseTo(0.5, 10);
  });

  it("nudges rather than overturns", () => {
    // Personalization is a residual on a prior that already works; ±1 utility
    // should not swing the score to the extremes.
    expect(utilityToScore(1)).toBeLessThan(0.7);
    expect(utilityToScore(-1)).toBeGreaterThan(0.3);
  });

  it("stays inside [0, 1] at extremes", () => {
    expect(utilityToScore(1e6)).toBeLessThanOrEqual(1);
    expect(utilityToScore(-1e6)).toBeGreaterThanOrEqual(0);
  });
});

describe("lambdaFor", () => {
  it("gives learned data no weight with no evidence", () => {
    expect(lambdaFor(0)).toBe(0);
  });

  it("reaches half weight at the half-life", () => {
    expect(lambdaFor(LAMBDA_HALF_LIFE)).toBeCloseTo(0.5, 10);
  });

  it("ramps slowly, so one tap doesn't take over", () => {
    expect(lambdaFor(1)).toBeLessThan(0.2);
  });

  it("approaches but never reaches full trust", () => {
    expect(lambdaFor(1000)).toBeLessThan(1);
    expect(lambdaFor(1000)).toBeGreaterThan(0.99);
  });
});

describe("buildAffinityMap", () => {
  it("uses a supplied prior alone before any choices", () => {
    const prior = new Map([["a", 0.9]]);
    expect(buildAffinityMap({ stylePrior: prior }).get("a")).toBeCloseTo(0.9, 10);
  });

  it("hands over to learned utility as evidence accumulates", () => {
    const prior = new Map([["a", 0.9]]);
    const thin = buildAffinityMap({
      stylePrior: prior,
      fit: { theta: new Map([["a", -2]]), evidence: new Map([["a", 1]]) },
    });
    const thick = buildAffinityMap({
      stylePrior: prior,
      fit: { theta: new Map([["a", -2]]), evidence: new Map([["a", 40]]) },
    });
    // Choices contradict the prompt; with more of them, they should win.
    expect(thin.get("a")!).toBeGreaterThan(thick.get("a")!);
    expect(thick.get("a")!).toBeLessThan(0.5);
  });

  it("blends learned data against neutral when there is no prior", () => {
    const out = buildAffinityMap({
      fit: { theta: new Map([["a", 2]]), evidence: new Map([["a", 6]]) },
    });
    expect(out.get("a")!).toBeGreaterThan(NEUTRAL_AFFINITY);
    // Half weight at the half-life, so it can't be a full-strength opinion.
    expect(out.get("a")!).toBeLessThan(utilityToScore(2));
  });

  it("returns no entry for items nothing is known about", () => {
    expect(buildAffinityMap({}).size).toBe(0);
    expect(buildAffinityMap({ stylePrior: new Map() }).has("unknown")).toBe(false);
  });
});

describe("outfitAffinity", () => {
  it("averages over the items that have an opinion", () => {
    const affinity = new Map([
      ["a", 0.8],
      ["b", 0.4],
    ]);
    expect(outfitAffinity(["a", "b"], affinity)).toBeCloseTo(0.6, 10);
  });

  it("skips unknown items instead of scoring them neutral", () => {
    const affinity = new Map([["a", 0.8]]);
    expect(outfitAffinity(["a", "unknown"], affinity)).toBeCloseTo(0.8, 10);
  });

  it("returns null when nothing in the set is known", () => {
    expect(outfitAffinity(["x"], new Map())).toBeNull();
    expect(outfitAffinity([], new Map([["a", 1]]))).toBeNull();
  });
});
