import { describe, expect, it } from "vitest";
import {
  getFavoriteColorNames,
  isFavoriteColor,
  sanitizeFavoriteColorNames,
  toggleFavoriteColor,
} from "@/lib/colors";

const PALETTE = [
  { hex: "#111111", name: "black" },
  { hex: "#8a8a8a", name: "gray" },
  { hex: "#4a6fb0", name: "blue" },
];

describe("sanitizeFavoriteColorNames", () => {
  it("normalises, dedupes and keeps order", () => {
    expect(sanitizeFavoriteColorNames([" Blue ", "black", "BLUE"])).toEqual(["blue", "black"]);
  });

  it("drops blanks and non-arrays", () => {
    expect(sanitizeFavoriteColorNames(["", "  ", "blue"])).toEqual(["blue"]);
    expect(sanitizeFavoriteColorNames(undefined)).toEqual([]);
  });
});

describe("isFavoriteColor", () => {
  /**
   * The old check was an exact `includes`, so a favourite saved as "Blue" went
   * unmarked against a palette entry named "blue" — the heart silently lost.
   */
  it("matches regardless of case and spacing", () => {
    expect(isFavoriteColor(["blue"], " Blue ")).toBe(true);
    expect(isFavoriteColor(["blue"], "black")).toBe(false);
    expect(isFavoriteColor([], "blue")).toBe(false);
  });
});

describe("toggleFavoriteColor", () => {
  it("adds at the end and removes in place", () => {
    expect(toggleFavoriteColor(["black"], "blue")).toEqual(["black", "blue"]);
    expect(toggleFavoriteColor(["black", "blue"], "black")).toEqual(["blue"]);
  });

  it("treats a differently-cased name as the same colour", () => {
    expect(toggleFavoriteColor(["blue"], "BLUE")).toEqual([]);
  });

  it("ignores a blank name rather than storing one", () => {
    expect(toggleFavoriteColor(["blue"], "   ")).toEqual(["blue"]);
  });
});

describe("getFavoriteColorNames", () => {
  it("keeps only colours still in the palette", () => {
    // A colour removed from the palette must not come back as a heart on
    // nothing if its name is ever reused.
    expect(
      getFavoriteColorNames({ colorsList: PALETTE, favoriteColors: ["blue", "sage"] }),
    ).toEqual(["blue"]);
  });

  it("falls back to the default palette when none is saved", () => {
    expect(getFavoriteColorNames({ favoriteColors: ["black"] })).toEqual(["black"]);
  });

  it("is empty when nothing is favourited", () => {
    expect(getFavoriteColorNames({ colorsList: PALETTE })).toEqual([]);
  });
});
