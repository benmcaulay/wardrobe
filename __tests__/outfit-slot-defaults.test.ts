import { describe, expect, it } from "vitest";
import {
  builtinCategoryScale,
  builtinSlotLayout,
  clampItemScale,
  outfitSlotDefaultKey,
  resolveSlotLayout,
  sanitizeCategoryScales,
  sanitizeOutfitSlotDefaults,
} from "../lib/outfit-slot-defaults";

describe("outfitSlotDefaultKey", () => {
  it("matches categoryListSignature for OR rules", () => {
    expect(outfitSlotDefaultKey(["Hat", "Cap"])).toBe(outfitSlotDefaultKey(["Cap", "Hat"]));
  });
});

describe("resolveSlotLayout", () => {
  it("uses saved defaults with index offset", () => {
    const key = outfitSlotDefaultKey(["shirt"]);
    const defaults = { [key]: { x: 100, y: 200, scale: 1.2 } };
    expect(resolveSlotLayout(["shirt"], 0, defaults)).toEqual({ x: 100, y: 200, scale: 1.2 });
    expect(resolveSlotLayout(["shirt"], 1, defaults)).toEqual({ x: 136, y: 200, scale: 1.2 });
  });

  it("falls back to built-in shirt placement", () => {
    const layout = builtinSlotLayout(["shirt"], 0);
    expect(layout.y).toBeCloseTo(960 * 0.28);
    expect(layout.scale).toBe(1);
  });
});

describe("sanitizeOutfitSlotDefaults", () => {
  it("clamps invalid values", () => {
    const out = sanitizeOutfitSlotDefaults({
      shirt: { x: -10, y: 9999, scale: 9 },
    });
    expect(out.shirt).toEqual({ x: 0, y: 960, scale: 2.2 });
  });
});

describe("category scales", () => {
  it("clamps a single scale to the allowed range, defaulting to 1", () => {
    expect(clampItemScale(1.4)).toBe(1.4);
    expect(clampItemScale(9)).toBe(5);
    expect(clampItemScale(0.1)).toBe(0.5);
    expect(clampItemScale("nope")).toBe(1);
  });

  it("keeps only finite numeric entries, each clamped", () => {
    expect(sanitizeCategoryScales({ shirt: 1.4, hat: 9, bad: "x", "": 1.2 })).toEqual({
      shirt: 1.4,
      hat: 5,
    });
    expect(sanitizeCategoryScales(null)).toEqual({});
  });

  it("defaults jackets and pants to 2x, everything else to 1x", () => {
    expect(builtinCategoryScale(["jacket"])).toBe(2);
    expect(builtinCategoryScale(["pants"])).toBe(2);
    expect(builtinCategoryScale(["shirt"])).toBe(1);
    expect(builtinCategoryScale(["hat"])).toBe(1);
    expect(builtinCategoryScale(["shorts"])).toBe(1);
  });
});
