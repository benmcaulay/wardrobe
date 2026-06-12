import { describe, it, expect } from "vitest";
import { sellThroughInsight, formatRate, type InsightListing } from "../lib/sale-listing";

describe("sellThroughInsight", () => {
  it("returns nulls for an empty board", () => {
    expect(sellThroughInsight([])).toEqual({
      sellThroughRate: null,
      realizedCount: 0,
      realizedRate: null,
      recoveryRate: null,
      avgDiscountCents: null,
    });
  });

  it("computes sell-through as sold / (sold + active), ignoring kept items", () => {
    const listings: InsightListing[] = [
      { status: "sold", askingCents: 1000, soldPriceCents: 900, retailCents: 4000 },
      { status: "for_sale", askingCents: 2000, soldPriceCents: null },
      { status: "listed", askingCents: 1500, soldPriceCents: null },
      { status: "skipped", askingCents: 9999, soldPriceCents: null }, // ignored
    ];
    // 1 sold / (1 sold + 2 active) = 0.333…
    expect(sellThroughInsight(listings).sellThroughRate).toBeCloseTo(1 / 3, 5);
  });

  it("dollar-weights realized and recovery rates across sold items with prices", () => {
    const listings: InsightListing[] = [
      // $200 coat: sold $180 (90% of asking), recovered 30% of $600 retail
      { status: "sold", askingCents: 20000, soldPriceCents: 18000, retailCents: 60000 },
      // $20 tee: sold $10 (50% of asking), recovered 20% of $50 retail
      { status: "sold", askingCents: 2000, soldPriceCents: 1000, retailCents: 5000 },
    ];
    const i = sellThroughInsight(listings);
    expect(i.realizedCount).toBe(2);
    // realized = (18000+1000) / (20000+2000) = 19000/22000
    expect(i.realizedRate).toBeCloseTo(19000 / 22000, 5);
    // recovery = (18000+1000) / (60000+5000) = 19000/65000
    expect(i.recoveryRate).toBeCloseTo(19000 / 65000, 5);
    // avg discount = ((20000-18000)+(2000-1000)) / 2 = 1500
    expect(i.avgDiscountCents).toBe(1500);
  });

  it("excludes sold items without a recorded price from the rate basis", () => {
    const listings: InsightListing[] = [
      { status: "sold", askingCents: 1000, soldPriceCents: 800, retailCents: 2000 },
      { status: "sold", askingCents: 5000, soldPriceCents: null, retailCents: 9000 }, // legacy
    ];
    const i = sellThroughInsight(listings);
    expect(i.realizedCount).toBe(1);
    expect(i.realizedRate).toBeCloseTo(0.8, 5); // only the priced one
    expect(i.sellThroughRate).toBe(1); // but both count as sold for sell-through
  });

  it("leaves recovery null when no sold item has a retail anchor", () => {
    const i = sellThroughInsight([
      { status: "sold", askingCents: 1000, soldPriceCents: 900, retailCents: null },
    ]);
    expect(i.realizedRate).toBeCloseTo(0.9, 5);
    expect(i.recoveryRate).toBeNull();
  });
});

describe("formatRate", () => {
  it("renders a 0..1+ rate as whole percent", () => {
    expect(formatRate(0.88)).toBe("88%");
    expect(formatRate(1.05)).toBe("105%");
    expect(formatRate(0)).toBe("0%");
  });
});
