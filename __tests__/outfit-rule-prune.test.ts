import { describe, expect, it } from "vitest";
import { categoryRulesEqual, pruneCategoryRules, type CategoryRule } from "@/lib/outfit-random";

/**
 * Rules are stored by category name, so deleting a category in Settings used to
 * leave one behind — and a rule is what puts a slot on the outfit canvas, so the
 * canvas kept an empty slot for a category the closet no longer had, saying
 * "Need 1 top piece but only 0 in your closet" with nothing able to clear it.
 */
describe("pruneCategoryRules", () => {
  const KNOWN = ["shirt", "bottom", "shoes"];

  it("keeps rules whose categories all still exist", () => {
    const rules: CategoryRule[] = [
      { categories: ["shirt"], count: 1 },
      { categories: ["bottom"], count: 2 },
    ];
    expect(pruneCategoryRules(rules, KNOWN)).toEqual(rules);
  });

  it("drops a rule for a category that is gone", () => {
    const rules: CategoryRule[] = [
      { categories: ["top"], count: 1 },
      { categories: ["shoes"], count: 1 },
    ];
    expect(pruneCategoryRules(rules, KNOWN)).toEqual([{ categories: ["shoes"], count: 1 }]);
  });

  it("narrows an OR rule instead of dropping it, when only part is gone", () => {
    // "hat or shoes" survives as "shoes" — the request for one piece stands.
    const rules: CategoryRule[] = [{ categories: ["hat", "shoes"], count: 2 }];
    expect(pruneCategoryRules(rules, KNOWN)).toEqual([{ categories: ["shoes"], count: 2 }]);
  });

  it("keeps the count when narrowing", () => {
    const out = pruneCategoryRules([{ categories: ["top", "shirt"], count: 3 }], KNOWN);
    expect(out).toEqual([{ categories: ["shirt"], count: 3 }]);
  });

  it("matches case-insensitively", () => {
    expect(pruneCategoryRules([{ categories: [" Shirt "], count: 1 }], KNOWN)).toEqual([
      { categories: [" Shirt "], count: 1 },
    ]);
  });

  it("returns the same array reference when nothing changed", () => {
    // The client prunes in an effect; a new array every render would loop.
    const rules: CategoryRule[] = [{ categories: ["shirt"], count: 1 }];
    expect(pruneCategoryRules(rules, KNOWN)[0]).toBe(rules[0]);
  });

  it("empties out when the closet has no categories left", () => {
    expect(pruneCategoryRules([{ categories: ["shirt"], count: 1 }], [])).toEqual([]);
  });
});

describe("categoryRulesEqual", () => {
  it("is true for identical rules, whatever the casing", () => {
    expect(
      categoryRulesEqual(
        [{ categories: ["Shirt"], count: 1 }],
        [{ categories: ["shirt"], count: 1 }],
      ),
    ).toBe(true);
  });

  it("is false on a different count, category, length or order", () => {
    const base: CategoryRule[] = [{ categories: ["shirt"], count: 1 }];
    expect(categoryRulesEqual(base, [{ categories: ["shirt"], count: 2 }])).toBe(false);
    expect(categoryRulesEqual(base, [{ categories: ["bottom"], count: 1 }])).toBe(false);
    expect(categoryRulesEqual(base, [])).toBe(false);
    expect(
      categoryRulesEqual(
        [{ categories: ["shirt", "top"], count: 1 }],
        [{ categories: ["top", "shirt"], count: 1 }],
      ),
    ).toBe(false);
  });
});
