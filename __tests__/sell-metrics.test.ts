import { describe, it, expect } from "vitest";
import {
  daysToSell,
  earnedBetween,
  earningsSummary,
  formatDays,
  opportunitySize,
  overallAvgDaysToSell,
  platformBreakdown,
  startOfMonthMs,
  type MetricPlacement,
} from "../lib/sell/metrics";

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse("2026-06-01T00:00:00Z");

function placement(over: Partial<MetricPlacement> = {}): MetricPlacement {
  return {
    listingId: "l1",
    platform: "depop",
    status: "sold",
    soldPriceCents: 5000,
    feeCents: 500,
    shippingCents: 0,
    listedAtMs: T0,
    soldAtMs: T0 + 10 * DAY,
    ...over,
  };
}

describe("earningsSummary", () => {
  it("is all zeros with nothing sold", () => {
    expect(earningsSummary({ soldListings: [], placements: [] })).toEqual({
      grossCents: 0,
      attributedGrossCents: 0,
      unattributedGrossCents: 0,
      feesCents: 0,
      shippingCents: 0,
      netCents: 0,
      soldCount: 0,
      unattributedCount: 0,
    });
  });

  it("sums attributed sales and subtracts fees and shipping", () => {
    const s = earningsSummary({
      soldListings: [
        { listingId: "a", soldPriceCents: 5000 },
        { listingId: "b", soldPriceCents: 3000 },
      ],
      placements: [
        placement({ listingId: "a", soldPriceCents: 5000, feeCents: 500, shippingCents: 700 }),
        placement({ listingId: "b", soldPriceCents: 3000, feeCents: 300, shippingCents: 0 }),
      ],
    });
    expect(s.grossCents).toBe(8000);
    expect(s.attributedGrossCents).toBe(8000);
    expect(s.feesCents).toBe(800);
    expect(s.shippingCents).toBe(700);
    expect(s.netCents).toBe(6500);
    expect(s.soldCount).toBe(2);
  });

  it("counts a sale with no placement toward gross, in its own bucket", () => {
    // The whole point: we know it sold and for how much, not where. It must
    // still show up in "you've made", without being assigned to a platform.
    const s = earningsSummary({
      soldListings: [
        { listingId: "a", soldPriceCents: 5000 },
        { listingId: "orphan", soldPriceCents: 2500 },
      ],
      placements: [placement({ listingId: "a", soldPriceCents: 5000, feeCents: 500 })],
    });
    expect(s.grossCents).toBe(7500);
    expect(s.attributedGrossCents).toBe(5000);
    expect(s.unattributedGrossCents).toBe(2500);
    expect(s.unattributedCount).toBe(1);
    expect(s.soldCount).toBe(2);
  });

  it("does not double-count a listing that has a sold placement", () => {
    const s = earningsSummary({
      soldListings: [{ listingId: "a", soldPriceCents: 5000 }],
      placements: [placement({ listingId: "a", soldPriceCents: 5000 })],
    });
    expect(s.grossCents).toBe(5000);
    expect(s.soldCount).toBe(1);
  });

  it("ignores placements that haven't sold", () => {
    const s = earningsSummary({
      soldListings: [],
      placements: [
        placement({ status: "listed", soldPriceCents: null }),
        placement({ status: "draft", soldPriceCents: null }),
        placement({ status: "ended", soldPriceCents: null }),
      ],
    });
    expect(s.grossCents).toBe(0);
    expect(s.soldCount).toBe(0);
  });

  it("survives a sold row with no recorded price", () => {
    const s = earningsSummary({
      soldListings: [{ listingId: "a", soldPriceCents: null }],
      placements: [],
    });
    expect(s.grossCents).toBe(0);
    expect(s.unattributedCount).toBe(1);
  });
});

describe("earnedBetween", () => {
  const placements = [
    placement({ listingId: "a", soldAtMs: T0 + 1 * DAY, soldPriceCents: 1000, feeCents: 100 }),
    placement({ listingId: "b", soldAtMs: T0 + 20 * DAY, soldPriceCents: 2000, feeCents: 200 }),
    placement({ listingId: "c", soldAtMs: null, soldPriceCents: 9999 }),
  ];

  it("counts only sales inside the window", () => {
    const r = earnedBetween(placements, T0, T0 + 10 * DAY);
    expect(r.grossCents).toBe(1000);
    expect(r.netCents).toBe(900);
    expect(r.soldCount).toBe(1);
  });

  it("excludes sales with no recorded date", () => {
    // Backfilled rows have no soldAt — they must not silently land in "this month".
    const r = earnedBetween(placements, T0 - 365 * DAY, T0 + 365 * DAY);
    expect(r.soldCount).toBe(2);
    expect(r.grossCents).toBe(3000);
  });

  it("includes sales exactly on the boundaries", () => {
    expect(earnedBetween(placements, T0 + 1 * DAY, T0 + 1 * DAY).soldCount).toBe(1);
  });
});

describe("startOfMonthMs", () => {
  it("snaps to the first of the month", () => {
    const d = new Date(startOfMonthMs(Date.parse("2026-06-17T13:45:00")));
    expect(d.getDate()).toBe(1);
    expect(d.getMonth()).toBe(5);
    expect(d.getHours()).toBe(0);
  });
});

describe("daysToSell", () => {
  it("measures listed to sold", () => {
    expect(daysToSell(placement({ listedAtMs: T0, soldAtMs: T0 + 7 * DAY }))).toBe(7);
  });

  it("is null without both dates", () => {
    expect(daysToSell(placement({ listedAtMs: null }))).toBeNull();
    expect(daysToSell(placement({ soldAtMs: null }))).toBeNull();
  });

  it("is null for a placement that hasn't sold", () => {
    expect(daysToSell(placement({ status: "listed" }))).toBeNull();
  });

  it("rejects a negative span instead of clamping it to zero", () => {
    // A sold-before-listed row is corrupt; folding it in as "0 days" would
    // drag the average toward a number we know is wrong.
    expect(daysToSell(placement({ listedAtMs: T0 + 5 * DAY, soldAtMs: T0 }))).toBeNull();
  });
});

describe("platformBreakdown", () => {
  const placements = [
    placement({ listingId: "a", platform: "depop", soldPriceCents: 4000, feeCents: 200, soldAtMs: T0 + 6 * DAY }),
    placement({ listingId: "b", platform: "depop", soldPriceCents: 2000, feeCents: 100, soldAtMs: T0 + 12 * DAY }),
    placement({ listingId: "c", platform: "poshmark", soldPriceCents: 9000, feeCents: 1800, soldAtMs: T0 + 30 * DAY }),
    placement({ listingId: "d", platform: "vinted", status: "listed", soldPriceCents: null }),
    placement({ listingId: "e", platform: "vinted", status: "draft", soldPriceCents: null }),
  ];

  it("sorts by gross so the platform earning you money leads", () => {
    const rows = platformBreakdown(placements);
    expect(rows.map((r) => r.platform)).toEqual(["poshmark", "depop", "vinted"]);
  });

  it("aggregates gross, fees, and net per platform", () => {
    const depop = platformBreakdown(placements).find((r) => r.platform === "depop")!;
    expect(depop.soldCount).toBe(2);
    expect(depop.grossCents).toBe(6000);
    expect(depop.feesCents).toBe(300);
    expect(depop.netCents).toBe(5700);
  });

  it("averages days to sell per platform", () => {
    const depop = platformBreakdown(placements).find((r) => r.platform === "depop")!;
    expect(depop.avgDaysToSell).toBe(9); // (6 + 12) / 2
    expect(depop.timedSaleCount).toBe(2);
  });

  it("counts live and drafted pieces without treating them as sales", () => {
    const vinted = platformBreakdown(placements).find((r) => r.platform === "vinted")!;
    expect(vinted.activeCount).toBe(2);
    expect(vinted.soldCount).toBe(0);
    expect(vinted.avgDaysToSell).toBeNull();
  });

  it("omits platforms with no activity", () => {
    expect(platformBreakdown(placements).some((r) => r.platform === "grailed")).toBe(false);
  });

  it("returns an empty list for an empty board", () => {
    expect(platformBreakdown([])).toEqual([]);
  });
});

describe("overallAvgDaysToSell", () => {
  it("reports the count the average rests on", () => {
    const r = overallAvgDaysToSell([
      placement({ soldAtMs: T0 + 4 * DAY }),
      placement({ soldAtMs: T0 + 8 * DAY }),
      placement({ soldAtMs: null }),
    ]);
    expect(r.avgDays).toBe(6);
    expect(r.timedSaleCount).toBe(2);
  });

  it("is null with no timed sales", () => {
    expect(overallAvgDaysToSell([placement({ listedAtMs: null })])).toEqual({
      avgDays: null,
      timedSaleCount: 0,
    });
  });
});

describe("opportunitySize", () => {
  const estimate = (retail: number | null) => (retail && retail > 0 ? Math.round(retail * 0.35) : null);

  it("adds estimated untriaged value to active asking prices", () => {
    const o = opportunitySize({
      untriaged: [{ retailCents: 10000 }, { retailCents: 4000 }],
      active: [{ askingCents: 2500 }, { askingCents: 1500 }],
      estimateCents: estimate,
    });
    expect(o.untriagedValueCents).toBe(4900); // 3500 + 1400
    expect(o.activeAskingCents).toBe(4000);
    expect(o.totalCents).toBe(8900);
    expect(o.totalCount).toBe(4);
  });

  it("counts unpriced pieces separately so the estimate reads as conservative", () => {
    const o = opportunitySize({
      untriaged: [{ retailCents: null }, { retailCents: 0 }, { retailCents: 10000 }],
      active: [],
      estimateCents: estimate,
    });
    expect(o.untriagedCount).toBe(3);
    expect(o.unpricedCount).toBe(2);
    expect(o.untriagedValueCents).toBe(3500);
  });

  it("handles an active listing with no asking price", () => {
    const o = opportunitySize({
      untriaged: [],
      active: [{ askingCents: null }, { askingCents: 2000 }],
      estimateCents: estimate,
    });
    expect(o.activeAskingCents).toBe(2000);
    expect(o.activeCount).toBe(2);
  });

  it("is empty for an empty closet", () => {
    const o = opportunitySize({ untriaged: [], active: [], estimateCents: estimate });
    expect(o.totalCents).toBe(0);
    expect(o.totalCount).toBe(0);
  });
});

describe("formatDays", () => {
  it("keeps one decimal under two days", () => {
    expect(formatDays(0.5)).toBe("0.5 d");
    expect(formatDays(1.25)).toBe("1.3 d");
  });

  it("rounds to whole days above that", () => {
    expect(formatDays(9.4)).toBe("9 d");
    expect(formatDays(30.6)).toBe("31 d");
  });
});
