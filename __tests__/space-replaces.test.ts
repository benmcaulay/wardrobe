import { describe, expect, it } from "vitest";
import {
  countInCategory,
  REPLACE_CANDIDATE_LIMIT,
  replaceCandidates,
  type OwnedPiece,
} from "@/lib/space/replaces";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 15, 12);

function piece(id: string, category: string, daysAgo: number | null): OwnedPiece {
  return {
    id,
    name: id,
    imagePath: `${id}.jpg`,
    category,
    lastWornAtMs: daysAgo == null ? null : NOW - daysAgo * DAY,
  };
}

const closet: OwnedPiece[] = [
  piece("tee-fresh", "T Shirt", 2),
  piece("tee-old", "t shirt", 400),
  piece("tee-never", "T SHIRT", null),
  piece("jeans", "Jeans", 30),
];

describe("replaceCandidates", () => {
  it("matches the filed category regardless of case or spacing", () => {
    const ids = replaceCandidates(closet, "  t   shirt  ").map((c) => c.id);
    expect(ids.sort()).toEqual(["tee-fresh", "tee-never", "tee-old"]);
  });

  it("puts never-worn first, then longest unworn", () => {
    expect(replaceCandidates(closet, "t shirt").map((c) => c.id)).toEqual([
      "tee-never",
      "tee-old",
      "tee-fresh",
    ]);
  });

  it("does not reach across categories, even related ones", () => {
    // A jacket and a hoodie are both outerwear to classifyGarmentKind. The user
    // asked for a jacket; answering with a hoodie answers a different question.
    const outer = [piece("jacket", "Jacket", 10), piece("hoodie", "Hoodie", 10)];
    expect(replaceCandidates(outer, "Jacket").map((c) => c.id)).toEqual(["jacket"]);
  });

  it("returns nothing for a blank category rather than the whole closet", () => {
    expect(replaceCandidates(closet, "")).toEqual([]);
    expect(replaceCandidates(closet, "   ")).toEqual([]);
  });

  it("returns nothing when the category is empty in the closet", () => {
    expect(replaceCandidates(closet, "Coat")).toEqual([]);
  });

  it("caps the list", () => {
    const many = Array.from({ length: 20 }, (_, i) => piece(`t${i}`, "Tee", i + 1));
    expect(replaceCandidates(many, "Tee")).toHaveLength(REPLACE_CANDIDATE_LIMIT);
    expect(replaceCandidates(many, "Tee", 2)).toHaveLength(2);
    expect(replaceCandidates(many, "Tee", 0)).toEqual([]);
  });

  it("is stable for identical wear dates", () => {
    const tied = [piece("b", "Tee", 5), piece("a", "Tee", 5), piece("c", "Tee", null)];
    expect(replaceCandidates(tied, "Tee").map((c) => c.id)).toEqual(["c", "a", "b"]);
  });

  it("hands back only the fields the panel renders", () => {
    const [first] = replaceCandidates(closet, "t shirt");
    expect(Object.keys(first).sort()).toEqual(["id", "imagePath", "lastWornAtMs", "name"]);
  });

  it("does not mutate the input order", () => {
    const input = [...closet];
    replaceCandidates(input, "t shirt");
    expect(input.map((p) => p.id)).toEqual(closet.map((p) => p.id));
  });
});

describe("countInCategory", () => {
  it("counts everything filed there, not just what fits the cap", () => {
    const many = Array.from({ length: 20 }, (_, i) => piece(`t${i}`, "Tee", i));
    expect(countInCategory(many, "tee")).toBe(20);
  });

  it("counts zero for a blank or absent category", () => {
    expect(countInCategory(closet, "")).toBe(0);
    expect(countInCategory(closet, "Coat")).toBe(0);
  });
});
