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
import { categoryAncestryPath } from "../lib/category-tree";

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

describe("builtinCategoryScale inheritance", () => {
  // The real closet that surfaced this: jeans nested under pants, jacket under
  // outerwear. Substring matching alone gave the parent 2 and the child 1.
  const parents = {
    jacket: "outerwear",
    "t shirt": "shirt",
    sweater: "outerwear",
    hoodie: "outerwear",
    pants: "bottom",
    jeans: "pants",
    shorts: "bottom",
  };
  const list = [
    "hat",
    "shirt",
    "t shirt",
    "outerwear",
    "jacket",
    "sweater",
    "hoodie",
    "bottom",
    "pants",
    "jeans",
    "shorts",
    "shoes",
  ];
  const ancestryOf = (c: string) => categoryAncestryPath(c, parents, list);

  it("gives a nested category its parent's built-in size", () => {
    // The bug: "jeans" does not contain "pant", so it rendered half-size while
    // "pants" rendered at 2 — in the carousel and the builder both.
    expect(builtinCategoryScale(["jeans"])).toBe(1);
    expect(builtinCategoryScale(["jeans"], ancestryOf)).toBe(2);
    expect(builtinCategoryScale(["pants"], ancestryOf)).toBe(2);
  });

  it("does not inflate small garments that share a parent", () => {
    // shorts sit under "bottom", which has no rule — they must stay small.
    expect(builtinCategoryScale(["shorts"], ancestryOf)).toBe(1);
    expect(builtinCategoryScale(["bottom"], ancestryOf)).toBe(1);
  });

  it("leaves unrelated categories alone", () => {
    for (const c of ["t shirt", "shirt", "shoes", "hat", "hoodie", "sweater"]) {
      expect(builtinCategoryScale([c], ancestryOf)).toBe(1);
    }
  });

  it("keeps a direct match working with and without ancestry", () => {
    expect(builtinCategoryScale(["jacket"])).toBe(2);
    expect(builtinCategoryScale(["jacket"], ancestryOf)).toBe(2);
  });

  it("prefers the label's own rule over an ancestor's", () => {
    // A small garment nested under a large one must not inherit upward.
    const nested = (c: string) => (c === "belt" ? ["belt", "pants"] : [c]);
    expect(builtinCategoryScale(["belt"], nested)).toBe(2); // inherits, no own rule
    const ownRule = (c: string) => (c === "jacket" ? ["jacket", "shirt"] : [c]);
    expect(builtinCategoryScale(["jacket"], ownRule)).toBe(2);
  });

  it("falls back cleanly on empty input or an empty chain", () => {
    expect(builtinCategoryScale([])).toBe(1);
    expect(builtinCategoryScale([""], ancestryOf)).toBe(1);
    expect(builtinCategoryScale(["jeans"], () => [])).toBe(1);
  });
});
