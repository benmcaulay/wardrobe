import { describe, it, expect } from "vitest";
import {
  DEFAULT_FEE_RULES,
  compareNetByPlatform,
  estimateFeeCents,
  isFeeRuleStale,
  netProceedsCents,
  resolveFeeRule,
  type FeeOverrides,
} from "../lib/sell/fees";
import { MARKETPLACES } from "../lib/marketplaces";

describe("fee table", () => {
  it("covers every marketplace we link to", () => {
    for (const m of MARKETPLACES) {
      expect(DEFAULT_FEE_RULES[m.id], `missing fee rule for ${m.id}`).toBeDefined();
    }
  });

  it("carries a parseable asOf date on every rule", () => {
    for (const [id, rule] of Object.entries(DEFAULT_FEE_RULES)) {
      expect(Number.isNaN(Date.parse(rule.asOf)), `bad asOf on ${id}`).toBe(false);
    }
  });
});

describe("estimateFeeCents", () => {
  it("takes a straight percentage plus flat fee (eBay)", () => {
    // $100 × 13.25% + $0.30 = $13.55
    expect(estimateFeeCents("ebay", 10000)).toBe(1355);
  });

  it("uses the small-order flat fee below the threshold (Poshmark)", () => {
    expect(estimateFeeCents("poshmark", 1000)).toBe(295); // under $15 → flat $2.95
    expect(estimateFeeCents("poshmark", 2000)).toBe(400); // $20 × 20% = $4.00
  });

  it("switches to the percentage exactly at the threshold", () => {
    expect(estimateFeeCents("poshmark", 1499)).toBe(295);
    expect(estimateFeeCents("poshmark", 1500)).toBe(300);
  });

  it("charges nothing on platforms that moved fees to the buyer", () => {
    expect(estimateFeeCents("vinted", 5000)).toBe(0);
    expect(estimateFeeCents("mercari", 5000)).toBe(0);
  });

  it("still charges processing where the platform bills it separately", () => {
    // Depop: no commission, 3.3% + $0.45 on $50 = $1.65 + $0.45 = $2.10
    expect(estimateFeeCents("depop", 5000)).toBe(210);
  });

  it("never takes more than the sale price", () => {
    // A $0.50 sale can't owe eBay $0.37 + 13.25% and then some.
    expect(estimateFeeCents("ebay", 50)).toBeLessThanOrEqual(50);
    expect(estimateFeeCents("poshmark", 100)).toBe(100);
  });

  it("returns zero for a non-sale", () => {
    expect(estimateFeeCents("ebay", 0)).toBe(0);
    expect(estimateFeeCents("ebay", -500)).toBe(0);
    expect(estimateFeeCents("ebay", Number.NaN)).toBe(0);
  });
});

describe("resolveFeeRule overrides", () => {
  it("applies a user's corrected rate", () => {
    const overrides: FeeOverrides = { ebay: { commissionRate: 0.1 } };
    expect(resolveFeeRule("ebay", overrides).commissionRate).toBe(0.1);
    expect(estimateFeeCents("ebay", 10000, overrides)).toBe(1030); // 10% + $0.30
  });

  it("reads a whole number as a percentage", () => {
    // Someone typing "20" means 20%, not 2000%.
    expect(resolveFeeRule("depop", { depop: { commissionRate: 20 } }).commissionRate).toBe(0.2);
  });

  it("clamps an absurd rate rather than producing a negative payout", () => {
    const rule = resolveFeeRule("depop", { depop: { commissionRate: 500 } });
    expect(rule.commissionRate).toBeLessThanOrEqual(0.9);
  });

  it("ignores garbage and keeps the default", () => {
    const base = DEFAULT_FEE_RULES.grailed.commissionRate;
    expect(resolveFeeRule("grailed", { grailed: { commissionRate: -1 } }).commissionRate).toBe(base);
    expect(
      resolveFeeRule("grailed", { grailed: { commissionRate: Number.NaN } }).commissionRate,
    ).toBe(base);
  });

  it("leaves untouched platforms on the default so later updates still reach them", () => {
    const resolved = resolveFeeRule("poshmark", { ebay: { commissionRate: 0.01 } });
    expect(resolved).toEqual(DEFAULT_FEE_RULES.poshmark);
  });
});

describe("netProceedsCents", () => {
  it("subtracts fees and absorbed shipping", () => {
    expect(netProceedsCents({ saleCents: 5000, feeCents: 400, shippingCents: 800 })).toBe(3800);
  });

  it("treats missing costs as zero", () => {
    expect(netProceedsCents({ saleCents: 5000 })).toBe(5000);
  });

  it("reports a real loss rather than flooring at zero", () => {
    // $8 sale, $12 of shipping eaten — that's a $4 loss and should read as one.
    expect(netProceedsCents({ saleCents: 800, feeCents: 0, shippingCents: 1200 })).toBe(-400);
  });
});

describe("compareNetByPlatform", () => {
  it("ranks the cheapest platform first", () => {
    const ranked = compareNetByPlatform(10000, ["ebay", "vinted", "poshmark"]);
    expect(ranked[0].platform).toBe("vinted");
    expect(ranked[0].netCents).toBe(10000);
    expect(ranked[ranked.length - 1].platform).toBe("poshmark"); // 20% is the worst here
  });

  it("respects overrides when ranking", () => {
    const ranked = compareNetByPlatform(10000, ["ebay", "poshmark"], {
      poshmark: { commissionRate: 0.01 },
    });
    expect(ranked[0].platform).toBe("poshmark");
  });
});

describe("isFeeRuleStale", () => {
  const rule = { ...DEFAULT_FEE_RULES.ebay, asOf: "2026-01-01" };

  it("is fresh inside the window", () => {
    expect(isFeeRuleStale(rule, Date.parse("2026-03-01"))).toBe(false);
  });

  it("goes stale after six months", () => {
    expect(isFeeRuleStale(rule, Date.parse("2026-10-01"))).toBe(true);
  });

  it("treats an unparseable date as stale", () => {
    expect(isFeeRuleStale({ ...rule, asOf: "whenever" }, Date.now())).toBe(true);
  });
});
