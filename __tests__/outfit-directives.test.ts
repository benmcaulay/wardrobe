import { describe, it, expect } from "vitest";
import {
  DIRECTIVE_BOOST,
  clampFormality,
  describeDirective,
  directiveBonus,
  itemSatisfies,
  parseDirectiveKeywords,
  unmetDirectives,
  type SessionDirective,
} from "../lib/outfit/directives";
import { PREFER_BOOST } from "../lib/outfit/style-rules";

const VOCAB = {
  categories: ["hat", "shirt", "t shirt", "long sleeve shirt", "jeans", "shoes", "jacket"],
  colors: ["red", "black", "white", "navy"],
};

const item = (over: Record<string, unknown> = {}) => ({
  id: "i1",
  category: "hat",
  colors: [{ hex: "#f00", name: "red" }],
  ...over,
}) as any;

const redHat: SessionDirective = { kind: "include", id: "d", text: "red hat", category: "hat", terms: ["red"] };

describe("parseDirectiveKeywords", () => {
  it("reads a colour and a category out of plain English", () => {
    expect(parseDirectiveKeywords("I want a red hat", VOCAB)).toMatchObject({
      kind: "include", category: "hat", terms: ["red"],
    });
  });

  it("prefers the longest matching category", () => {
    // "long sleeve shirt" contains "shirt"; the specific label must win.
    expect(parseDirectiveKeywords("a navy long sleeve shirt", VOCAB)).toMatchObject({
      category: "long sleeve shirt",
    });
  });

  it("matches a plural category", () => {
    expect(parseDirectiveKeywords("wear jeans", VOCAB)).toMatchObject({ category: "jeans" });
  });

  it("maps formality words onto the ladder", () => {
    expect(parseDirectiveKeywords("keep it formal", VOCAB)).toMatchObject({ kind: "formality", target: 9 });
    expect(parseDirectiveKeywords("something casual", VOCAB)).toMatchObject({ kind: "formality", target: 3 });
    expect(parseDirectiveKeywords("gym", VOCAB)).toMatchObject({ kind: "formality", target: 1 });
  });

  it("returns null when nothing is recognisable, rather than guessing", () => {
    // The signal to ask the model. A wrong guess reshapes every outfit
    // silently, so silence is the safer failure.
    expect(parseDirectiveKeywords("something a bit more me", VOCAB)).toBeNull();
    expect(parseDirectiveKeywords("   ", VOCAB)).toBeNull();
  });

  it("accepts a colour with no category", () => {
    expect(parseDirectiveKeywords("more black", VOCAB)).toMatchObject({ terms: ["black"], category: undefined });
  });
});

describe("itemSatisfies", () => {
  it("matches on category and colour together", () => {
    expect(itemSatisfies(item(), redHat)).toBe(true);
  });

  it("rejects the right colour in the wrong category", () => {
    expect(itemSatisfies(item({ category: "shirt" }), redHat)).toBe(false);
  });

  it("rejects the right category in the wrong colour", () => {
    expect(itemSatisfies(item({ colors: [{ hex: "#000", name: "black" }] }), redHat)).toBe(false);
  });

  it("matches a subcategory, so 'shirt' covers 't shirt'", () => {
    const d: SessionDirective = { kind: "include", id: "d", text: "shirt", category: "shirt", terms: [] };
    expect(itemSatisfies(item({ category: "t shirt", subcategory: "shirt" }), d)).toBe(true);
  });

  it("falls back to material, pattern and name for a bare term", () => {
    const linen: SessionDirective = { kind: "include", id: "d", text: "linen", terms: ["linen"] };
    expect(itemSatisfies(item({ material: "linen", colors: [] }), linen)).toBe(true);
    const striped: SessionDirective = { kind: "include", id: "d", text: "striped", terms: ["striped"] };
    expect(itemSatisfies(item({ pattern: "striped", colors: [] }), striped)).toBe(true);
  });
});

describe("directiveBonus", () => {
  it("outranks a standing preference decisively", () => {
    expect(directiveBonus([], item(), [redHat])).toBeGreaterThan(PREFER_BOOST * 4);
    expect(directiveBonus([], item(), [redHat])).toBe(DIRECTIVE_BOOST);
  });

  it("pays out once, so one directive cannot crowd out the outfit", () => {
    const placed = [item({ id: "already" })];
    expect(directiveBonus(placed, item({ id: "second" }), [redHat])).toBe(0);
  });

  it("gives nothing to a garment that does not match", () => {
    expect(directiveBonus([], item({ category: "shoes", colors: [] }), [redHat])).toBe(0);
  });

  it("penalises formality distance rather than excluding", () => {
    const formal: SessionDirective = { kind: "formality", id: "d", text: "formal", target: 9 };
    const casual = directiveBonus([], item({ category: "shorts", name: "gym shorts" }), [formal]);
    const dressy = directiveBonus([], item({ category: "dress shirt", name: "oxford" }), [formal]);
    expect(dressy).toBeGreaterThan(casual);
    // Soft: even a bad match is a finite penalty, never a rejection.
    expect(Number.isFinite(casual)).toBe(true);
  });
});

describe("unmetDirectives", () => {
  it("reports an include nothing satisfied", () => {
    const got = unmetDirectives([item({ category: "shoes", colors: [] })], [redHat]);
    expect(got).toHaveLength(1);
  });

  it("stays quiet when the outfit honours it", () => {
    expect(unmetDirectives([item()], [redHat])).toHaveLength(0);
  });

  it("judges formality on the whole look, not one garment", () => {
    // A formal outfit is allowed a casual belt.
    const formal: SessionDirective = { kind: "formality", id: "d", text: "formal", target: 9 };
    const dressy = [
      item({ category: "dress shirt", name: "oxford shirt" }),
      item({ category: "shoes", name: "leather dress shoes" }),
    ];
    expect(unmetDirectives(dressy, [formal]).length).toBeLessThanOrEqual(1);
    expect(unmetDirectives([], [formal])).toHaveLength(1);
  });
});

describe("clampFormality", () => {
  it("holds the ladder's bounds and survives nonsense", () => {
    expect(clampFormality(99)).toBe(10);
    expect(clampFormality(-4)).toBe(0);
    expect(clampFormality(Number.NaN)).toBe(5);
  });
});

describe("describeDirective", () => {
  it("restates the effect in words", () => {
    expect(describeDirective(redHat)).toBe("Including red hat");
    expect(describeDirective({ kind: "formality", id: "d", text: "x", target: 9 })).toBe("Dressing formally");
  });
});

describe("category nesting", () => {
  it("accepts a t shirt for a directive asking for a shirt", () => {
    // The slot rules already widen an item to its ancestors; the matcher has
    // to agree, or "a red shirt" silently excludes every t shirt.
    const d: SessionDirective = { kind: "include", id: "d", text: "red shirt", category: "shirt", terms: ["red"] };
    const tee = item({ category: "t shirt", categoryPath: ["t shirt", "shirt", "top"] });
    expect(itemSatisfies(tee, d)).toBe(true);
  });

  it("still rejects an unrelated category with the right colour", () => {
    const d: SessionDirective = { kind: "include", id: "d", text: "red shirt", category: "shirt", terms: ["red"] };
    const shoes = item({ category: "shoes", categoryPath: ["shoes", "footwear"] });
    expect(itemSatisfies(shoes, d)).toBe(false);
  });
});
