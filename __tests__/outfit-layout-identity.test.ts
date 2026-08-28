import { describe, expect, it } from "vitest";
import {
  comboKeyCandidates,
  comboKeyForSlot,
  comboLayoutForSlot,
  slotIdentityCategories,
} from "@/lib/outfit/layout-identity";
import { categoryAncestryPath } from "@/lib/category-tree";

/**
 * The closet this exercises: shirt > t shirt, outerwear > jacket, and a
 * "bottom > pants > jeans" chain two levels deep.
 */
const LIST = [
  "shirt",
  "t shirt",
  "outerwear",
  "jacket",
  "sweater",
  "bottom",
  "pants",
  "jeans",
  "shoes",
];
const PARENTS = {
  "t shirt": "shirt",
  jacket: "outerwear",
  sweater: "outerwear",
  pants: "bottom",
  jeans: "pants",
};
const ancestryOf = (category: string) => categoryAncestryPath(category, PARENTS, LIST);

/** Item ids are their category here, which keeps the fixtures readable. */
const itemCategoryOf = (itemId: string) => itemId;

const NO_LAYERS: string[][] = [];

describe("slotIdentityCategories", () => {
  it("is the piece's own category when the slot holds one", () => {
    expect(
      slotIdentityCategories({ categories: ["outerwear"], itemId: "jacket" }, itemCategoryOf),
    ).toEqual(["jacket"]);
  });

  it("falls back to the rule's categories for an empty slot", () => {
    expect(slotIdentityCategories({ categories: ["outerwear"] }, itemCategoryOf)).toEqual([
      "outerwear",
    ]);
  });

  it("ignores an uncategorised piece rather than keying on None", () => {
    expect(
      slotIdentityCategories({ categories: ["outerwear"], itemId: "None" }, itemCategoryOf),
    ).toEqual(["outerwear"]);
  });
});

describe("comboKeyCandidates", () => {
  const slot = { id: "s1", categories: ["outerwear"], itemId: "jacket" };

  it("runs from the piece's own category up to the root", () => {
    expect(comboKeyCandidates(slot, [slot], NO_LAYERS, itemCategoryOf, ancestryOf)).toEqual([
      "jacket@jacket",
      "outerwear@outerwear",
    ]);
  });

  it("walks every level of a deeper chain", () => {
    const jeans = { id: "s1", categories: ["bottom"], itemId: "jeans" };
    expect(comboKeyCandidates(jeans, [jeans], NO_LAYERS, itemCategoryOf, ancestryOf)).toEqual([
      "jeans@jeans",
      "pants@pants",
      "bottom@bottom",
    ]);
  });

  it("is a single key for a category with no parent", () => {
    const shoes = { id: "s1", categories: ["shoes"], itemId: "shoes" };
    expect(comboKeyCandidates(shoes, [shoes], NO_LAYERS, itemCategoryOf, ancestryOf)).toEqual([
      "shoes@shoes",
    ]);
  });

  /**
   * With visual layers set up, the key records what shares the band — and each
   * ancestor level substitutes itself for the slot's own entry, so the
   * ancestor's key is the same combination expressed one level up.
   */
  it("includes band-mates, with the level substituted at each step", () => {
    const layers = [["outerwear", "shirt"]];
    const jacket = { id: "s1", categories: ["outerwear"], itemId: "jacket" };
    const tee = { id: "s2", categories: ["shirt"], itemId: "t shirt" };
    expect(
      comboKeyCandidates(jacket, [jacket, tee], layers, itemCategoryOf, ancestryOf),
    ).toEqual(["jacket@jacket,t shirt", "outerwear@outerwear,t shirt"]);
  });
});

describe("comboKeyForSlot", () => {
  it("writes to the most specific key — the piece's own category", () => {
    const slot = { id: "s1", categories: ["outerwear"], itemId: "jacket" };
    expect(comboKeyForSlot(slot, [slot], NO_LAYERS, itemCategoryOf, ancestryOf)).toBe(
      "jacket@jacket",
    );
  });

  it("writes to the rule's category while the slot is empty", () => {
    const slot = { id: "s1", categories: ["outerwear"] };
    expect(comboKeyForSlot(slot, [slot], NO_LAYERS, itemCategoryOf, ancestryOf)).toBe(
      "outerwear@outerwear",
    );
  });
});

describe("comboLayoutForSlot", () => {
  const jacketSlot = { id: "s1", categories: ["outerwear"], itemId: "jacket" };

  it("prefers the piece's own saved layout", () => {
    const layouts = { "jacket@jacket": { scale: 2.8 }, "outerwear@outerwear": { scale: 2.2 } };
    expect(
      comboLayoutForSlot(jacketSlot, [jacketSlot], NO_LAYERS, itemCategoryOf, ancestryOf, layouts),
    ).toEqual({ scale: 2.8 });
  });

  /** The reason inheritance exists: nesting must not discard existing tuning. */
  it("inherits the parent's layout when the piece has none of its own", () => {
    const layouts = { "outerwear@outerwear": { scale: 2.2, x: 280, y: 300 } };
    expect(
      comboLayoutForSlot(jacketSlot, [jacketSlot], NO_LAYERS, itemCategoryOf, ancestryOf, layouts),
    ).toEqual({ scale: 2.2, x: 280, y: 300 });
  });

  it("reaches past a middle level that has nothing saved", () => {
    const jeans = { id: "s1", categories: ["bottom"], itemId: "jeans" };
    const layouts = { "bottom@bottom": { scale: 1.9 } };
    expect(
      comboLayoutForSlot(jeans, [jeans], NO_LAYERS, itemCategoryOf, ancestryOf, layouts),
    ).toEqual({ scale: 1.9 });
  });

  it("does not leak sideways between siblings", () => {
    // A jacket sized by hand must not resize sweaters, which is the whole ask.
    const sweaterSlot = { id: "s1", categories: ["outerwear"], itemId: "sweater" };
    const layouts = { "jacket@jacket": { scale: 2.8 }, "outerwear@outerwear": { scale: 2.2 } };
    expect(
      comboLayoutForSlot(sweaterSlot, [sweaterSlot], NO_LAYERS, itemCategoryOf, ancestryOf, layouts),
    ).toEqual({ scale: 2.2 });
  });

  it("is undefined when nothing up the chain is saved", () => {
    expect(
      comboLayoutForSlot(jacketSlot, [jacketSlot], NO_LAYERS, itemCategoryOf, ancestryOf, {}),
    ).toBeUndefined();
  });
});
