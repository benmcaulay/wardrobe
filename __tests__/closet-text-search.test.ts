import { describe, it, expect } from "vitest";
import { closetTextSearchWhere } from "../lib/closet-text-search";

describe("closetTextSearchWhere", () => {
  it("returns null for empty query", () => {
    expect(closetTextSearchWhere("")).toBeNull();
    expect(closetTextSearchWhere("   ")).toBeNull();
  });

  it("searches category, season, and colors", () => {
    const where = closetTextSearchWhere("spring");
    expect(where?.OR).toEqual(
      expect.arrayContaining([
        { category: { contains: "spring", mode: "insensitive" } },
        { season: { contains: "spring", mode: "insensitive" } },
        { colors: { contains: "spring", mode: "insensitive" } },
      ]),
    );
  });

  it("still searches name, brand, and tags", () => {
    const where = closetTextSearchWhere("nike");
    expect(where?.OR).toEqual(
      expect.arrayContaining([
        { name: { contains: "nike", mode: "insensitive" } },
        { brand: { contains: "nike", mode: "insensitive" } },
        { styleTags: { contains: "nike", mode: "insensitive" } },
      ]),
    );
  });
});
