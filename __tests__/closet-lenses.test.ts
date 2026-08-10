import { describe, expect, it } from "vitest";
import {
  assessDormancy,
  dormancyReadiness,
  LOAD_BEARING_THRESHOLD,
  MIN_AGE_DAYS,
  MIN_WEAR_EVENTS,
  rankDormant,
  type DormancyInput,
} from "@/lib/outfit/dormancy";
import { computeMarginalValue } from "@/lib/outfit/marginal-value";
import { findRedundancyClusters, REDUNDANCY_THRESHOLD } from "@/lib/outfit/redundancy";
import { normalizeEmbedding } from "@/lib/wear/embedding";
import { fitBradleyTerry, NEUTRAL_ANCHOR, utilityToScore } from "@/lib/outfit/bradley-terry";

const NOW = new Date("2026-08-09T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const base: DormancyInput = {
  itemId: "x",
  effectiveWears: 10,
  lastWornAt: daysAgo(400),
  addedAt: daysAgo(900),
  seasons: [],
  ownerCount: 1,
  protectedAt: null,
  marginalValue: 0,
  band: "warm",
  now: NOW,
};

describe("dormancyReadiness", () => {
  it("stays silent on a closet with almost no history", () => {
    // Every garment is technically dormant on day one — a statement true of
    // everything is useless and reads as an accusation.
    const r = dormancyReadiness({ wearEvents: 3, earliestWearAt: daysAgo(400), now: NOW });
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("too-few-wears");
  });

  it("stays silent when many wears were logged over a short window", () => {
    // A burst is not a rhythm.
    const r = dormancyReadiness({ wearEvents: 200, earliestWearAt: daysAgo(10), now: NOW });
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("too-short-a-history");
  });

  it("speaks once there is both volume and span", () => {
    const r = dormancyReadiness({
      wearEvents: MIN_WEAR_EVENTS,
      earliestWearAt: daysAgo(200),
      now: NOW,
    });
    expect(r.ready).toBe(true);
  });

  it("handles a closet with no wears at all", () => {
    expect(dormancyReadiness({ wearEvents: 0, earliestWearAt: null, now: NOW }).ready).toBe(false);
  });
});

describe("assessDormancy suppression", () => {
  it("flags a long-unworn everyday item", () => {
    const result = assessDormancy(base);
    expect(result.suppressedBy).toBeNull();
    expect(result.score).toBeGreaterThan(0);
    expect(result.daysSinceWorn).toBe(400);
  });

  it("never surfaces a protected item", () => {
    expect(assessDormancy({ ...base, protectedAt: NOW }).suppressedBy).toBe("protected");
  });

  it("never surfaces something bought recently", () => {
    expect(assessDormancy({ ...base, addedAt: daysAgo(MIN_AGE_DAYS - 1) }).suppressedBy).toBe(
      "too-new",
    );
  });

  it("insulates a garment more than one person wears", () => {
    expect(assessDormancy({ ...base, ownerCount: 2 }).suppressedBy).toBe("shared");
  });

  it("insulates a load-bearing piece", () => {
    // The black blazer worn six times a year that twelve outfits depend on.
    // Cost-per-wear says sell it; marginal value says it holds the closet up.
    const result = assessDormancy({ ...base, marginalValue: LOAD_BEARING_THRESHOLD });
    expect(result.suppressedBy).toBe("load-bearing");
  });

  it("insulates a garment that is simply out of season", () => {
    // A wool coat in August is waiting, not neglected — this is the
    // false-positive class that costs the most trust.
    const result = assessDormancy({ ...base, seasons: ["winter"], band: "hot" });
    expect(result.suppressedBy).toBe("out-of-season");
  });

  it("still flags an in-season garment that is genuinely idle", () => {
    const result = assessDormancy({ ...base, seasons: ["summer"], band: "hot" });
    expect(result.suppressedBy).toBeNull();
  });

  it("measures against the item's own rhythm, not a fixed cutoff", () => {
    // Same 200-day gap. For something worn constantly that is a long silence;
    // for something worn twice a year it is normal.
    const frequent = assessDormancy({
      ...base,
      effectiveWears: 100,
      addedAt: daysAgo(700),
      lastWornAt: daysAgo(200),
    });
    const occasional = assessDormancy({
      ...base,
      effectiveWears: 2,
      addedAt: daysAgo(700),
      lastWornAt: daysAgo(200),
    });
    expect(frequent.score).toBeGreaterThan(occasional.score);
    expect(occasional.suppressedBy).toBe("not-dormant");
  });

  it("treats a never-worn old item as dormant", () => {
    const result = assessDormancy({ ...base, lastWornAt: null, effectiveWears: 0 });
    expect(result.suppressedBy).toBeNull();
    expect(result.daysSinceWorn).toBeNull();
  });

  it("ranks only what it is willing to surface", () => {
    const results = [
      assessDormancy(base),
      assessDormancy({ ...base, itemId: "p", protectedAt: NOW }),
    ];
    const ranked = rankDormant(results);
    expect(ranked.map((r) => r.itemId)).toEqual(["x"]);
  });
});

describe("computeMarginalValue", () => {
  const color = (hex: string, name: string) => [{ hex, name }];

  it("gives a sole option in its slot a high value", () => {
    // One pair of shoes: losing them costs every outfit, whatever they look like.
    const value = computeMarginalValue({
      items: [
        { id: "t1", category: "top", name: "Tee", colors: color("#000000", "black") },
        { id: "t2", category: "top", name: "Shirt", colors: color("#ffffff", "white") },
        { id: "b1", category: "bottom", name: "Jeans", colors: color("#26364f", "indigo") },
        { id: "b2", category: "bottom", name: "Chinos", colors: color("#c8b48c", "tan") },
        { id: "s1", category: "shoes", name: "Only shoes", colors: color("#111111", "black") },
      ],
    });
    expect(value.get("s1")!).toBeGreaterThan(value.get("t1")!);
    expect(value.get("s1")!).toBeGreaterThan(LOAD_BEARING_THRESHOLD);
  });

  it("values a neutral bridge above a loud one-off in the same slot", () => {
    const value = computeMarginalValue({
      items: [
        { id: "neutral", category: "top", name: "Black knit", colors: color("#000000", "black") },
        { id: "loud", category: "top", name: "Neon tee", colors: color("#9cd91e", "chartreuse") },
        { id: "b1", category: "bottom", name: "Grey trousers", colors: color("#888888", "grey") },
        { id: "b2", category: "bottom", name: "Navy chinos", colors: color("#1a2a4a", "navy") },
        { id: "s1", category: "shoes", name: "Loafer", colors: color("#1a1a1a", "black") },
        { id: "s2", category: "shoes", name: "Sneaker", colors: color("#f0f0f0", "white") },
      ],
    });
    expect(value.get("neutral")!).toBeGreaterThan(value.get("loud")!);
  });

  it("returns nothing for an empty closet", () => {
    expect(computeMarginalValue({ items: [] }).size).toBe(0);
  });
});

describe("findRedundancyClusters", () => {
  const near = (seed: number) => {
    // Vectors a hair apart — the measured near-duplicate regime (0.95+).
    const v = new Float32Array([1, seed * 0.02, 0, 0]);
    return normalizeEmbedding(v);
  };
  const far = (axis: number) => {
    const v = new Float32Array(4);
    v[axis] = 1;
    return normalizeEmbedding(v);
  };

  it("groups three or more near-duplicates in one category", () => {
    const clusters = findRedundancyClusters([
      { id: "a", category: "shirt", vector: near(0) },
      { id: "b", category: "shirt", vector: near(1) },
      { id: "c", category: "shirt", vector: near(2) },
      { id: "d", category: "shirt", vector: far(1) },
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].itemIds.sort()).toEqual(["a", "b", "c"]);
  });

  it("stays quiet about a mere pair", () => {
    const clusters = findRedundancyClusters([
      { id: "a", category: "shirt", vector: near(0) },
      { id: "b", category: "shirt", vector: near(1) },
    ]);
    expect(clusters).toEqual([]);
  });

  it("never crosses categories", () => {
    // A white tee and white trainers being close is colour, not redundancy.
    const clusters = findRedundancyClusters([
      { id: "a", category: "shirt", vector: near(0) },
      { id: "b", category: "shoes", vector: near(1) },
      { id: "c", category: "pants", vector: near(2) },
    ]);
    expect(clusters).toEqual([]);
  });

  it("uses a threshold in the measured near-duplicate range", () => {
    // Calibration found distinct items at p99 = 0.841 and true duplicates at
    // 0.95+; the threshold has to sit above the former.
    expect(REDUNDANCY_THRESHOLD).toBeGreaterThan(0.85);
  });
});

describe("Bradley-Terry with a neutral anchor", () => {
  it("places a liked outfit above neutral and a passed one below", () => {
    const { theta } = fitBradleyTerry(
      [
        { winners: ["liked"], losers: [NEUTRAL_ANCHOR] },
        { winners: [NEUTRAL_ANCHOR], losers: ["passed"] },
      ],
      { anchorId: NEUTRAL_ANCHOR },
    );
    expect(theta.get(NEUTRAL_ANCHOR)).toBeCloseTo(0, 10);
    expect(theta.get("liked")!).toBeGreaterThan(0);
    expect(theta.get("passed")!).toBeLessThan(0);
  });

  it("keeps 'liked' meaning above-neutral even in a mostly-positive session", () => {
    // Centring on the mean would drift the scale until the least-liked of five
    // liked outfits scored below neutral, which is not what the user said.
    const comparisons = ["a", "b", "c", "d", "e"].map((id) => ({
      winners: [id],
      losers: [NEUTRAL_ANCHOR],
    }));
    const { theta } = fitBradleyTerry(comparisons, { anchorId: NEUTRAL_ANCHOR });
    for (const id of ["a", "b", "c", "d", "e"]) {
      expect(utilityToScore(theta.get(id)!)).toBeGreaterThan(0.5);
    }
  });

  it("still mean-centres when no anchor is given", () => {
    const { theta } = fitBradleyTerry([{ winners: ["a"], losers: ["b"] }]);
    const mean = [...theta.values()].reduce((s, v) => s + v, 0) / theta.size;
    expect(Math.abs(mean)).toBeLessThan(1e-9);
  });
});
