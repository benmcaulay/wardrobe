import { describe, it, expect } from "vitest";
import {
  ACTIVITIES,
  activityNeeds,
  EMPTY_REQUIREMENTS,
  isTripActivity,
  parseTripRequirements,
  wearMultiplier,
} from "../lib/packing/requirements";
import { buildPackingPlan, coverThenFill, type PackableItem, type SelectedItem } from "../lib/packing/plan";

describe("parseTripRequirements", () => {
  it("reads stored requirements", () => {
    const parsed = parseTripRequirements(JSON.stringify({ activities: ["beach"], laundry: true }));
    expect(parsed).toEqual({ activities: ["beach"], laundry: true });
  });

  it("falls back to empty for missing or malformed input", () => {
    expect(parseTripRequirements(null)).toEqual(EMPTY_REQUIREMENTS);
    expect(parseTripRequirements("not json")).toEqual(EMPTY_REQUIREMENTS);
    expect(parseTripRequirements("{}")).toEqual(EMPTY_REQUIREMENTS);
  });

  it("drops unknown activities and de-duplicates", () => {
    const parsed = parseTripRequirements(
      JSON.stringify({ activities: ["beach", "beach", "spelunking"], laundry: "yes" }),
    );
    expect(parsed.activities).toEqual(["beach"]);
    // Only a real boolean counts, so a truthy string doesn't silently enable it.
    expect(parsed.laundry).toBe(false);
  });
});

describe("isTripActivity", () => {
  it("accepts every declared activity", () => {
    for (const a of ACTIVITIES) expect(isTripActivity(a.id)).toBe(true);
  });
  it("rejects anything else", () => {
    expect(isTripActivity("skydiving")).toBe(false);
  });
});

describe("activityNeeds", () => {
  it("is empty when no activity is chosen", () => {
    expect(activityNeeds(EMPTY_REQUIREMENTS)).toEqual([]);
  });

  it("collects the needs of each activity", () => {
    const needs = activityNeeds({ activities: ["beach"], laundry: false });
    expect(needs.map((n) => n.label)).toContain("swimwear");
    expect(needs.map((n) => n.label)).toContain("sandals");
  });

  it("de-duplicates a need two activities share", () => {
    // Business and formal both want smart shoes — reserve one pair, not two.
    const needs = activityNeeds({ activities: ["business", "formal"], laundry: false });
    const smartShoes = needs.filter((n) => n.label === "smart shoes");
    expect(smartShoes).toHaveLength(1);
  });
});

describe("wearMultiplier", () => {
  it("is 1 without laundry and 2 with it", () => {
    expect(wearMultiplier({ activities: [], laundry: false })).toBe(1);
    expect(wearMultiplier({ activities: [], laundry: true })).toBe(2);
  });
});

describe("requirements change what gets packed", () => {
  const sel = (id: string, bucket: SelectedItem["bucket"], name: string, vol = 1): SelectedItem => ({
    id, bucket, name, volumeLiters: vol, weightGrams: 200, seasonOk: true,
  });
  const targets = { top: 8, bottom: 4, dress: 0, outerwear: 1, shoes: 2, accessory: 0, other: 0 };

  it("reserves an activity's item even when it would lose on score", () => {
    // Sandals sit last in preference order, so without the beach requirement
    // the trainers take the only shoe slot.
    const selected = [
      sel("tee1", "top", "tee"), sel("tee2", "top", "tee"),
      sel("jeans", "bottom", "jeans"), sel("trunks", "bottom", "swim trunks"),
      sel("trainers", "shoes", "trainers"), sel("sandals", "shoes", "sandals"),
    ];
    const bags = [{ id: "bag", volumeLiters: 4 }];

    const plain = coverThenFill(selected, bags, { days: 4, targets });
    const beach = coverThenFill(selected, bags, {
      days: 4, targets, needs: activityNeeds({ activities: ["beach"], laundry: false }),
    });

    const packedIn = (r: { assignments: Record<string, string[]> }) => r.assignments.bag;
    expect(packedIn(beach)).toContain("sandals");
    expect(packedIn(beach)).toContain("trunks");
    expect(packedIn(plain)).not.toEqual(packedIn(beach));
  });

  it("reports a need the closet can't satisfy", () => {
    const selected = [sel("tee1", "top", "tee"), sel("jeans", "bottom", "jeans")];
    const res = coverThenFill(selected, [{ id: "bag", volumeLiters: 20 }], {
      days: 3, targets, needs: activityNeeds({ activities: ["beach"], laundry: false }),
    });
    expect(res.unmetNeeds.map((n) => n.label)).toContain("swimwear");
  });

  it("laundry means fewer pieces cover the same trip", () => {
    const items: PackableItem[] = [
      ...[1, 2, 3, 4, 5, 6].map((n) => ({ id: `t${n}`, category: "shirt", name: `tee ${n}` })),
      ...[1, 2, 3].map((n) => ({ id: `b${n}`, category: "pants", name: `chinos ${n}` })),
      { id: "s1", category: "shoes", name: "sneakers" },
      { id: "j1", category: "jacket", name: "light jacket" },
    ];
    const bags = [{ id: "bag", volumeLiters: 60 }];
    const base = { items, bags, days: 8, band: "mild" as const, rainChance: 0 };

    const without = buildPackingPlan(base);
    const withLaundry = buildPackingPlan({
      ...base,
      requirements: { activities: [], laundry: true },
    });

    expect(withLaundry.coverage.coveredDays).toBeGreaterThanOrEqual(without.coverage.coveredDays);
    expect(withLaundry.totals.count).toBeLessThanOrEqual(without.totals.count);
  });

  it("two different trips to the same place no longer pack identically", () => {
    // The whole point of the layer.
    const items: PackableItem[] = [
      { id: "tee", category: "shirt", name: "cotton tee" },
      { id: "oxford", category: "shirt", name: "oxford shirt" },
      { id: "jeans", category: "pants", name: "jeans" },
      { id: "trunks", category: "shorts", name: "swim trunks" },
      { id: "sandals", category: "shoes", name: "sandals" },
      { id: "loafers", category: "shoes", name: "loafers" },
      { id: "blazer", category: "jacket", name: "navy blazer" },
    ];
    // Tight enough that the bag has to choose — at 12 L everything fits and
    // both trips trivially pack the same full set — but not so tight that the
    // formal trip physically cannot hold a blazer and shoes at once.
    const base = { items, bags: [{ id: "bag", volumeLiters: 9 }], days: 4, band: "warm" as const, rainChance: 0 };

    const beach = buildPackingPlan({ ...base, requirements: { activities: ["beach"], laundry: false } });
    const formal = buildPackingPlan({ ...base, requirements: { activities: ["formal"], laundry: false } });

    const ids = (p: typeof beach) => Object.values(p.assignments).flat().sort().join(",");
    expect(ids(beach)).not.toBe(ids(formal));
    expect(Object.values(beach.assignments).flat()).toContain("trunks");
    expect(Object.values(formal.assignments).flat()).toContain("loafers");
  });
});
