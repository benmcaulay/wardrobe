import { describe, expect, it } from "vitest";
import { normalizeCategoryName } from "@/lib/categories";
import { categoryAncestryPath } from "@/lib/category-tree";
import type { CategoryRule } from "@/lib/outfit-random";

/**
 * The rule the effect in random-outfit-builder applies. Extracted here as a
 * pure function so the decision — add a slot, or is one already covering it —
 * is testable without mounting the builder.
 */
function ensureSlotFor(
  rules: CategoryRule[],
  category: string,
  parents: Record<string, string>,
  list: string[],
): CategoryRule[] {
  const ancestry = new Set(categoryAncestryPath(category, parents, list).map(normalizeCategoryName));
  const covered = rules.some((r) => r.categories.some((c) => ancestry.has(normalizeCategoryName(c))));
  return covered ? rules : [...rules, { categories: [category], count: 1 }];
}

const LIST = ["hat", "shirt", "t shirt", "jacket", "jeans", "shoes"];
const PARENTS = { "t shirt": "shirt" };

describe("adding a slot for a directive", () => {
  it("adds one when the layout has no slot for that category", () => {
    // The red-hat dead end: five red hats owned, no hat slot, so no spin
    // could ever seat one.
    const before: CategoryRule[] = [{ categories: ["shirt"], count: 1 }];
    const after = ensureSlotFor(before, "hat", PARENTS, LIST);
    expect(after).toHaveLength(2);
    expect(after[1]).toEqual({ categories: ["hat"], count: 1 });
  });

  it("does not add one when an exact rule exists", () => {
    const before: CategoryRule[] = [{ categories: ["hat"], count: 1 }];
    expect(ensureSlotFor(before, "hat", PARENTS, LIST)).toEqual(before);
  });

  it("treats a parent rule as already covering the child", () => {
    // A "shirt" slot accepts a t shirt, so asking for one must not add a
    // second slot beside it.
    const before: CategoryRule[] = [{ categories: ["shirt"], count: 1 }];
    expect(ensureSlotFor(before, "t shirt", PARENTS, LIST)).toEqual(before);
  });

  it("still adds a parent slot when only the child is covered", () => {
    // A "t shirt" rule does not accept every shirt, so this is a real gap.
    const before: CategoryRule[] = [{ categories: ["t shirt"], count: 1 }];
    expect(ensureSlotFor(before, "jacket", PARENTS, LIST)).toHaveLength(2);
  });

  it("sees a category inside an OR-group rule", () => {
    const before: CategoryRule[] = [{ categories: ["jeans", "shorts"], count: 1 }];
    expect(ensureSlotFor(before, "jeans", PARENTS, LIST)).toEqual(before);
  });
});
