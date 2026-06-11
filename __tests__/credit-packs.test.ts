import { describe, it, expect } from "vitest";
import { CREDIT_PACKS, getCreditPack, formatPackPrice } from "../lib/credit-packs";

describe("credit packs", () => {
  it("defines three tiers with positive integer credits and prices", () => {
    expect(CREDIT_PACKS.length).toBe(3);
    for (const p of CREDIT_PACKS) {
      expect(Number.isInteger(p.credits) && p.credits > 0).toBe(true);
      expect(Number.isInteger(p.amountCents) && p.amountCents > 0).toBe(true);
    }
  });

  it("looks up packs by id and rejects unknown ids", () => {
    expect(getCreditPack("starter")?.credits).toBe(100);
    expect(getCreditPack("standard")?.amountCents).toBe(1200);
    expect(getCreditPack("studio")?.credits).toBe(1000);
    expect(getCreditPack("nope")).toBeUndefined();
  });

  it("keeps per-credit price above the ~3-4 cent provider cost floor", () => {
    for (const p of CREDIT_PACKS) {
      expect(p.amountCents / p.credits).toBeGreaterThanOrEqual(3.5);
    }
  });

  it("formats whole-dollar prices without cents", () => {
    expect(formatPackPrice(CREDIT_PACKS[0]!)).toBe("$5");
    expect(formatPackPrice(CREDIT_PACKS[2]!)).toBe("$35");
  });
});
