import { afterEach, describe, expect, it } from "vitest";
import { serpSearchCostTenthCents } from "@/lib/server/product-search-log";

const ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ENV };
});

describe("serpSearchCostTenthCents", () => {
  it("is zero when unset, so the ledger reports a count and no invented total", () => {
    delete process.env.SERPAPI_COST_TENTH_CENTS;
    expect(serpSearchCostTenthCents()).toBe(0);
  });

  it("treats blank and whitespace as unset", () => {
    process.env.SERPAPI_COST_TENTH_CENTS = "";
    expect(serpSearchCostTenthCents()).toBe(0);
    process.env.SERPAPI_COST_TENTH_CENTS = "   ";
    expect(serpSearchCostTenthCents()).toBe(0);
  });

  it("reads a configured plan rate", () => {
    // $75 / 5,000 searches = $0.015 = 15 tenths of a cent.
    process.env.SERPAPI_COST_TENTH_CENTS = "15";
    expect(serpSearchCostTenthCents()).toBe(15);
  });

  it("rounds to whole tenths, because the column is an integer", () => {
    process.env.SERPAPI_COST_TENTH_CENTS = "14.6";
    expect(serpSearchCostTenthCents()).toBe(15);
  });

  it("refuses garbage and negatives rather than storing them", () => {
    for (const bad of ["free", "-5", "0", "NaN"]) {
      process.env.SERPAPI_COST_TENTH_CENTS = bad;
      expect(serpSearchCostTenthCents()).toBe(0);
    }
  });
});
