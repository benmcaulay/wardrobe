import { describe, expect, it } from "vitest";
import {
  categoryListSignature,
  expandCategoryRules,
  itemMatchesCategories,
  itemMatchesColorRule,
  pickRandomOutfit,
  slotsMatchRules,
} from "@/lib/outfit-random";

describe("outfit-random", () => {
  it("expands category rules into individual slots", () => {
    const expanded = expandCategoryRules([
      { categories: ["top"], count: 2 },
      { categories: ["shoes"], count: 1 },
    ]);
    expect(expanded).toHaveLength(3);
    expect(expanded[0]?.categories).toEqual(["top"]);
    expect(expanded[1]?.categories).toEqual(["top"]);
    expect(expanded[2]?.categories).toEqual(["shoes"]);
  });

  it("picks items matching category slots exactly", () => {
    const items = [
      { id: "a", category: "top", colors: [{ hex: "#000", name: "black" }] },
      { id: "b", category: "bottom", colors: [{ hex: "#000", name: "black" }] },
      { id: "c", category: "top", colors: [{ hex: "#f00", name: "red" }] },
    ];
    const slots = [
      { id: "s1", categories: ["top"] },
      { id: "s2", categories: ["bottom"] },
    ];
    const result = pickRandomOutfit(items, slots, []);
    expect(result).not.toBeNull();
    expect(result!.get("s1")).toMatch(/a|c/);
    expect(result!.get("s2")).toBe("b");
  });

  it("matches OR category lists on slots", () => {
    const items = [
      { id: "h1", category: "hat", colors: [] },
      { id: "a1", category: "accessory", colors: [] },
      { id: "s1", category: "shirt", colors: [] },
    ];
    const slots = [{ id: "s1", categories: ["hat", "accessory"] }];
    const result = pickRandomOutfit(items, slots, []);
    expect(result).not.toBeNull();
    expect(["h1", "a1"]).toContain(result!.get("s1"));
    expect(result!.get("s1")).not.toBe("s1");
  });

  it("does not alias shirt to top", () => {
    const items = [
      { id: "shirt1", category: "shirt", colors: [] },
      { id: "b1", category: "bottom", colors: [] },
    ];
    expect(itemMatchesCategories(items[0]!, ["top"])).toBe(false);
    const slots = [{ id: "s1", categories: ["top"] }];
    expect(pickRandomOutfit(items, slots, [])).toBeNull();
  });

  /**
   * The declared exception to the rule above. "shirt" is not a "top" by name —
   * no synonym table — but it *is* one when the user has nested it there, and
   * the generator's rule chips promise exactly that.
   */
  describe("nested categories", () => {
    // As lib/category-tree.ts builds it: self first, then ancestors.
    const tee = {
      id: "tee",
      category: "t shirt",
      categoryPath: ["t shirt", "shirt", "top"],
      colors: [],
    };

    it("matches a rule for any category the item is nested under", () => {
      expect(itemMatchesCategories(tee, ["t shirt"])).toBe(true);
      expect(itemMatchesCategories(tee, ["shirt"])).toBe(true);
      expect(itemMatchesCategories(tee, ["top"])).toBe(true);
    });

    it("does not match sideways or downward", () => {
      expect(itemMatchesCategories(tee, ["bottom"])).toBe(false);
      expect(itemMatchesCategories(tee, ["flannel"])).toBe(false);
    });

    it("fills a parent's slot with a piece filed under the child", () => {
      const slots = [{ id: "s1", categories: ["top"] }];
      const result = pickRandomOutfit([tee], slots, []);
      expect(result?.get("s1")).toBe("tee");
    });

    it("still refuses a piece with no category, path or not", () => {
      const none = { id: "n", category: "None", categoryPath: ["None", "top"], colors: [] };
      expect(itemMatchesCategories(none, ["top"])).toBe(false);
    });

    it("falls back to the plain category when no path is given", () => {
      const flat = { id: "f", category: "t shirt", colors: [] };
      expect(itemMatchesCategories(flat, ["t shirt"])).toBe(true);
      expect(itemMatchesCategories(flat, ["top"])).toBe(false);
    });

    it("counts one piece once, so two nested slots need two pieces", () => {
      // A rule for "shirt" plus a rule for "t shirt" is two garments, not one
      // garment matched twice.
      const slots = [
        { id: "parent", categories: ["shirt"] },
        { id: "child", categories: ["t shirt"] },
      ];
      expect(pickRandomOutfit([tee], slots, [])).toBeNull();
      const second = { ...tee, id: "tee2" };
      const result = pickRandomOutfit([tee, second], slots, []);
      expect(result).not.toBeNull();
      expect(new Set([result!.get("parent"), result!.get("child")]).size).toBe(2);
    });
  });

  it("respects color rules using primary color only", () => {
    const items = [
      { id: "r1", category: "top", colors: [{ hex: "#f00", name: "red" }] },
      { id: "b1", category: "bottom", colors: [{ hex: "#000", name: "black" }] },
      {
        id: "rb",
        category: "bottom",
        colors: [{ hex: "#f00", name: "red" }, { hex: "#000", name: "black" }],
      },
    ];
    const slots = [
      { id: "s1", categories: ["top"] },
      { id: "s2", categories: ["bottom"] },
    ];
    const result = pickRandomOutfit(items, slots, [
      { colorName: "red", count: 1 },
      { colorName: "black", count: 1 },
    ]);
    expect(result).not.toBeNull();
    const picked = new Set(result!.values());
    expect(picked.has("r1")).toBe(true);
    expect(picked.has("b1")).toBe(true);
    expect(picked.has("rb")).toBe(false);
  });

  it("keeps locked slots while re-rolling the rest", () => {
    const items = [
      { id: "h1", category: "hat", colors: [{ hex: "#000", name: "black" }] },
      { id: "h2", category: "hat", colors: [{ hex: "#f00", name: "red" }] },
      { id: "s1", category: "shirt", colors: [{ hex: "#000", name: "black" }] },
    ];
    const slots = [
      { id: "slot-h", categories: ["hat"], lockedItemId: "h1" },
      { id: "slot-s", categories: ["shirt"] },
    ];
    const result = pickRandomOutfit(items, slots, [{ colorName: "black", count: 2 }]);
    expect(result?.get("slot-h")).toBe("h1");
    expect(result?.get("slot-s")).toBe("s1");
  });

  it("primary color helper ignores secondary tags", () => {
    expect(
      itemMatchesColorRule(
        {
          id: "x",
          category: "bottom",
          colors: [{ hex: "#f00", name: "red" }, { hex: "#000", name: "black" }],
        },
        "black",
      ),
    ).toBe(false);
  });

  it("validates placed slots against rules by exact category signature", () => {
    expect(
      slotsMatchRules(
        [{ categories: ["shirt"] }, { categories: ["bottom"] }],
        [{ categories: ["top"], count: 1 }, { categories: ["bottom"], count: 1 }],
      ),
    ).toBe(false);
    expect(
      slotsMatchRules(
        [{ categories: ["shirt"] }],
        [{ categories: ["shirt", "top"], count: 1 }],
      ),
    ).toBe(false);
    expect(
      slotsMatchRules(
        [{ categories: ["hat", "accessory"] }],
        [{ categories: ["accessory", "hat"], count: 1 }],
      ),
    ).toBe(true);
    expect(categoryListSignature(["hat", "accessory"])).toBe(
      categoryListSignature(["accessory", "hat"]),
    );
  });
});
