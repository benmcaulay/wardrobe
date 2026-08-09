import { describe, it, expect } from "vitest";
import { readFeeOverrides, writeFeeOverride } from "../lib/sell/fee-prefs";

describe("readFeeOverrides", () => {
  it("is empty for prefs with nothing stored", () => {
    expect(readFeeOverrides(null)).toEqual({});
    expect(readFeeOverrides(undefined)).toEqual({});
    expect(readFeeOverrides({})).toEqual({});
  });

  it("reads a stored override", () => {
    const prefs = { marketplaceFees: { ebay: { commissionRate: 0.1 } } };
    expect(readFeeOverrides(prefs)).toEqual({ ebay: { commissionRate: 0.1 } });
  });

  it("drops unknown platforms", () => {
    const prefs = { marketplaceFees: { craigslist: { commissionRate: 0.1 } } };
    expect(readFeeOverrides(prefs)).toEqual({});
  });

  it("drops non-numeric and negative values", () => {
    const prefs = {
      marketplaceFees: {
        ebay: { commissionRate: "lots", commissionFlatCents: -5, processingRate: 0.02 },
      },
    };
    expect(readFeeOverrides(prefs)).toEqual({ ebay: { processingRate: 0.02 } });
  });

  it("omits a platform whose fields were all rejected", () => {
    const prefs = { marketplaceFees: { ebay: { commissionRate: Number.NaN } } };
    expect(readFeeOverrides(prefs)).toEqual({});
  });

  it("survives a garbage blob", () => {
    expect(readFeeOverrides({ marketplaceFees: "nope" })).toEqual({});
    expect(readFeeOverrides({ marketplaceFees: { ebay: 42 } })).toEqual({});
  });
});

describe("writeFeeOverride", () => {
  it("adds an override without disturbing other prefs", () => {
    const prefs = { sizes: { top: "M" } };
    const next = writeFeeOverride(prefs, "depop", { commissionRate: 0.05 });
    expect(next.sizes).toEqual({ top: "M" });
    expect(readFeeOverrides(next)).toEqual({ depop: { commissionRate: 0.05 } });
  });

  it("replaces an existing override for the same platform", () => {
    let prefs: Record<string, unknown> = writeFeeOverride({}, "depop", { commissionRate: 0.05 });
    prefs = writeFeeOverride(prefs, "depop", { commissionRate: 0.08 });
    expect(readFeeOverrides(prefs)).toEqual({ depop: { commissionRate: 0.08 } });
  });

  it("keeps other platforms when writing one", () => {
    let prefs: Record<string, unknown> = writeFeeOverride({}, "depop", { commissionRate: 0.05 });
    prefs = writeFeeOverride(prefs, "ebay", { commissionRate: 0.12 });
    expect(Object.keys(readFeeOverrides(prefs)).sort()).toEqual(["depop", "ebay"]);
  });

  it("removes an override when cleared", () => {
    let prefs: Record<string, unknown> = writeFeeOverride({}, "depop", { commissionRate: 0.05 });
    prefs = writeFeeOverride(prefs, "depop", null);
    expect(readFeeOverrides(prefs)).toEqual({});
  });

  it("treats an empty override as a removal", () => {
    let prefs: Record<string, unknown> = writeFeeOverride({}, "depop", { commissionRate: 0.05 });
    prefs = writeFeeOverride(prefs, "depop", {});
    expect(readFeeOverrides(prefs)).toEqual({});
  });
});
