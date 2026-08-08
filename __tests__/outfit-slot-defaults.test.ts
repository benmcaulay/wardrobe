import { describe, expect, it } from "vitest";
import {
  builtinCategoryScale,
  builtinSlotLayout,
  clampItemScale,
  combinationKey,
  layerIndexForCategories,
  outfitSlotDefaultKey,
  resolveSlotLayout,
  sanitizeComboLayouts,
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

describe("item scale", () => {
  it("clamps a single scale to the allowed range, defaulting to 1", () => {
    expect(clampItemScale(1.4)).toBe(1.4);
    expect(clampItemScale(9)).toBe(5);
    expect(clampItemScale(0.1)).toBe(0.5);
    expect(clampItemScale("nope")).toBe(1);
  });

  it("defaults jackets and pants to 2x, everything else to 1x", () => {
    expect(builtinCategoryScale(["jacket"])).toBe(2);
    expect(builtinCategoryScale(["pants"])).toBe(2);
    expect(builtinCategoryScale(["shirt"])).toBe(1);
    expect(builtinCategoryScale(["hat"])).toBe(1);
    expect(builtinCategoryScale(["shorts"])).toBe(1);
  });
});

describe("layerIndexForCategories", () => {
  it("finds the layer holding the category, or -1", () => {
    const layers = [["hat"], ["shirt", "jacket"]];
    expect(layerIndexForCategories(["shirt"], layers)).toBe(1);
    expect(layerIndexForCategories(["hat"], layers)).toBe(0);
    expect(layerIndexForCategories(["shoes"], layers)).toBe(-1);
    expect(layerIndexForCategories(["shirt"], [])).toBe(-1);
  });
});

describe("combinationKey", () => {
  it("differs by the set of categories present together", () => {
    const alone = combinationKey(["shirt"], ["shirt"]);
    const withJacket = combinationKey(["shirt"], ["shirt", "jacket"]);
    const allThree = combinationKey(["shirt"], ["shirt", "jacket", "sweater/hoodie"]);
    expect(new Set([alone, withJacket, allThree]).size).toBe(3);
  });

  it("is stable regardless of order or duplicates in the present set", () => {
    expect(combinationKey(["shirt"], ["jacket", "shirt", "jacket"])).toBe(
      combinationKey(["shirt"], ["shirt", "jacket"]),
    );
  });

  it("keys each piece by its own category within the same combination", () => {
    const present = ["shirt", "jacket"];
    expect(combinationKey(["shirt"], present)).not.toBe(combinationKey(["jacket"], present));
  });
});

describe("sanitizeComboLayouts", () => {
  it("keeps present fields, clamps them, and drops empty/malformed entries", () => {
    const out = sanitizeComboLayouts({
      "shirt@shirt": { x: -5, y: 9999, scale: 9 },
      "jacket@jacket,shirt": { scale: 1.5 },
      empty: {},
      bad: 3,
    });
    expect(out).toEqual({
      "shirt@shirt": { x: 0, y: 960, scale: 5 },
      "jacket@jacket,shirt": { scale: 1.5 },
    });
    expect(sanitizeComboLayouts(null)).toEqual({});
  });
});
