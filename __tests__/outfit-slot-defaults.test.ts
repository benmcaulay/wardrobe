import { describe, expect, it } from "vitest";
import {
  builtinSlotLayout,
  outfitSlotDefaultKey,
  resolveSlotLayout,
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
