import { describe, it, expect } from "vitest";
import {
  completeDayCount,
  distinctOutfitCount,
  outfitIsCoherent,
  planDailyOutfits,
  rewearDayCount,
  type OutfitPiece,
} from "../lib/packing/outfits";
import type { CategoryBucket } from "../lib/packing/plan";

const piece = (id: string, bucket: CategoryBucket, ...colors: string[]): OutfitPiece => ({
  id,
  bucket,
  colors: colors.map((name) => ({ name, hex: "#000000" })),
});

describe("outfitIsCoherent", () => {
  it("accepts an all-neutral look", () => {
    expect(outfitIsCoherent([piece("t", "top", "black"), piece("b", "bottom", "beige")])).toBe(true);
  });

  it("accepts exactly one statement colour", () => {
    expect(outfitIsCoherent([piece("t", "top", "red"), piece("b", "bottom", "black")])).toBe(true);
  });

  it("rejects two statement colours", () => {
    expect(outfitIsCoherent([piece("t", "top", "red"), piece("b", "bottom", "green")])).toBe(false);
  });

  it("does not count near-neutrals against a look", () => {
    // Navy and brown behave as neutrals in practice.
    expect(outfitIsCoherent([piece("t", "top", "red"), piece("b", "bottom", "navy")])).toBe(true);
  });

  it("treats an untagged piece as neutral rather than a clash", () => {
    const untagged: OutfitPiece = { id: "u", bucket: "bottom" };
    expect(outfitIsCoherent([piece("t", "top", "red"), untagged])).toBe(true);
  });

  it("judges on the dominant colour only", () => {
    // A black shirt with a small red graphic is not a statement piece.
    expect(
      outfitIsCoherent([piece("t", "top", "black", "red"), piece("b", "bottom", "orange")]),
    ).toBe(true);
  });
});

describe("planDailyOutfits", () => {
  const basic = [
    piece("top1", "top", "black"),
    piece("top2", "top", "white"),
    piece("bot1", "bottom", "navy"),
    piece("shoe1", "shoes", "white"),
  ];

  it("produces one entry per trip day", () => {
    expect(planDailyOutfits({ packed: basic, days: 4 })).toHaveLength(4);
    expect(planDailyOutfits({ packed: basic, days: 4 }).map((d) => d.day)).toEqual([1, 2, 3, 4]);
  });

  it("returns nothing for a zero-day trip", () => {
    expect(planDailyOutfits({ packed: basic, days: 0 })).toEqual([]);
  });

  it("dresses each day with a top, a bottom and shoes", () => {
    for (const day of planDailyOutfits({ packed: basic, days: 3 })) {
      expect(day.complete).toBe(true);
      expect(day.itemIds).toContain("bot1");
      expect(day.itemIds).toContain("shoe1");
    }
  });

  it("rotates rather than wearing one top all week", () => {
    const plan = planDailyOutfits({ packed: basic, days: 4 });
    const firstTwo = [plan[0], plan[1]].map((d) => d.itemIds.find((i) => i.startsWith("top")));
    expect(firstTwo[0]).not.toBe(firstTwo[1]);
  });

  it("marks a day incomplete when the bag has no bottoms", () => {
    // The exact bag the old packer produced, inverted — this is what a day grid
    // makes impossible to miss.
    const noBottoms = [piece("top1", "top", "black"), piece("shoe1", "shoes", "white")];
    const plan = planDailyOutfits({ packed: noBottoms, days: 3 });
    expect(plan.every((d) => d.complete)).toBe(false);
    expect(completeDayCount(plan)).toBe(0);
  });

  it("marks days incomplete when there are no shoes", () => {
    const noShoes = [piece("top1", "top", "black"), piece("bot1", "bottom", "navy")];
    expect(completeDayCount(planDailyOutfits({ packed: noShoes, days: 2 }))).toBe(0);
  });

  it("avoids a colour clash by swapping the bottom", () => {
    const clashy = [
      piece("topRed", "top", "red"),
      piece("botGreen", "bottom", "green"),
      piece("botBlack", "bottom", "black"),
      piece("shoe1", "shoes", "white"),
    ];
    const day1 = planDailyOutfits({ packed: clashy, days: 1 })[0];
    expect(day1.coherent).toBe(true);
    expect(day1.itemIds).toContain("botBlack");
  });

  it("dresses the day anyway when every combination clashes", () => {
    const allClash = [
      piece("topRed", "top", "red"),
      piece("botGreen", "bottom", "green"),
      piece("shoe1", "shoes", "white"),
    ];
    const day1 = planDailyOutfits({ packed: allClash, days: 1 })[0];
    expect(day1.complete).toBe(true);
    expect(day1.coherent).toBe(false);
  });

  it("wears a dress as a whole look", () => {
    const withDress = [piece("d1", "dress", "black"), piece("shoe1", "shoes", "white")];
    const day1 = planDailyOutfits({ packed: withDress, days: 1 })[0];
    expect(day1.complete).toBe(true);
    expect(day1.itemIds).toContain("d1");
  });

  it("includes outerwear every day only when asked", () => {
    const cold = [...basic, piece("coat", "outerwear", "black")];
    expect(planDailyOutfits({ packed: cold, days: 2, includeOuterwear: true })[0].itemIds).toContain("coat");
    expect(planDailyOutfits({ packed: cold, days: 2 })[0].itemIds).not.toContain("coat");
  });

  it("keeps going past the wear budget rather than leaving days undressed", () => {
    // One top, seven days: you re-wear it. Better than four blank days.
    const thin = [piece("top1", "top", "black"), piece("bot1", "bottom", "navy"), piece("shoe1", "shoes", "white")];
    const plan = planDailyOutfits({ packed: thin, days: 7 });
    expect(completeDayCount(plan)).toBe(7);
  });

  it("is deterministic", () => {
    const a = planDailyOutfits({ packed: basic, days: 5 });
    const b = planDailyOutfits({ packed: basic, days: 5 });
    expect(a).toEqual(b);
  });
});

describe("distinctOutfitCount", () => {
  it("counts unique looks, not days", () => {
    const thin = [piece("top1", "top", "black"), piece("bot1", "bottom", "navy"), piece("shoe1", "shoes", "white")];
    expect(distinctOutfitCount(planDailyOutfits({ packed: thin, days: 5 }))).toBe(1);
  });

  it("grows as the bag offers more combinations", () => {
    const varied = [
      piece("top1", "top", "black"), piece("top2", "top", "white"), piece("top3", "top", "beige"),
      piece("bot1", "bottom", "navy"), piece("bot2", "bottom", "gray"),
      piece("shoe1", "shoes", "white"),
    ];
    expect(distinctOutfitCount(planDailyOutfits({ packed: varied, days: 6 }))).toBeGreaterThan(1);
  });

  it("ignores incomplete days", () => {
    const noShoes = [piece("top1", "top", "black"), piece("bot1", "bottom", "navy")];
    expect(distinctOutfitCount(planDailyOutfits({ packed: noShoes, days: 3 }))).toBe(0);
  });
});

describe("re-wear reconciliation", () => {
  const thin = [
    { id: "top1", bucket: "top" as const, colors: [{ name: "black", hex: "#000" }] },
    { id: "bot1", bucket: "bottom" as const, colors: [{ name: "navy", hex: "#001" }] },
    { id: "shoe1", bucket: "shoes" as const, colors: [{ name: "white", hex: "#fff" }] },
  ];

  it("flags days that only work by re-wearing", () => {
    // One top has a budget of 1 wear, so days 2+ are re-wears. The grid still
    // dresses them — it just says so, which is what keeps it consistent with
    // the "covers N of M days" warning.
    const plan = planDailyOutfits({ packed: thin, days: 5 });
    expect(completeDayCount(plan)).toBe(5);
    expect(rewearDayCount(plan)).toBeGreaterThan(0);
    expect(plan[0].rewear).toBe(false);
  });

  it("does not flag re-wear while there are clean clothes", () => {
    const plenty = [
      ...[1, 2, 3, 4].map((n) => ({ id: `top${n}`, bucket: "top" as const, colors: [{ name: "black", hex: "#000" }] })),
      ...[1, 2].map((n) => ({ id: `bot${n}`, bucket: "bottom" as const, colors: [{ name: "navy", hex: "#001" }] })),
      { id: "shoe1", bucket: "shoes" as const, colors: [{ name: "white", hex: "#fff" }] },
    ];
    expect(rewearDayCount(planDailyOutfits({ packed: plenty, days: 2 }))).toBe(0);
  });
});
