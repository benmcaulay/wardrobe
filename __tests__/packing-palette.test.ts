import { describe, it, expect } from "vitest";
import { colorRole, colorVersatility, isNeutralPiece } from "../lib/packing/palette";

const c = (...names: string[]) => names.map((name) => ({ name, hex: "#000000" }));

describe("colorRole", () => {
  it("classifies true neutrals", () => {
    for (const n of ["black", "white", "gray", "grey", "beige", "cream"]) {
      expect(colorRole(n), n).toBe("neutral");
    }
  });

  it("classifies near-neutrals", () => {
    for (const n of ["navy", "blue", "brown", "olive", "cognac"]) {
      expect(colorRole(n), n).toBe("semi");
    }
  });

  it("classifies everything else as an accent", () => {
    for (const n of ["red", "yellow", "orange", "pink", "aqua", "purple"]) {
      expect(colorRole(n), n).toBe("accent");
    }
  });

  it("is case- and whitespace-insensitive", () => {
    expect(colorRole("  BLACK ")).toBe("neutral");
  });
});

describe("colorVersatility", () => {
  it("scores a neutral solid highest", () => {
    expect(colorVersatility(c("black"))).toBe(1);
  });

  it("scores a single bright accent low", () => {
    expect(colorVersatility(c("orange"))).toBeLessThan(0.3);
  });

  it("ranks neutral above semi above accent", () => {
    expect(colorVersatility(c("white"))).toBeGreaterThan(colorVersatility(c("navy")));
    expect(colorVersatility(c("navy"))).toBeGreaterThan(colorVersatility(c("red")));
  });

  it("averages a mixed piece between its colours", () => {
    const mixed = colorVersatility(c("black", "red"));
    expect(mixed).toBeLessThan(colorVersatility(c("black")));
    expect(mixed).toBeGreaterThan(colorVersatility(c("red")));
  });

  it("penalises busy multi-colour pieces", () => {
    // A graphic tee with many colours is genuinely harder to build around; the
    // measured closet contains items with up to 8 colours.
    const two = colorVersatility(c("black", "white"));
    const many = colorVersatility(c("black", "white", "gray", "beige", "cream", "tan"));
    expect(many).toBeLessThan(two);
  });

  it("uses a mid-range prior when there is no colour data", () => {
    // Missing data must not be scored as if it were a neon print, nor rewarded
    // as if it were black.
    const unknown = colorVersatility([]);
    expect(unknown).toBe(0.6);
    expect(colorVersatility(undefined)).toBe(0.6);
    expect(colorVersatility(null)).toBe(0.6);
    expect(unknown).toBeLessThan(colorVersatility(c("black")));
    expect(unknown).toBeGreaterThan(colorVersatility(c("orange")));
  });

  it("ignores blank colour names rather than counting them", () => {
    expect(colorVersatility([{ name: "", hex: "#fff" }] as never)).toBe(0.6);
  });

  it("always returns a value in 0..1", () => {
    for (const item of [c("black"), c("orange"), c("red", "yellow", "green", "pink", "aqua")]) {
      const v = colorVersatility(item);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe("isNeutralPiece", () => {
  it("is true when every colour is neutral or near-neutral", () => {
    expect(isNeutralPiece(c("black", "navy"))).toBe(true);
  });

  it("is false when any colour is an accent", () => {
    expect(isNeutralPiece(c("black", "orange"))).toBe(false);
  });

  it("is false with no colour data", () => {
    expect(isNeutralPiece([])).toBe(false);
  });
});
