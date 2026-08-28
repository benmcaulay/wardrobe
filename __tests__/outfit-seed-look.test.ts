import { describe, expect, it } from "vitest";
import { assignSeedPieces, seedRulesForPieces } from "@/lib/outfit/seed-look";

/**
 * A trip look handed to the Outfits page. The pieces have to arrive on the
 * Smart Generator's canvas as *slots*, because every saved position, size and
 * layer the user has is keyed off slots — placing them directly is what made
 * the handoff land as four same-sized garments in a heap.
 */

const LOOK = [
  { id: "tee", category: "top" },
  { id: "parka", category: "outerwear" },
  { id: "jeans", category: "bottom" },
  { id: "sneakers", category: "shoes" },
];

describe("seedRulesForPieces", () => {
  it("makes one single-category rule per category, in the look's order", () => {
    expect(seedRulesForPieces(LOOK)).toEqual([
      { categories: ["top"], count: 1 },
      { categories: ["outerwear"], count: 1 },
      { categories: ["bottom"], count: 1 },
      { categories: ["shoes"], count: 1 },
    ]);
  });

  it("counts a repeated category instead of collapsing it", () => {
    // Two pairs of jeans is two slots. Collapsing them would drop a garment
    // from the look with no error anywhere.
    expect(
      seedRulesForPieces([
        { id: "a", category: "bottom" },
        { id: "b", category: "bottom" },
        { id: "c", category: "top" },
      ]),
    ).toEqual([
      { categories: ["bottom"], count: 2 },
      { categories: ["top"], count: 1 },
    ]);
  });

  it("treats differently-cased categories as one", () => {
    expect(
      seedRulesForPieces([
        { id: "a", category: "Shoes" },
        { id: "b", category: "shoes" },
      ]),
    ).toEqual([{ categories: ["Shoes"], count: 2 }]);
  });

  it("drops pieces with no usable category", () => {
    expect(
      seedRulesForPieces([
        { id: "a", category: "" },
        { id: "b", category: "  " },
        { id: "c", category: "top" },
      ]),
    ).toEqual([{ categories: ["top"], count: 1 }]);
  });

  it("returns nothing for an empty look", () => {
    expect(seedRulesForPieces([])).toEqual([]);
  });
});

describe("assignSeedPieces", () => {
  const slots = [
    { id: "s1", categories: ["top"] },
    { id: "s2", categories: ["outerwear"] },
    { id: "s3", categories: ["bottom"] },
    { id: "s4", categories: ["shoes"] },
  ];

  it("puts each garment in a slot that accepts its category", () => {
    expect(Object.fromEntries(assignSeedPieces(slots, LOOK))).toEqual({
      s1: "tee",
      s2: "parka",
      s3: "jeans",
      s4: "sneakers",
    });
  });

  it("does not reuse one garment across two slots of the same category", () => {
    // The bug this guards: matching per slot without consuming the piece gives
    // the first pair of jeans to both slots and loses the second entirely.
    const twoBottoms = [
      { id: "s1", categories: ["bottom"] },
      { id: "s2", categories: ["bottom"] },
    ];
    const assigned = assignSeedPieces(twoBottoms, [
      { id: "jeansA", category: "bottom" },
      { id: "jeansB", category: "bottom" },
    ]);
    expect(Object.fromEntries(assigned)).toEqual({ s1: "jeansA", s2: "jeansB" });
  });

  it("leaves an already-filled slot alone", () => {
    const assigned = assignSeedPieces(
      [{ id: "s1", categories: ["top"], itemId: "kept" }, { id: "s2", categories: ["top"] }],
      [{ id: "tee", category: "top" }],
    );
    expect(Object.fromEntries(assigned)).toEqual({ s2: "tee" });
  });

  it("skips a garment with no slot rather than forcing it somewhere", () => {
    const assigned = assignSeedPieces([{ id: "s1", categories: ["top"] }], [
      { id: "hat", category: "headwear" },
      { id: "tee", category: "top" },
    ]);
    expect(Object.fromEntries(assigned)).toEqual({ s1: "tee" });
  });

  it("matches regardless of category casing", () => {
    const assigned = assignSeedPieces([{ id: "s1", categories: ["Shoes"] }], [
      { id: "sneakers", category: "shoes" },
    ]);
    expect(Object.fromEntries(assigned)).toEqual({ s1: "sneakers" });
  });
});
