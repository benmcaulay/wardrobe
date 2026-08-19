import { describe, expect, it } from "vitest";
import {
  DEFAULT_ACTIVITY_DAYS,
  activityDayCount,
  activityDaySchedule,
  parseTripRequirements,
  type TripRequirements,
} from "@/lib/packing/requirements";
import { occasionForActivity } from "@/lib/packing/occasion";
import { planDailyOutfits, type OutfitPiece } from "@/lib/packing/outfits";

const reqs = (over: Partial<TripRequirements> = {}): TripRequirements => ({
  activities: [],
  laundry: false,
  ...over,
});

describe("activityDayCount", () => {
  it("defaults to one day", () => {
    expect(activityDayCount(reqs({ activities: ["beach"] }), "beach")).toBe(DEFAULT_ACTIVITY_DAYS);
  });

  it("uses the stored count", () => {
    expect(activityDayCount(reqs({ activityDays: { beach: 4 } }), "beach")).toBe(4);
  });

  it("clamps nonsense to something sane", () => {
    expect(activityDayCount(reqs({ activityDays: { beach: 0 } }), "beach")).toBe(1);
    expect(activityDayCount(reqs({ activityDays: { beach: -3 } }), "beach")).toBe(1);
    expect(activityDayCount(reqs({ activityDays: { beach: 999 } }), "beach")).toBe(30);
    expect(activityDayCount(reqs({ activityDays: { beach: NaN } }), "beach")).toBe(1);
    expect(activityDayCount(reqs({ activityDays: { beach: 2.6 } }), "beach")).toBe(3);
  });
});

describe("activityDaySchedule", () => {
  it("schedules nothing without activities", () => {
    expect(activityDaySchedule(7, reqs()).size).toBe(0);
  });

  it("schedules nothing for a zero-day trip", () => {
    expect(activityDaySchedule(0, reqs({ activities: ["beach"] })).size).toBe(0);
  });

  it("puts a single beach day in the middle of the trip", () => {
    const s = activityDaySchedule(11, reqs({ activities: ["beach"] }));
    expect([...s.entries()]).toEqual([[6, "beach"]]);
  });

  /** Two beach days on one trip want to be apart, not consecutive. */
  it("spreads several days of the same activity", () => {
    const days = [...activityDaySchedule(12, reqs({ activities: ["beach"], activityDays: { beach: 3 } })).keys()].sort(
      (a, b) => a - b,
    );
    expect(days).toHaveLength(3);
    for (let i = 1; i < days.length; i += 1) expect(days[i] - days[i - 1]).toBeGreaterThan(1);
  });

  it("never schedules outside the trip", () => {
    for (const total of [1, 2, 3, 5, 14]) {
      for (const day of activityDaySchedule(total, reqs({ activities: ["beach", "formal"], activityDays: { beach: 4, formal: 2 } })).keys()) {
        expect(day).toBeGreaterThanOrEqual(1);
        expect(day).toBeLessThanOrEqual(total);
      }
    }
  });

  /**
   * Two activities on one day is a conflict the planner can't resolve — it
   * would try to dress you for the beach and a black-tie dinner at once.
   */
  it("never puts two activities on the same day", () => {
    const s = activityDaySchedule(6, reqs({ activities: ["beach", "formal"], activityDays: { beach: 3, formal: 3 } }));
    expect(s.size).toBe(6);
    expect(new Set(s.keys()).size).toBe(6);
  });

  it("drops what won't fit rather than overflowing the trip", () => {
    const s = activityDaySchedule(3, reqs({ activities: ["beach", "formal"], activityDays: { beach: 3, formal: 3 } }));
    expect(s.size).toBe(3);
  });

  it("is deterministic and independent of which chip was tapped first", () => {
    const a = activityDaySchedule(9, reqs({ activities: ["beach", "formal"] }));
    const b = activityDaySchedule(9, reqs({ activities: ["formal", "beach"] }));
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort());
  });

  it("survives a one-day trip", () => {
    const s = activityDaySchedule(1, reqs({ activities: ["beach"] }));
    expect([...s.entries()]).toEqual([[1, "beach"]]);
  });
});

describe("occasionForActivity", () => {
  it("maps the activities that have their own wardrobe", () => {
    expect(occasionForActivity("beach")).toBe("swim");
    expect(occasionForActivity("formal")).toBe("formal");
  });

  /** Hiking and the gym are done in ordinary clothes. */
  it("maps nothing for activities done in normal clothes", () => {
    for (const a of ["hiking", "city", "gym", "business", "nonsense"]) {
      expect(occasionForActivity(a), a).toBeNull();
    }
  });
});

describe("planDailyOutfits with occasion days", () => {
  const packed: OutfitPiece[] = [
    { id: "tee", bucket: "top" },
    { id: "tee2", bucket: "top" },
    { id: "jeans", bucket: "bottom" },
    { id: "shoes", bucket: "shoes" },
  ];
  const trunks: OutfitPiece = { id: "trunks", bucket: "bottom" };

  it("wears the occasion piece on its day", () => {
    const plan = planDailyOutfits({ packed, days: 3, occasionByDay: { 2: [trunks] } });
    expect(plan[1].itemIds).toContain("trunks");
  });

  /** You wear trunks *instead of* your jeans, not as well as. */
  it("replaces the day's usual pick for that bucket", () => {
    const plan = planDailyOutfits({ packed, days: 3, occasionByDay: { 2: [trunks] } });
    expect(plan[1].itemIds).not.toContain("jeans");
    expect(plan[1].itemIds).toContain("shoes");
  });

  it("leaves every other day alone", () => {
    const plan = planDailyOutfits({ packed, days: 3, occasionByDay: { 2: [trunks] } });
    expect(plan[0].itemIds).not.toContain("trunks");
    expect(plan[2].itemIds).not.toContain("trunks");
    expect(plan[0].itemIds).toContain("jeans");
  });

  /**
   * The jeans the trunks displaced were never actually worn, so they shouldn't
   * be charged a wear — otherwise a beach day silently eats into the clean
   * clothes left for the rest of the trip.
   */
  it("does not charge a wear to the piece it displaced", () => {
    const withBeach = planDailyOutfits({ packed, days: 4, occasionByDay: { 2: [trunks] } });
    const without = planDailyOutfits({ packed, days: 4 });
    const jeansDays = (plan: typeof withBeach) =>
      plan.filter((d) => d.itemIds.includes("jeans")).length;
    // One fewer day of jeans (the beach day), and no earlier exhaustion.
    expect(jeansDays(withBeach)).toBe(jeansDays(without) - 1);
  });

  it("still marks the day complete", () => {
    const plan = planDailyOutfits({ packed, days: 3, occasionByDay: { 2: [trunks] } });
    expect(plan[1].complete).toBe(true);
  });

  it("is a no-op without a schedule", () => {
    expect(planDailyOutfits({ packed, days: 3 })).toEqual(
      planDailyOutfits({ packed, days: 3, occasionByDay: {} }),
    );
  });
});

describe("parseTripRequirements with activity days", () => {
  it("reads a stored count", () => {
    const r = parseTripRequirements(JSON.stringify({ activities: ["beach"], activityDays: { beach: 3 }, laundry: false }));
    expect(r.activityDays).toEqual({ beach: 3 });
  });

  it("drops counts for activities it doesn't know", () => {
    const r = parseTripRequirements(JSON.stringify({ activities: ["beach"], activityDays: { moon: 3 }, laundry: false }));
    expect(r.activityDays).toBeUndefined();
  });

  it("omits the field entirely when there's nothing to store", () => {
    const r = parseTripRequirements(JSON.stringify({ activities: ["beach"], laundry: false }));
    expect("activityDays" in r).toBe(false);
  });
});
