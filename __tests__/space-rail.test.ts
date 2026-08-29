import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_LANES,
  formatLastWorn,
  formatRailGap,
  layOutRail,
  NEVER_WORN_OFFSET,
  type RailInput,
} from "@/lib/space/rail";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 15, 12);

/** A piece last worn `days` ago. */
function worn(id: string, days: number): RailInput {
  return { id, lastWornAtMs: NOW - days * MS_PER_DAY };
}

const never = (id: string): RailInput => ({ id, lastWornAtMs: null });

describe("layOutRail", () => {
  it("puts the most recently worn piece at the near end and the least at the far end", () => {
    const { hangers } = layOutRail([worn("old", 300), worn("fresh", 1), worn("mid", 150)], NOW);
    expect(hangers.map((h) => h.id)).toEqual(["fresh", "mid", "old"]);
    expect(hangers[0].offset).toBe(0);
    expect(hangers[2].offset).toBe(1);
  });

  it("spaces by elapsed time, not by rank", () => {
    // Three worn in the last week, one worn a year ago. The three should crowd
    // the near end rather than spreading evenly across the rod — that spread is
    // the difference between this view and a sorted grid.
    const { hangers } = layOutRail(
      [worn("a", 1), worn("b", 3), worn("c", 6), worn("z", 365)],
      NOW,
    );
    const byId = new Map(hangers.map((h) => [h.id, h.offset]));
    expect(byId.get("c")!).toBeLessThan(0.05);
    expect(byId.get("z")).toBe(1);
  });

  it("collapses to a single position when every piece was worn the same day", () => {
    const { hangers, spanDays, gaps } = layOutRail([worn("a", 5), worn("b", 5)], NOW);
    expect(spanDays).toBe(0);
    expect(hangers.every((h) => h.offset === 0)).toBe(true);
    expect(gaps).toEqual([]);
  });

  it("clamps a wear logged later today to the near end rather than going negative", () => {
    const { hangers } = layOutRail([{ id: "future", lastWornAtMs: NOW + MS_PER_DAY }], NOW);
    expect(hangers[0].daysSince).toBe(0);
    expect(hangers[0].offset).toBe(0);
  });

  it("parks never-worn pieces past the furthest measurable gap", () => {
    const layout = layOutRail([worn("dormant", 400), never("n1"), never("n2")], NOW);
    expect(layout.neverWornCount).toBe(2);
    expect(layout.neverWornOffset).toBe(NEVER_WORN_OFFSET);

    const dormant = layout.hangers.find((h) => h.id === "dormant")!;
    // "Never" is a longer gap than any we can put a number on, so it must not
    // sit level with the most dormant dated piece.
    expect(dormant.offset).toBeLessThan(NEVER_WORN_OFFSET);
    expect(layout.hangers.filter((h) => h.offset === NEVER_WORN_OFFSET)).toHaveLength(2);
  });

  it("reports gaps in real days despite compressing the axis for never-worn", () => {
    const withNever = layOutRail([worn("a", 0), worn("b", 200), never("n")], NOW);
    const gap = withNever.gaps[0];
    expect(gap).toBeDefined();
    // The rod squeezed to 0.84 but the elapsed time did not.
    expect(gap.days).toBe(200);
  });

  it("names one gap per empty stretch, not one per neighbouring pair", () => {
    // Six pieces worn in the same week, then one a year later: one gap.
    const items = [0, 1, 2, 3, 4, 5].map((i) => worn(`recent${i}`, i));
    const { gaps } = layOutRail([...items, worn("far", 365)], NOW);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].days).toBeGreaterThan(300);
  });

  it("ignores stretches too small to be worth naming", () => {
    const { gaps } = layOutRail([worn("a", 0), worn("b", 200), worn("c", 205)], NOW);
    // The b→c stretch is five days: wide on the rod is not the same as long.
    expect(gaps.map((g) => g.days)).toEqual([200]);
  });

  it("does not name day-long gaps on a closet worn every day", () => {
    // The axis normalizes, so a one-day gap here is a third of the rod and
    // clears any fraction threshold. It is still not a fact about the wardrobe.
    const { gaps } = layOutRail([worn("a", 0), worn("b", 1), worn("c", 2)], NOW);
    expect(gaps).toEqual([]);
  });

  it("excludes never-worn pieces from gap days rather than inventing a duration", () => {
    // Only never-worn pieces: no measurable span at all, so no gap may be
    // reported even though the rod visibly has one end empty.
    const { gaps, spanDays } = layOutRail([never("a"), never("b")], NOW);
    expect(spanDays).toBe(0);
    expect(gaps).toEqual([]);
  });

  it("drops colliding hangers into extra lanes instead of moving them", () => {
    const items = [0, 1, 2].map((i) => worn(`c${i}`, 200 + i * 0.0001));
    const layout = layOutRail([...items, worn("far", 400)], NOW, { hangerFraction: 0.2 });
    const cluster = layout.hangers.filter((h) => h.id.startsWith("c"));
    expect(new Set(cluster.map((h) => h.lane)).size).toBeGreaterThan(1);
    // The offsets themselves are untouched — the offset is the data.
    expect(cluster.every((h) => h.offset < 0.6)).toBe(true);
  });

  it("caps lanes and lets a pile overlap rather than growing without bound", () => {
    const items = Array.from({ length: 20 }, (_, i) => never(`n${i}`));
    const layout = layOutRail(items, NOW);
    expect(layout.lanes).toBeLessThanOrEqual(DEFAULT_MAX_LANES);
    expect(layout.hangers).toHaveLength(20);
    expect(Math.max(...layout.hangers.map((h) => h.lane))).toBeLessThan(DEFAULT_MAX_LANES);
  });

  it("is stable for identical timestamps", () => {
    const items = [worn("b", 5), worn("a", 5), worn("c", 5)];
    const first = layOutRail(items, NOW);
    const second = layOutRail([...items].reverse(), NOW);
    expect(first.hangers.map((h) => `${h.id}:${h.lane}`)).toEqual(
      second.hangers.map((h) => `${h.id}:${h.lane}`),
    );
  });

  it("handles an empty rail", () => {
    const layout = layOutRail([], NOW);
    expect(layout).toMatchObject({
      hangers: [],
      gaps: [],
      spanDays: 0,
      neverWornCount: 0,
      lanes: 1,
    });
  });
});

describe("formatRailGap", () => {
  const gap = (days: number) => ({ fromOffset: 0, toOffset: 0.5, days });

  it("scales the unit to the size of the gap", () => {
    expect(formatRailGap(gap(1))).toBe("1 day of empty rail");
    expect(formatRailGap(gap(9))).toBe("9 days of empty rail");
    expect(formatRailGap(gap(21))).toBe("3 weeks of empty rail");
    expect(formatRailGap(gap(120))).toBe("4 months of empty rail");
    expect(formatRailGap(gap(900))).toBe("2+ years of empty rail");
  });

  it("stays descriptive — no verdict, no instruction", () => {
    const words = [30, 400, 900].map((d) => formatRailGap(gap(d)).toLowerCase()).join(" ");
    for (const banned of ["should", "wasted", "unused", "dead", "consider", "sell"]) {
      expect(words).not.toContain(banned);
    }
  });
});

describe("formatLastWorn", () => {
  it("scales the unit, and names the two days that have names", () => {
    expect(formatLastWorn(0)).toBe("Worn today");
    expect(formatLastWorn(1)).toBe("Worn yesterday");
    expect(formatLastWorn(9)).toBe("Worn 9 days ago");
    expect(formatLastWorn(28)).toBe("Worn 4 weeks ago");
    expect(formatLastWorn(180)).toBe("Worn 6 months ago");
    expect(formatLastWorn(1000)).toBe("Worn 2+ years ago");
  });

  it("says never rather than an enormous number", () => {
    expect(formatLastWorn(null)).toBe("Never worn");
  });
});

describe("stacking", () => {
  it("is zero when every hanger has its own spot", () => {
    const layout = layOutRail([worn("a", 0), worn("b", 200), worn("c", 400)], NOW);
    expect(layout.hangers.every((h) => h.stack === 0)).toBe(true);
  });

  it("counts how many hangers share one spot in one lane", () => {
    // Twelve never-worn pieces on one offset with four lanes: three per lane,
    // so each lane must report stacks 0, 1, 2 for the renderer to fan them.
    const layout = layOutRail(
      Array.from({ length: 12 }, (_, i) => never(`n${i}`)),
      NOW,
      { maxLanes: 4 },
    );
    for (let lane = 0; lane < 4; lane += 1) {
      const inLane = layout.hangers.filter((h) => h.lane === lane).map((h) => h.stack).sort();
      expect(inLane).toEqual([0, 1, 2]);
    }
  });

  it("never leaves a hanger hidden behind another with no way to tell", () => {
    const layout = layOutRail(
      Array.from({ length: 9 }, (_, i) => never(`n${i}`)),
      NOW,
      { maxLanes: 3 },
    );
    const spots = new Set(layout.hangers.map((h) => `${h.lane}:${h.offset}:${h.stack}`));
    // Every hanger is distinguishable by lane + offset + stack, which is what
    // the component needs to draw nine of nine.
    expect(spots.size).toBe(9);
  });
});
