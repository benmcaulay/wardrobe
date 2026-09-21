import { describe, it, expect } from "vitest";
import {
  brandKey,
  canonicalBrand,
  dedupeBrands,
  isBrandRespelling,
  normalizeBrandInput,
  sameBrand,
} from "../lib/brand-name";

describe("normalizeBrandInput", () => {
  it("trims and collapses whitespace without touching case", () => {
    expect(normalizeBrandInput("  New   Balance ")).toBe("New Balance");
    expect(normalizeBrandInput("adidas")).toBe("adidas");
  });

  it("treats blank and missing input as empty", () => {
    expect(normalizeBrandInput("   ")).toBe("");
    expect(normalizeBrandInput(null)).toBe("");
    expect(normalizeBrandInput(undefined)).toBe("");
  });
});

describe("brandKey", () => {
  it("collapses spellings that differ only in case", () => {
    expect(brandKey("NIKE")).toBe(brandKey("nike"));
    expect(brandKey(" Arc'teryx")).toBe(brandKey("arc'teryx"));
  });

  it("keeps genuinely different brands apart", () => {
    expect(brandKey("COS")).not.toBe(brandKey("Cos Bar"));
  });
});

describe("sameBrand", () => {
  it("ignores case", () => {
    expect(sameBrand("Nike", "nike")).toBe(true);
  });

  it("never matches a blank brand, so unbranded items don't collapse together", () => {
    expect(sameBrand(null, null)).toBe(false);
    expect(sameBrand("", "")).toBe(false);
    expect(sameBrand(null, "Nike")).toBe(false);
  });
});

describe("canonicalBrand", () => {
  it("adopts the spelling already on file", () => {
    expect(canonicalBrand("NIKE", ["Nike"])).toBe("Nike");
    expect(canonicalBrand("Adidas", ["adidas"])).toBe("adidas");
  });

  it("keeps the first spelling when the closet holds several", () => {
    expect(canonicalBrand("COTOPAXI", ["cotopaxi", "Cotopaxi"])).toBe("cotopaxi");
  });

  it("leaves a brand new to the closet as typed, only tidied", () => {
    expect(canonicalBrand("  Veja ", ["Nike"])).toBe("Veja");
  });

  it("returns empty for blank input rather than inventing a match", () => {
    expect(canonicalBrand("  ", ["Nike"])).toBe("");
    expect(canonicalBrand(null, ["Nike"])).toBe("");
  });

  it("ignores blanks among the known spellings", () => {
    expect(canonicalBrand("nike", [null, "", "Nike"])).toBe("Nike");
  });
});

describe("dedupeBrands", () => {
  it("keeps one spelling per brand, the first seen", () => {
    expect(dedupeBrands(["adidas", "Adidas", "Nike", "nike"])).toEqual(["adidas", "Nike"]);
  });

  it("drops blanks", () => {
    expect(dedupeBrands([null, "", "  ", "Veja"])).toEqual(["Veja"]);
  });
});

describe("isBrandRespelling", () => {
  it("recognises a case-only correction to the brand the item already had", () => {
    expect(isBrandRespelling("new era", "New Era")).toBe(true);
  });

  it("does not treat switching to another brand as a respelling", () => {
    expect(isBrandRespelling("adidas", "Nike")).toBe(false);
    expect(isBrandRespelling("adidas", "NIKE")).toBe(false);
  });

  it("does not fire when nothing changed", () => {
    expect(isBrandRespelling("Nike", "Nike")).toBe(false);
    expect(isBrandRespelling("Nike", " Nike ")).toBe(false);
  });

  it("does not fire on clearing the brand, or on setting one for the first time", () => {
    expect(isBrandRespelling("Nike", "")).toBe(false);
    expect(isBrandRespelling(null, "Nike")).toBe(false);
  });
});
