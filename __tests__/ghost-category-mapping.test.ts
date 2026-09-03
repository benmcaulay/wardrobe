import { describe, expect, it } from "vitest";
import {
  mapCategoryToGhost,
  mapItemToGhost,
  requireGhostCategory,
} from "@/lib/services/ghost-mannequin-shared";

/**
 * The category values actually present in the dev closet, with counts, taken
 * from a `group by category` at the time this regression was found. The old
 * mapping only knew the canonical DEFAULT_CATEGORIES names, so 157 of 189 items
 * (83%) fell through to "full" and were generated with the generic
 * "identify the type yourself" prompt instead of a type-specific one.
 */
const REAL_CLOSET: Array<[category: string, count: number, expected: string]> = [
  ["shirt", 50, "upperbody"],
  ["hat", 42, "headwear"],
  ["shoes", 28, "footwear"],
  ["sweater/hoodie", 28, "upperbody"],
  ["shorts", 14, "lowerbody"],
  ["pants", 11, "lowerbody"],
  ["jacket", 9, "upperbody"],
  ["accessory", 4, "accessory"],
];

describe("mapCategoryToGhost with real closet vocabulary", () => {
  for (const [category, count, expected] of REAL_CLOSET) {
    it(`maps "${category}" (${count} items) to ${expected}`, () => {
      expect(mapCategoryToGhost(category)).toBe(expected);
    });
  }

  it("routes the overwhelming majority of the closet to a typed prompt", () => {
    const total = REAL_CLOSET.reduce((n, [, c]) => n + c, 0);
    const typed = REAL_CLOSET.filter(([cat]) => mapCategoryToGhost(cat) !== "full").reduce(
      (n, [, c]) => n + c,
      0,
    );
    // Was 32/186 before this fix.
    expect(typed).toBe(total);
  });

  it("still honours the canonical names", () => {
    expect(mapCategoryToGhost("top")).toBe("upperbody");
    expect(mapCategoryToGhost("outerwear")).toBe("upperbody");
    expect(mapCategoryToGhost("bottom")).toBe("lowerbody");
    expect(mapCategoryToGhost("shoes")).toBe("footwear");
    expect(mapCategoryToGhost("dress")).toBe("dress");
  });

  it("keeps 'full' for genuinely unidentifiable categories", () => {
    expect(mapCategoryToGhost("None")).toBe("full");
    expect(mapCategoryToGhost("")).toBe("full");
    expect(mapCategoryToGhost("misc-thing")).toBe("full");
  });

  it("never sends a hat down the top prompt", () => {
    // "accessory" previously mapped to upperbody, which tells a hat that its
    // shoulders should be level and its sleeves should hang straight down.
    expect(mapCategoryToGhost("hat")).not.toBe("upperbody");
    expect(mapCategoryToGhost("accessory")).not.toBe("upperbody");
  });

  it("gives hats their own prompt rather than the generic accessory one", () => {
    // Sharing "a clean retail catalog pose" with belts and bags left the angle
    // to the model, so a row of imported hats faced a row of directions.
    expect(mapCategoryToGhost("hat")).toBe("headwear");
    expect(mapCategoryToGhost("beanie")).toBe("headwear");
    // Everything else in the accessory bucket is unaffected.
    expect(mapCategoryToGhost("accessory")).toBe("accessory");
    expect(mapCategoryToGhost("belt")).toBe("accessory");
  });

  it("respects specificity: a dress shirt is a top, sweatpants are a bottom", () => {
    expect(mapCategoryToGhost("dress shirt")).toBe("upperbody");
    expect(mapCategoryToGhost("sweatpants")).toBe("lowerbody");
  });
});

describe("mapItemToGhost", () => {
  it("rescues an item whose category is None using its name", () => {
    expect(
      mapItemToGhost({ category: "None", subcategory: null, name: "Chargers AFC Champs Tee" }),
    ).toBe("upperbody");
    expect(mapItemToGhost({ category: "None", name: "Wool Overcoat" })).toBe("upperbody");
  });

  it("does NOT recognise a bare trailing 'T' as a tee", () => {
    // This closet names 29 tees "… T" (Adidas Osaka T, NB Cream T). All 29 are
    // categorised "shirt", so the category already resolves them and the shared
    // classifier is left alone — widening its top rule to a bare \bt\b would
    // change behaviour for packing, outfits and SmartPakker for no real gain.
    // The consequence: a "… T" item with NO category still falls back to the
    // generic prompt. Setting the category is the fix for those.
    expect(
      mapItemToGhost({ category: "None", subcategory: null, name: "Chargers AFC Champs T" }),
    ).toBe("full");
    expect(mapItemToGhost({ category: "shirt", name: "Chargers AFC Champs T" })).toBe("upperbody");
  });

  it("falls back to subcategory when the name is uninformative", () => {
    expect(mapItemToGhost({ category: "None", subcategory: "jeans", name: "Blue" })).toBe(
      "lowerbody",
    );
  });

  it("prefers an explicit category over a misleading name", () => {
    // A "Beach Shirt Dress" filed under dress must not be read as a shirt.
    expect(mapItemToGhost({ category: "dress", name: "Beach Shirt Dress" })).toBe("dress");
  });

  it("returns full only when nothing anywhere identifies the item", () => {
    expect(mapItemToGhost({ category: "None", subcategory: null, name: "Thing" })).toBe("full");
  });
});

describe("requireGhostCategory", () => {
  it("allows every real closet category through", () => {
    for (const [category] of REAL_CLOSET) {
      const check = requireGhostCategory({ category });
      expect(check.ok, `${category} should be generatable`).toBe(true);
    }
  });

  it("blocks an item with no category and says what to do", () => {
    for (const category of ["None", "", null, undefined]) {
      const check = requireGhostCategory({ category });
      expect(check.ok).toBe(false);
      if (!check.ok) expect(check.error).toMatch(/Set a category before generating/i);
    }
  });

  it("blocks an unrecognised category with a different, specific message", () => {
    // The fixes differ: one is "pick a category", the other "pick a clearer one".
    const check = requireGhostCategory({ category: "misc-thing" });
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.error).toMatch(/"misc-thing" isn't recognised/i);
      // Points at the two real fixes: rename it, or assign a shape in Settings.
      expect(check.error).toMatch(/rename/i);
      expect(check.error).toMatch(/Settings/);
    }
  });

  it("returns the resolved shape so callers don't re-map", () => {
    const check = requireGhostCategory({ category: "sweater/hoodie" });
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.category).toBe("upperbody");
  });

  it("never returns 'full' as an allowed shape", () => {
    // The whole point of the gate: "full" is the generic guess-the-type prompt.
    for (const category of ["shirt", "hat", "shoes", "pants", "dress", "None", "wat"]) {
      const check = requireGhostCategory({ category });
      if (check.ok) expect(check.category).not.toBe("full");
    }
  });

  it("passes an uncategorised item whose name identifies it", () => {
    expect(requireGhostCategory({ category: "None", name: "Wool Overcoat" }).ok).toBe(true);
  });
});

describe("explicit category shapes override inference", () => {
  it("places a category whose name says nothing about shape", () => {
    // No regex can read "workwear"; the user's answer can.
    expect(mapItemToGhost({ category: "workwear", name: "Untitled piece" })).toBe("full");
    expect(
      mapItemToGhost({
        category: "workwear",
        name: "Untitled piece",
        categoryShapes: { workwear: "top" },
      }),
    ).toBe("upperbody");
  });

  it("unblocks generation for a previously refused category", () => {
    const without = requireGhostCategory({ category: "favorites", name: "Thing" });
    expect(without.ok).toBe(false);
    const with_ = requireGhostCategory({
      category: "favorites",
      name: "Thing",
      categoryShapes: { favorites: "shoes" },
    });
    expect(with_.ok).toBe(true);
    if (with_.ok) expect(with_.category).toBe("footwear");
  });

  it("wins over a name that would classify differently", () => {
    // "swim trunks" reads as a bottom, but if the user filed "swim" as a top,
    // their answer is the one that counts.
    expect(mapItemToGhost({ category: "swim", name: "Swim Trunks" })).toBe("lowerbody");
    expect(
      mapItemToGhost({ category: "swim", name: "Swim Trunks", categoryShapes: { swim: "top" } }),
    ).toBe("upperbody");
  });

  it("is keyed by normalised name, so casing and spacing don't matter", () => {
    expect(
      mapItemToGhost({ category: "  Work   Wear ", categoryShapes: { "work wear": "bottom" } }),
    ).toBe("lowerbody");
  });

  it("ignores an entry for a category the item isn't in", () => {
    expect(
      mapItemToGhost({ category: "workwear", name: "Thing", categoryShapes: { gym: "top" } }),
    ).toBe("full");
  });
});
