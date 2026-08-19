import { describe, expect, it } from "vitest";
import {
  DEFAULT_REGULARIZATION,
  fitBradleyTerry,
  NEUTRAL_ANCHOR,
  utilityToScore,
  type Comparison,
} from "@/lib/outfit/bradley-terry";
import {
  buildAffinityMap,
  evidenceFor,
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
      fit: { theta: new Map([["a", -2]]), evidence: new Map([["a", 1]]), weights: [], featureCredit: 0 },
    });
    const thick = buildAffinityMap({
      stylePrior: prior,
      fit: { theta: new Map([["a", -2]]), evidence: new Map([["a", 40]]), weights: [], featureCredit: 0 },
    });
    // Choices contradict the prompt; with more of them, they should win.
    expect(thin.get("a")!).toBeGreaterThan(thick.get("a")!);
    expect(thick.get("a")!).toBeLessThan(0.5);
  });

  it("blends learned data against neutral when there is no prior", () => {
    const out = buildAffinityMap({
      fit: { theta: new Map([["a", 2]]), evidence: new Map([["a", 6]]), weights: [], featureCredit: 0 },
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

describe("contextual fitBradleyTerry", () => {
  // A closet where taste is perfectly explained by one feature: dark items win.
  const DARK = new Float64Array([-0.5, 0, 0, 0, 0, 0, 0, 0, 0]);
  const LIGHT = new Float64Array([0.5, 0, 0, 0, 0, 0, 0, 0, 0]);
  const features = new Map<string, Float64Array>([
    ["dark1", DARK],
    ["dark2", DARK],
    ["light1", LIGHT],
    ["light2", LIGHT],
    // Never appears in a comparison — the cold-start case.
    ["unseen-dark", DARK],
  ]);

  const darkWins: Comparison[] = [
    { winners: ["dark1"], losers: ["light1"] },
    { winners: ["dark2"], losers: ["light2"] },
    { winners: ["dark1"], losers: ["light2"] },
  ];

  it("reproduces the identity model when no features are supplied", () => {
    const fit = fitBradleyTerry(darkWins);
    expect(fit.weights).toEqual([]);
    expect(fit.featureCredit).toBe(0);
    // Only compared items get a parameter at all.
    expect([...fit.theta.keys()].sort()).toEqual(["dark1", "dark2", "light1", "light2"]);
  });

  it("learns the feature that explains the choices", () => {
    const fit = fitBradleyTerry(darkWins, { features });
    expect(fit.weights).toHaveLength(9);
    // Dark items carry a negative lightness feature and keep winning, so the
    // coefficient must be negative for their utility to come out high.
    expect(fit.weights[0]).toBeLessThan(0);
    expect(fit.theta.get("dark1")!).toBeGreaterThan(fit.theta.get("light1")!);
  });

  /**
   * The entire point of the change: an item nobody has compared still gets a
   * strength, because the shared coefficients apply to anything with features.
   * The identity model cannot do this at all — 107 of 183 real items had no
   * obtainable opinion before.
   */
  it("scores an item that was never compared", () => {
    const fit = fitBradleyTerry(darkWins, { features });
    expect(fit.theta.has("unseen-dark")).toBe(true);
    // It looks like the items that won, so it should score like them.
    expect(fit.theta.get("unseen-dark")!).toBeGreaterThan(fit.theta.get("light1")!);
    // ...but on its own it has no direct evidence.
    expect(fit.evidence.get("unseen-dark") ?? 0).toBe(0);
  });

  it("credits the shared model as comparisons over dimensions", () => {
    const fit = fitBradleyTerry(darkWins, { features });
    expect(fit.featureCredit).toBeCloseTo(3 / 9, 10);
  });

  /**
   * The anchor rule turns on how many garments are on the other side, and this
   * pins both halves of it.
   *
   * One garment against the anchor is a real feature contrast: features are
   * centred on the closet mean, so the difference reads as "how this piece differs
   * from an average garment", and a single piece is a fair draw from the closet.
   * That is what makes the garment-swipe mode (`train_item`) the cleanest feature
   * evidence in the log.
   */
  it("fits coefficients from a single garment judged against the anchor", () => {
    const swipes: Comparison[] = [
      { winners: ["dark1"], losers: [NEUTRAL_ANCHOR] },
      { winners: ["dark2"], losers: [NEUTRAL_ANCHOR] },
      { winners: [NEUTRAL_ANCHOR], losers: ["light1"] },
    ];
    const fit = fitBradleyTerry(swipes, { features, anchorId: NEUTRAL_ANCHOR });
    // Dark pieces liked, a light one passed → the lightness coefficient moves.
    expect(fit.weights[0]).toBeLessThan(0);
    expect(fit.featureCredit).toBeCloseTo(3 / 9, 10);
    // ...and it generalizes to a garment never judged.
    expect(fit.theta.get("unseen-dark")!).toBeGreaterThan(fit.theta.get("light1")!);
  });

  /**
   * An *outfit* against the anchor is the trap. A top-plus-bottom-plus-shoes look
   * is not a fair draw from a closet that is 40% hats, so its feature mean is
   * offset from zero for reasons unrelated to taste — and every rating pushed `w`
   * the same way. See `isFeatureContrast` in lib/outfit/bradley-terry.ts.
   */
  it("ignores a multi-piece outfit judged against the anchor", () => {
    const outfitRatings: Comparison[] = [
      { winners: ["dark1", "dark2"], losers: [NEUTRAL_ANCHOR] },
      { winners: [NEUTRAL_ANCHOR], losers: ["light1", "light2"] },
    ];
    const fit = fitBradleyTerry(outfitRatings, { features, anchorId: NEUTRAL_ANCHOR });
    for (const weight of fit.weights) expect(weight).toBe(0);
    expect(fit.featureCredit).toBe(0);
    // The level still lands somewhere: the intercepts absorb it.
    expect(fit.theta.get("dark1")!).toBeGreaterThan(0);
  });

  it("counts only the feature-contrastive rows in a mixed log", () => {
    const mixed: Comparison[] = [
      ...darkWins,
      // Fits `w` — one garment.
      { winners: ["dark1"], losers: [NEUTRAL_ANCHOR] },
      // Does not — a two-piece outfit against the anchor.
      { winners: ["light1", "light2"], losers: [NEUTRAL_ANCHOR] },
    ];
    const fit = fitBradleyTerry(mixed, { features, anchorId: NEUTRAL_ANCHOR });
    expect(fit.weights[0]).toBeLessThan(0);
    // Four of the five rows are genuine contrasts.
    expect(fit.featureCredit).toBeCloseTo(4 / 9, 10);
  });

  it("gives an uncompared item a real opinion rather than a flat neutral", () => {
    const fit = fitBradleyTerry(darkWins, { features });
    const affinity = buildAffinityMap({ fit });
    const unseen = affinity.get("unseen-dark");
    expect(unseen).toBeDefined();
    // Without the feature credit in the λ ramp this would be exactly 0.5, which
    // dilutes the blend instead of informing it.
    expect(unseen!).not.toBeCloseTo(NEUTRAL_AFFINITY, 6);
    expect(unseen!).toBeGreaterThan(NEUTRAL_AFFINITY);
  });

  it("keeps evidenceFor at own-evidence when there are no features", () => {
    const fit = fitBradleyTerry(darkWins);
    expect(evidenceFor(fit, "dark1")).toBe(fit.evidence.get("dark1"));
    expect(evidenceFor(fit, "nobody")).toBe(0);
  });

  it("adds the shared credit on top of own evidence", () => {
    const fit = fitBradleyTerry(darkWins, { features });
    expect(evidenceFor(fit, "dark1")).toBeCloseTo(
      (fit.evidence.get("dark1") ?? 0) + fit.featureCredit,
      10,
    );
  });
});
