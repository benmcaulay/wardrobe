import { describe, expect, it } from "vitest";
import { NONE_CATEGORY, resolveReassignTarget } from "@/lib/categories";

const OPTIONS = ["shirt", "t shirt", "hat", "shoes", "sweater/hoodie", "pants"];

describe("resolveReassignTarget", () => {
  it("returns the user's own label, with their casing", () => {
    expect(resolveReassignTarget("shirt", OPTIONS)).toBe("shirt");
    expect(resolveReassignTarget("T Shirt", OPTIONS)).toBe("t shirt");
    expect(resolveReassignTarget("  SWEATER/HOODIE ", OPTIONS)).toBe("sweater/hoodie");
  });

  it("allows the None bucket as a destination", () => {
    expect(resolveReassignTarget("None", OPTIONS)).toBe(NONE_CATEGORY);
    expect(resolveReassignTarget("none", OPTIONS)).toBe(NONE_CATEGORY);
  });

  it("rejects a category the user does not have", () => {
    // Must be a rejection, never a silent default — otherwise a stale picker
    // could dump items somewhere the user never chose.
    expect(resolveReassignTarget("blouse", OPTIONS)).toBeNull();
    expect(resolveReassignTarget("shirts", OPTIONS)).toBeNull();
  });

  it("rejects empty and missing input", () => {
    expect(resolveReassignTarget("", OPTIONS)).toBeNull();
    expect(resolveReassignTarget("   ", OPTIONS)).toBeNull();
    expect(resolveReassignTarget(null, OPTIONS)).toBeNull();
    expect(resolveReassignTarget(undefined, OPTIONS)).toBeNull();
  });

  it("distinguishes 'shirt' from 't shirt' — the whole point of splitting", () => {
    expect(resolveReassignTarget("shirt", OPTIONS)).toBe("shirt");
    expect(resolveReassignTarget("t shirt", OPTIONS)).toBe("t shirt");
    expect(resolveReassignTarget("shirt", OPTIONS)).not.toBe("t shirt");
  });

  it("normalises internal whitespace like the rest of the category code", () => {
    expect(resolveReassignTarget("t   shirt", OPTIONS)).toBe("t shirt");
  });

  it("returns null against an empty option list rather than inventing one", () => {
    expect(resolveReassignTarget("shirt", [])).toBeNull();
    // None is still valid with no categories configured.
    expect(resolveReassignTarget("None", [])).toBe(NONE_CATEGORY);
  });
});
