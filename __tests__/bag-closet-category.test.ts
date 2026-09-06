import { describe, it, expect } from "vitest";
import { getCategoriesListFromPrefs, suggestCategoryFromItem } from "../lib/categories";

/**
 * A bag added in the packing tool also lands in the closet, and it has to pick
 * a category from whatever vocabulary that closet actually uses. This is the
 * same trap camera-roll import hit: the built-in names are only a suggestion.
 */
describe("filing a bag into the closet's own vocabulary", () => {
  const asBag = (name: string, options: readonly string[]) =>
    suggestCategoryFromItem({ category: "bag", name }, options);

  it("finds the accessory label whatever the closet calls it", () => {
    expect(asBag("Weekender duffel", ["top", "bottom", "accessory"])).toBe("accessory");
    expect(asBag("Weekender duffel", ["shirt", "jeans", "accessories"])).toBe("accessories");
    expect(asBag("Weekender duffel", ["tops", "bags", "shoes"])).toBe("bags");
  });

  it("does not file a bag under clothing when no accessory label exists", () => {
    // Better to fall back to the built-in "accessory" than to call a duffel a
    // shirt, so the caller's ?? branch is the one that must run here.
    expect(asBag("Weekender duffel", ["shirt", "jeans"])).toBeNull();
  });

  it("reads the list out of the user's stored preferences", () => {
    const prefs = { categoriesList: ["shirt", "backpack"] } as never;
    const list = getCategoriesListFromPrefs(prefs);
    expect(asBag("Osprey 40L", list)).toBe("backpack");
  });
});
