import { describe, it, expect } from "vitest";
import {
  compareBuyOrder,
  computeBudgetSummary,
  drawdownCents,
  plannedCentsForPriority,
  rankByAffordability,
  type BudgetLineItem,
} from "../lib/wishlist/budget";
import {
  PRIORITY_MUST,
  PRIORITY_SOMEDAY,
  PRIORITY_WANT,
  centsToInput,
  normalizePriority,
} from "../lib/wishlist/priority";

function item(over: Partial<BudgetLineItem> & { id: string }): BudgetLineItem {
  return {
    priceCents: null,
    purchasedAt: null,
    purchasedCents: null,
    wishlistPriority: PRIORITY_WANT,
    ...over,
  };
}

describe("computeBudgetSummary", () => {
  it("splits a pot into spent, planned and what's left", () => {
    const s = computeBudgetSummary({
      potCents: 1_000_000, // $10,000
      items: [
        item({ id: "a", priceCents: 30_000, purchasedAt: new Date(), purchasedCents: 27_500 }),
        item({ id: "b", priceCents: 120_000 }),
        item({ id: "c", priceCents: 45_000 }),
      ],
    });

    expect(s.fundsCents).toBe(1_000_000);
    expect(s.spentCents).toBe(27_500); // what was paid, not the sticker
    expect(s.plannedCents).toBe(165_000);
    expect(s.remainingCents).toBe(972_500);
    expect(s.uncommittedCents).toBe(807_500);
    expect(s.purchasedCount).toBe(1);
    expect(s.plannedCount).toBe(2);
    expect(s.overCommitted).toBe(false);
    expect(s.overspent).toBe(false);
  });

  it("falls back to the sticker price when no paid amount was recorded", () => {
    const s = computeBudgetSummary({
      potCents: 100_000,
      items: [item({ id: "a", priceCents: 8_000, purchasedAt: "2026-01-02T00:00:00.000Z" })],
    });
    expect(s.spentCents).toBe(8_000);
  });

  it("folds resale proceeds into the funds", () => {
    const s = computeBudgetSummary({
      potCents: 1_000_000,
      salesCents: 24_000,
      items: [],
    });
    expect(s.fundsCents).toBe(1_024_000);
    expect(s.remainingCents).toBe(1_024_000);
  });

  it("flags a list that outruns the money", () => {
    const s = computeBudgetSummary({
      potCents: 50_000,
      items: [item({ id: "a", priceCents: 40_000 }), item({ id: "b", priceCents: 30_000 })],
    });
    expect(s.overCommitted).toBe(true);
    expect(s.uncommittedCents).toBe(-20_000);
    expect(s.overspent).toBe(false);
  });

  it("flags overspending separately from over-planning", () => {
    const s = computeBudgetSummary({
      potCents: 10_000,
      items: [item({ id: "a", priceCents: 15_000, purchasedAt: new Date() })],
    });
    expect(s.overspent).toBe(true);
    expect(s.remainingCents).toBe(-5_000);
    expect(s.remainingFraction).toBe(0);
  });

  it("counts unpriced items instead of guessing at their cost", () => {
    const s = computeBudgetSummary({
      potCents: 100_000,
      items: [item({ id: "a" }), item({ id: "b", priceCents: 5_000 })],
    });
    expect(s.unpricedCount).toBe(1);
    expect(s.plannedCents).toBe(5_000);
    expect(s.plannedCount).toBe(2);
  });

  it("treats a zero pot as zero funds rather than dividing by it", () => {
    const s = computeBudgetSummary({ potCents: 0, items: [item({ id: "a", priceCents: 1_000 })] });
    expect(s.remainingFraction).toBe(0);
    expect(s.overCommitted).toBe(true);
  });

  it("clamps a negative pot to zero", () => {
    const s = computeBudgetSummary({ potCents: -500, items: [] });
    expect(s.potCents).toBe(0);
    expect(s.fundsCents).toBe(0);
  });
});

describe("drawdownCents", () => {
  it("prefers what was actually paid", () => {
    expect(drawdownCents(item({ id: "a", priceCents: 500, purchasedCents: 300 }))).toBe(300);
  });

  it("falls back to the sticker, then to zero", () => {
    expect(drawdownCents(item({ id: "a", priceCents: 500 }))).toBe(500);
    expect(drawdownCents(item({ id: "a" }))).toBe(0);
  });
});

describe("compareBuyOrder", () => {
  it("puts must-haves before wants before somedays", () => {
    const rows = [
      item({ id: "someday", wishlistPriority: PRIORITY_SOMEDAY, priceCents: 100 }),
      item({ id: "must", wishlistPriority: PRIORITY_MUST, priceCents: 9_000 }),
      item({ id: "want", wishlistPriority: PRIORITY_WANT, priceCents: 500 }),
    ];
    expect([...rows].sort(compareBuyOrder).map((r) => r.id)).toEqual([
      "must",
      "want",
      "someday",
    ]);
  });

  it("breaks ties by price so a cheap item isn't stranded behind a costly one", () => {
    const rows = [
      item({ id: "pricey", priceCents: 20_000 }),
      item({ id: "cheap", priceCents: 2_000 }),
    ];
    expect([...rows].sort(compareBuyOrder).map((r) => r.id)).toEqual(["cheap", "pricey"]);
  });

  it("sorts unpriced items last within their tier", () => {
    const rows = [item({ id: "unknown" }), item({ id: "known", priceCents: 90_000 })];
    expect([...rows].sort(compareBuyOrder).map((r) => r.id)).toEqual(["known", "unknown"]);
  });
});

describe("rankByAffordability", () => {
  it("marks the point where the money runs out", () => {
    const rows = [
      item({ id: "a", wishlistPriority: PRIORITY_MUST, priceCents: 40_000 }),
      item({ id: "b", wishlistPriority: PRIORITY_WANT, priceCents: 40_000 }),
      item({ id: "c", wishlistPriority: PRIORITY_WANT, priceCents: 50_000 }),
    ];
    const ranked = rankByAffordability(rows, 90_000);

    expect(ranked.map((r) => r.item.id)).toEqual(["a", "b", "c"]);
    expect(ranked.map((r) => r.cumulativeCents)).toEqual([40_000, 80_000, 130_000]);
    expect(ranked.map((r) => r.affordable)).toEqual([true, true, false]);
  });

  it("excludes items already bought", () => {
    const rows = [
      item({ id: "bought", priceCents: 10_000, purchasedAt: new Date() }),
      item({ id: "open", priceCents: 10_000 }),
    ];
    expect(rankByAffordability(rows, 50_000).map((r) => r.item.id)).toEqual(["open"]);
  });

  it("does not let an unpriced item push a priced one below the line", () => {
    const rows = [
      item({ id: "unpriced", wishlistPriority: PRIORITY_MUST }),
      item({ id: "priced", wishlistPriority: PRIORITY_MUST, priceCents: 10_000 }),
    ];
    const ranked = rankByAffordability(rows, 10_000);
    expect(ranked.every((r) => r.affordable)).toBe(true);
  });
});

describe("normalizePriority", () => {
  it("passes through known tiers", () => {
    expect(normalizePriority(PRIORITY_MUST)).toBe(PRIORITY_MUST);
    expect(normalizePriority(PRIORITY_SOMEDAY)).toBe(PRIORITY_SOMEDAY);
  });

  it("falls back to Want for null and out-of-range values", () => {
    expect(normalizePriority(null)).toBe(PRIORITY_WANT);
    expect(normalizePriority(undefined)).toBe(PRIORITY_WANT);
    expect(normalizePriority(99)).toBe(PRIORITY_WANT);
    expect(normalizePriority(-1)).toBe(PRIORITY_WANT);
  });
});

describe("centsToInput", () => {
  it("keeps whole dollars short and preserves real cents", () => {
    expect(centsToInput(10_000)).toBe("100");
    expect(centsToInput(2990)).toBe("29.90");
    expect(centsToInput(8999)).toBe("89.99");
  });

  it("returns an empty string for nothing to show", () => {
    expect(centsToInput(null)).toBe("");
    expect(centsToInput(undefined)).toBe("");
    expect(centsToInput(0)).toBe("");
    expect(centsToInput(NaN)).toBe("");
  });
});

describe("plannedCentsForPriority", () => {
  it("sums one tier, ignoring purchases", () => {
    const rows = [
      item({ id: "a", wishlistPriority: PRIORITY_MUST, priceCents: 1_000 }),
      item({ id: "b", wishlistPriority: PRIORITY_MUST, priceCents: 2_000 }),
      item({
        id: "c",
        wishlistPriority: PRIORITY_MUST,
        priceCents: 9_000,
        purchasedAt: new Date(),
      }),
      item({ id: "d", wishlistPriority: PRIORITY_WANT, priceCents: 5_000 }),
    ];
    expect(plannedCentsForPriority(rows, PRIORITY_MUST)).toBe(3_000);
  });
});
