import { describe, expect, it } from "vitest";
import {
  accuracyFor,
  affinityFromCases,
  clusteredStderr,
  comparisonsFor,
  FULL_WEIGHTS,
  looAffinityMaps,
  makeScorer,
  MAX_RIVALS,
  MIN_AUC_CLASS,
  MIN_SNIPS_SAMPLE,
  protectRate,
  randomControl,
  rateAuc,
  reblend,
  reconstructRivals,
  rivalsFor,
  snips,
  type EvalCase,
  type TermWeights,
} from "@/lib/eval/ranker";
import { scoreOutfit, type ScorableItem, type ScoringContext } from "@/lib/outfit/compatibility";
import { mulberry32 } from "@/lib/outfit/sampling";

const color = (hex: string, name: string) => [{ hex, name }];

const CLOSET: ScorableItem[] = [
  { id: "t1", category: "top", name: "Merino knit", colors: color("#000000", "black") },
  { id: "t2", category: "top", name: "Oxford shirt", colors: color("#ffffff", "white") },
  { id: "t3", category: "top", name: "Floral blouse", pattern: "floral", colors: color("#e01e8c", "pink") },
  { id: "b1", category: "bottom", name: "Wool trousers", colors: color("#888888", "grey") },
  { id: "b2", category: "bottom", name: "Board shorts", pattern: "plaid", colors: color("#e01e8c", "pink") },
  { id: "s1", category: "shoes", name: "Leather loafer", colors: color("#1a1a1a", "black") },
  { id: "s2", category: "shoes", name: "Canvas sneaker", colors: color("#f0f0f0", "white") },
  { id: "h1", category: "accessory", name: "Wool beanie", colors: color("#2a2a2a", "charcoal") },
  // No colours and an unguessable category — every term should decline to score it.
  { id: "x1", category: "other", name: "Thing" },
];

const byId = new Map(CLOSET.map((item) => [item.id, item]));
const pick = (...ids: string[]) => ids.map((id) => byId.get(id)!);

function evalCase(overrides: Partial<EvalCase> = {}): EvalCase {
  return {
    id: "e1",
    kind: "train_pick",
    policyId: "slate-thompson-v2",
    band: null,
    chosen: ["t1", "b1", "s1"],
    rejectedPool: ["t2", "b2", "s2"],
    propensity: null,
    ...overrides,
  };
}

describe("reblend", () => {
  /**
   * The anti-drift pin. `reblend` duplicates compatibility.ts's blend so
   * ablations can re-weight a breakdown without re-scoring; if that blend
   * changes and this doesn't mirror it, every ablation silently becomes wrong.
   * Exact equality, not approximate — the arithmetic is meant to be identical.
   */
  it("reproduces scoreOutfit exactly under the shipped weights", () => {
    const contexts: ScoringContext[] = [
      {},
      { band: "cold" },
      { affinity: new Map([["t1", 0.9]]) },
      { band: "hot", affinity: new Map([["t1", 0.2], ["b1", 0.8]]) },
    ];
    const outfits = [
      pick("t1", "b1", "s1"),
      pick("t3", "b2", "s2"), // two bold patterns → penalty multiplier fires
      pick("x1"),
      pick("x1", "t1"),
      pick("t1", "b1", "s1", "h1"),
    ];

    for (const context of contexts) {
      for (const outfit of outfits) {
        const breakdown = scoreOutfit(outfit, context);
        expect(reblend(breakdown, FULL_WEIGHTS)).toBe(breakdown.score);
      }
    }
  });

  it("isolates a single term when the others are zeroed", () => {
    const breakdown = scoreOutfit(pick("t1", "b1", "s1"), { band: "cold" });
    const colorOnly: TermWeights = { color: 0.5, formality: 0, climate: 0, bilinear: 0, affinity: 0 };
    expect(reblend(breakdown, colorOnly)).toBeCloseTo(breakdown.color! * breakdown.patternPenalty, 12);
  });

  it("carries the pattern penalty through as a multiplier", () => {
    const clashing = scoreOutfit(pick("t3", "b2", "s2"));
    expect(clashing.patternPenalty).toBeLessThan(1);
    const colorOnly: TermWeights = { color: 0.5, formality: 0, climate: 0, bilinear: 0, affinity: 0 };
    expect(reblend(clashing, colorOnly)).toBeCloseTo(clashing.color! * clashing.patternPenalty, 12);
  });

  it("falls back to the neutral score when no term has an opinion", () => {
    const breakdown = scoreOutfit(pick("t1", "b1"));
    const nothing: TermWeights = { color: 0, formality: 0, climate: 0, bilinear: 0, affinity: 0 };
    expect(reblend(breakdown, nothing)).toBeCloseTo(0.6, 12);
  });
});

describe("reconstructRivals", () => {
  it("enumerates same-shape outfits from the rejected pool", () => {
    const { rivals, capped } = reconstructRivals(
      ["t1", "b1", "s1"],
      ["t2", "t3", "b2", "s2"],
      byId,
    );
    expect(capped).toBe(false);
    // 2 tops × 1 bottom × 1 pair of shoes
    expect(rivals).toHaveLength(2);
    for (const rival of rivals) {
      expect(rival).toHaveLength(3);
      expect(rival).toContain("b2");
      expect(rival).toContain("s2");
    }
  });

  it("returns nothing when the pool cannot fill every slot", () => {
    // No shoes in the pool, so no three-piece rival exists.
    expect(reconstructRivals(["t1", "b1", "s1"], ["t2", "b2"], byId).rivals).toEqual([]);
  });

  it("excludes items that are already in the chosen outfit", () => {
    const { rivals } = reconstructRivals(["t1", "b1", "s1"], ["t1", "t2", "b2", "s2"], byId);
    for (const rival of rivals) expect(rival).not.toContain("t1");
  });

  it("never seats one item in two slots of the same kind", () => {
    // Two tops in the shape, one top in the pool → no rival can be built.
    const { rivals } = reconstructRivals(["t1", "t2"], ["t3"], byId);
    expect(rivals).toEqual([]);
  });

  it("reports truncation instead of silently evaluating a partial rival set", () => {
    // A wide pool of distinct tops against a two-top shape blows past the cap.
    const wide: ScorableItem[] = Array.from({ length: 40 }, (_, i) => ({
      id: `w${i}`,
      category: "top",
      name: `Shirt ${i}`,
      colors: color("#123456", "blue"),
    }));
    const wideById = new Map([...byId, ...wide.map((item) => [item.id, item] as const)]);
    const { rivals, capped } = reconstructRivals(
      ["t1", "t2"],
      wide.map((item) => item.id),
      wideById,
    );
    expect(capped).toBe(true);
    expect(rivals.length).toBeLessThanOrEqual(MAX_RIVALS);
  });

  it("skips ids that are not in the closet", () => {
    const { rivals } = reconstructRivals(["t1", "b1", "s1"], ["gone", "t2", "b2", "s2"], byId);
    expect(rivals).toHaveLength(1);
  });
});

describe("accuracyFor", () => {
  const cases = [evalCase()];

  it("scores 100% when the scorer prefers what the user picked", () => {
    const result = accuracyFor(cases, byId, (ids) => (ids.includes("t1") ? 1 : 0));
    expect(result.pairwise).toBe(1);
    expect(result.top1).toBe(1);
    expect(result.cases).toBe(1);
  });

  it("scores 0% when the scorer prefers what the user rejected", () => {
    const result = accuracyFor(cases, byId, (ids) => (ids.includes("t1") ? 0 : 1));
    expect(result.pairwise).toBe(0);
    expect(result.top1).toBe(0);
  });

  it("counts a tie as half a pair and never as a top-1 win", () => {
    const result = accuracyFor(cases, byId, () => 0.5);
    expect(result.pairwise).toBe(0.5);
    expect(result.top1).toBe(0);
  });

  it("skips cases with no reconstructable rival rather than scoring them", () => {
    const result = accuracyFor([evalCase({ rejectedPool: ["t2"] })], byId, () => 1);
    expect(result.cases).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.pairs).toBe(0);
  });
});

describe("clusteredStderr", () => {
  it("is zero when there is nothing to vary", () => {
    expect(clusteredStderr([])).toBe(0);
    expect(clusteredStderr([0.7])).toBe(0);
    expect(clusteredStderr([0.5, 0.5, 0.5])).toBe(0);
  });

  it("is the standard error of the mean over per-case proportions", () => {
    // sample sd of [0, 1] is 0.7071; se = sd/sqrt(2) = 0.5
    expect(clusteredStderr([0, 1])).toBeCloseTo(0.5, 6);
  });

  it("shrinks as cases are added", () => {
    const few = clusteredStderr([0, 1, 0, 1]);
    const many = clusteredStderr([0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1]);
    expect(many).toBeLessThan(few);
  });
});

describe("randomControl", () => {
  /**
   * The baseline has to land on chance or the case construction is leaking.
   * A single replicate swings several points on this many cases, which is why
   * the control averages — this test is also the regression guard for that.
   */
  it("estimates the chance level at 50%", () => {
    const cases = Array.from({ length: 20 }, (_, i) => evalCase({ id: `e${i}` }));
    const control = randomControl(cases, byId, (replicate) => mulberry32(1000 + replicate), 300);
    expect(control.replicates).toBe(300);
    expect(control.mean).toBeGreaterThan(0.45);
    expect(control.mean).toBeLessThan(0.55);
    expect(control.stdev).toBeGreaterThan(0);
  });
});

describe("rateAuc", () => {
  // Both classes at the reporting minimum. `liked` outfits all contain t1,
  // `passed` ones all contain t3, so a scorer can separate them perfectly.
  const rated = [
    ...Array.from({ length: MIN_AUC_CLASS }, (_, i) => ({
      itemIds: ["t1", "b1", `s${i}`],
      liked: true,
    })),
    ...Array.from({ length: MIN_AUC_CLASS }, (_, i) => ({
      itemIds: ["t3", "b2", `s${i}`],
      liked: false,
    })),
  ];

  it("is 1 when every liked outfit outscores every passed one", () => {
    const result = rateAuc(rated, (ids) => (ids.includes("t3") ? 0 : 1));
    expect(result.auc).toBe(1);
    expect(result.liked).toBe(MIN_AUC_CLASS);
    expect(result.passed).toBe(MIN_AUC_CLASS);
    expect(result.reason).toBeNull();
  });

  it("is 0 when the ordering is inverted", () => {
    expect(rateAuc(rated, (ids) => (ids.includes("t3") ? 1 : 0)).auc).toBe(0);
  });

  it("is 0.5 on constant scores", () => {
    expect(rateAuc(rated, () => 0.5).auc).toBe(0.5);
  });

  /**
   * One like against one pass yields exactly 1.000 — a coin flip that reads as a
   * result. The guard exists because that is the number most likely to be quoted
   * later without its sample size attached.
   */
  it("refuses a number below the class minimum, and says why", () => {
    const thin = rateAuc(
      [
        { itemIds: ["t1"], liked: true },
        { itemIds: ["t3"], liked: false },
      ],
      (ids) => (ids.includes("t3") ? 0 : 1),
    );
    expect(thin.auc).toBeNull();
    expect(thin.reason).toContain("1 liked / 1 passed");
  });

  it("declines to report an AUC when one class is empty", () => {
    const result = rateAuc([{ itemIds: ["t1"], liked: true }], () => 1);
    expect(result.auc).toBeNull();
    expect(result.passed).toBe(0);
  });
});

describe("snips", () => {
  const rows = (n: number, logged = 0.5, reward = 1) =>
    Array.from({ length: n }, () => ({ reward, logged, target: logged }));

  it("refuses to report an estimate below the minimum sample", () => {
    const result = snips(rows(MIN_SNIPS_SAMPLE - 1));
    expect(result.estimate).toBeNull();
    expect(result.reason).toContain(`${MIN_SNIPS_SAMPLE}`);
    expect(result.usable).toBe(MIN_SNIPS_SAMPLE - 1);
  });

  it("reduces to the mean reward when target equals logged", () => {
    const half = [...rows(MIN_SNIPS_SAMPLE / 2, 0.5, 1), ...rows(MIN_SNIPS_SAMPLE / 2, 0.5, 0)];
    const result = snips(half);
    expect(result.estimate).toBeCloseTo(0.5, 12);
    expect(result.effectiveSample).toBeCloseTo(MIN_SNIPS_SAMPLE, 6);
  });

  it("weights a row up when the target policy prefers it more than the logger did", () => {
    const result = snips([
      ...Array.from({ length: MIN_SNIPS_SAMPLE - 1 }, () => ({ reward: 0, logged: 0.5, target: 0.5 })),
      { reward: 1, logged: 0.01, target: 0.5 },
    ]);
    // One row carries a weight of 50 against 29 rows at weight 1.
    expect(result.estimate).toBeCloseTo(50 / 79, 6);
    expect(result.effectiveSample).toBeLessThan(MIN_SNIPS_SAMPLE);
  });

  it("drops rows that cannot carry an importance weight", () => {
    const result = snips([
      { reward: 1, logged: 0, target: 0.5 },
      { reward: 1, logged: Number.NaN, target: 0.5 },
    ]);
    expect(result.dropped).toBe(2);
    expect(result.usable).toBe(0);
    expect(result.reason).toBe("no usable rows");
  });
});

describe("comparisonsFor", () => {
  it("falls back to one pooled comparison on a row with no arms", () => {
    expect(comparisonsFor(evalCase())).toEqual([
      { winners: ["t1", "b1", "s1"], losers: ["t2", "b2", "s2"], weight: 0.55 },
    ]);
  });

  /**
   * The point of per-arm logging: one tap on three outfits is two preferences,
   * and each rival is shape-matched instead of pooled into one lopsided set.
   */
  it("expands logged arms into one comparison per rival", () => {
    const comparisons = comparisonsFor(
      evalCase({
        arms: [
          ["t1", "b1", "s1"],
          ["t2", "b2", "s2"],
          ["t3", "b1", "s2"],
        ],
        chosenArm: 0,
      }),
    );
    expect(comparisons).toHaveLength(2);
    for (const comparison of comparisons) {
      expect(comparison.winners).toEqual(["t1", "b1", "s1"]);
      expect(comparison.weight).toBe(0.55);
      expect(comparison.losers).toHaveLength(3);
    }
    expect(comparisons.map((c) => c.losers)).toEqual([
      ["t2", "b2", "s2"],
      ["t3", "b1", "s2"],
    ]);
  });

  it("expands an eight-arm round into seven comparisons", () => {
    const arms = Array.from({ length: 8 }, (_, i) => [`t${i}`, `b${i}`, `s${i}`]);
    expect(comparisonsFor(evalCase({ arms, chosenArm: 3 }))).toHaveLength(7);
  });

  it("declines negative-polarity and non-affinity signals, matching buildAffinity", () => {
    // A reroll names only what was turned down — there is no winning set.
    expect(comparisonsFor(evalCase({ kind: "reroll" }))).toEqual([]);
    // Protecting an item is bookkeeping, not taste.
    expect(comparisonsFor(evalCase({ kind: "protect" }))).toEqual([]);
    expect(comparisonsFor(evalCase({ kind: "dismiss" }))).toEqual([]);
  });

  it("declines a case with nothing on one side", () => {
    expect(comparisonsFor(evalCase({ rejectedPool: [] }))).toEqual([]);
  });

  it("falls back to the pool when the chosen index is out of range", () => {
    const comparisons = comparisonsFor(
      evalCase({ arms: [["t1"], ["t2"]], chosenArm: 7 }),
    );
    expect(comparisons).toHaveLength(1);
    expect(comparisons[0].losers).toEqual(["t2", "b2", "s2"]);
  });
});

describe("rivalsFor", () => {
  it("reads the logged arms rather than reconstructing them", () => {
    const { rivals, logged, capped } = rivalsFor(
      evalCase({
        arms: [
          ["t1", "b1", "s1"],
          ["t2", "b2", "s2"],
          ["t3", "b1", "s2"],
        ],
        chosenArm: 0,
      }),
      byId,
    );
    expect(logged).toBe(true);
    expect(capped).toBe(false);
    // Exactly the two outfits shown — not the eight the pool could produce.
    expect(rivals).toEqual([
      ["t2", "b2", "s2"],
      ["t3", "b1", "s2"],
    ]);
  });

  it("reconstructs when the row has no arms", () => {
    const { logged } = rivalsFor(evalCase(), byId);
    expect(logged).toBe(false);
  });

  it("drops arm members that are no longer in the closet", () => {
    const { rivals, logged } = rivalsFor(
      evalCase({ arms: [["t1", "b1", "s1"], ["t2", "gone", "s2"]], chosenArm: 0 }),
      byId,
    );
    expect(logged).toBe(true);
    expect(rivals).toEqual([["t2", "s2"]]);
  });
});

describe("looAffinityMaps", () => {
  /**
   * The whole point of leave-one-out: the fold used to score a case must not
   * have seen it. If it has, Layer 2 is graded on its own training data and the
   * number is meaningless.
   */
  it("excludes the held-out case from its own fold", () => {
    const cases = [
      evalCase({ id: "a", chosen: ["t1", "b1", "s1"], rejectedPool: ["t2", "b2", "s2"] }),
      evalCase({ id: "b", chosen: ["t3", "b2", "s2"], rejectedPool: ["h1", "x1"] }),
    ];
    const maps = looAffinityMaps(cases);
    expect(maps).toHaveLength(2);

    // Fold 0 is fit on case "b" only, so nothing unique to case "a" has an
    // opinion — t1 appears only in case "a".
    expect(maps[0].has("t1")).toBe(false);
    // ...and t3, which only case "b" mentions, does.
    expect(maps[0].has("t3")).toBe(true);

    // The mirror image for fold 1.
    expect(maps[1].has("t3")).toBe(false);
    expect(maps[1].has("t1")).toBe(true);
  });

  it("returns empty maps when a fold has no usable comparison", () => {
    const maps = looAffinityMaps([evalCase()]);
    expect(maps[0].size).toBe(0);
  });

  it("keeps the neutral anchor out of the affinity map", () => {
    const affinity = affinityFromCases([
      evalCase({ kind: "train_rate", chosen: ["t1", "b1", "s1"], rejectedPool: ["__neutral__"] }),
    ]);
    expect(affinity.has("__neutral__")).toBe(false);
    expect(affinity.has("t1")).toBe(true);
  });
});

describe("makeScorer", () => {
  it("returns null for an outfit whose items are all missing", () => {
    const scorer = makeScorer(byId, {}, FULL_WEIGHTS);
    expect(scorer(["gone"])).toBeNull();
    expect(scorer(["t1"])).not.toBeNull();
  });
});

describe("protectRate", () => {
  it("is a rate, and undefined on an empty closet", () => {
    expect(protectRate(3, 180)).toBeCloseTo(3 / 180, 12);
    expect(protectRate(0, 0)).toBeNull();
  });
});
