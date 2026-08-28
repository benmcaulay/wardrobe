import { describe, expect, it } from "vitest";
import {
  buildCategoryTree,
  categoryAncestryPath,
  searchCategoryOptionRows,
  toggleCategoryOptionRow,
  type CategoryOptionRow,
  categoryListFromTree,
  descendantKeys,
  flattenCategoryTree,
  isAncestorOf,
  moveCategory,
  parentsAfterRemoval,
  parentsAfterRename,
  sanitizeCategoryParents,
  searchCategoryTree,
} from "@/lib/category-tree";

const LIST = ["top", "shirt", "t shirt", "bottom", "shoes"];
const PARENTS = { shirt: "top", "t shirt": "shirt" };

/** Rows as "depth:name", which reads like the rendered list. */
function shape(list: readonly string[], parents: Record<string, string>): string[] {
  return flattenCategoryTree(buildCategoryTree(list, parents)).map(
    (r) => `${"  ".repeat(r.depth)}${r.name}`,
  );
}

describe("sanitizeCategoryParents", () => {
  it("keeps edges between categories that exist", () => {
    expect(sanitizeCategoryParents(PARENTS, LIST)).toEqual(PARENTS);
  });

  it("drops an edge naming a category that is gone", () => {
    expect(sanitizeCategoryParents({ shirt: "outerwear" }, LIST)).toEqual({});
    expect(sanitizeCategoryParents({ hat: "top" }, LIST)).toEqual({});
  });

  it("drops a category parented to itself", () => {
    expect(sanitizeCategoryParents({ top: "top" }, LIST)).toEqual({});
  });

  /**
   * Not reachable through `moveCategory`, which refuses cycles — but reachable
   * through stored data, and a cycle would hang every walk of the tree.
   */
  it("breaks a cycle rather than looping forever", () => {
    const cyclic = { top: "shirt", shirt: "t shirt", "t shirt": "top" };
    const out = sanitizeCategoryParents(cyclic, LIST);
    expect(Object.keys(out).length).toBeLessThan(3);
    // Whatever survives must build a finite tree.
    expect(flattenCategoryTree(buildCategoryTree(LIST, out)).length).toBe(LIST.length);
  });

  it("normalises casing and spacing on both sides", () => {
    expect(sanitizeCategoryParents({ "  T  Shirt ": " Shirt " }, LIST)).toEqual({
      "t shirt": "shirt",
    });
  });
});

describe("buildCategoryTree", () => {
  it("nests children under parents, in list order", () => {
    expect(shape(LIST, PARENTS)).toEqual(["top", "  shirt", "    t shirt", "bottom", "shoes"]);
  });

  it("shows every category exactly once", () => {
    const rows = flattenCategoryTree(buildCategoryTree(LIST, PARENTS));
    expect(rows.map((r) => r.name).sort()).toEqual([...LIST].sort());
  });

  /**
   * The list is kept in pre-order after a move, but the first read after this
   * feature ships sees whatever order the flat list already had.
   */
  it("builds the same tree from a list that is not in pre-order", () => {
    const scrambled = ["t shirt", "shoes", "top", "bottom", "shirt"];
    expect(shape(scrambled, PARENTS)).toEqual(["shoes", "top", "  shirt", "    t shirt", "bottom"]);
  });

  it("treats a category with no parent edge as a root", () => {
    expect(shape(LIST, {})).toEqual(["top", "shirt", "t shirt", "bottom", "shoes"]);
  });
});

describe("descendantKeys", () => {
  it("returns the whole subtree, not just direct children", () => {
    expect(descendantKeys("top", PARENTS, LIST).sort()).toEqual(["shirt", "t shirt"]);
  });

  it("is empty for a leaf", () => {
    expect(descendantKeys("t shirt", PARENTS, LIST)).toEqual([]);
  });
});

describe("categoryAncestryPath", () => {
  it("returns the category first, then everything above it", () => {
    expect(categoryAncestryPath("t shirt", PARENTS, LIST)).toEqual(["t shirt", "shirt", "top"]);
  });

  it("is just the category itself at the root", () => {
    expect(categoryAncestryPath("shoes", PARENTS, LIST)).toEqual(["shoes"]);
  });

  it("returns list casing, so the path reads as the user wrote it", () => {
    const list = ["Top", "Shirt"];
    expect(categoryAncestryPath("shirt", { shirt: "top" }, list)).toEqual(["Shirt", "Top"]);
  });

  /** An item can be filed under a label the list has since lost. */
  it("keeps a category the list no longer has", () => {
    expect(categoryAncestryPath("blouse", PARENTS, LIST)).toEqual(["blouse"]);
  });

  it("is empty for no category", () => {
    expect(categoryAncestryPath("  ", PARENTS, LIST)).toEqual([]);
  });
});

describe("isAncestorOf", () => {
  it("reaches past the direct parent", () => {
    expect(isAncestorOf("top", "t shirt", PARENTS, LIST)).toBe(true);
    expect(isAncestorOf("shirt", "t shirt", PARENTS, LIST)).toBe(true);
  });

  it("is false downward and sideways", () => {
    expect(isAncestorOf("t shirt", "top", PARENTS, LIST)).toBe(false);
    expect(isAncestorOf("bottom", "shirt", PARENTS, LIST)).toBe(false);
  });

  it("is false for a category against itself", () => {
    expect(isAncestorOf("top", "top", PARENTS, LIST)).toBe(false);
  });
});

describe("moveCategory", () => {
  it("nests the dragged category under the target, as its last child", () => {
    const out = moveCategory(LIST, PARENTS, "bottom", "top", "child");
    expect(out.moved).toBe(true);
    expect(shape(out.list, out.parents)).toEqual([
      "top",
      "  shirt",
      "    t shirt",
      "  bottom",
      "shoes",
    ]);
  });

  it("carries the subtree along", () => {
    const out = moveCategory(LIST, PARENTS, "shirt", "bottom", "child");
    expect(shape(out.list, out.parents)).toEqual([
      "top",
      "bottom",
      "  shirt",
      "    t shirt",
      "shoes",
    ]);
  });

  it("un-nests by dropping beside a root category", () => {
    const out = moveCategory(LIST, PARENTS, "t shirt", "shoes", "sibling");
    expect(out.parents["t shirt"]).toBeUndefined();
    // Root level, immediately before the target — not before "bottom", which
    // is where it happened to sit in the list.
    expect(shape(out.list, out.parents)).toEqual(["top", "  shirt", "bottom", "t shirt", "shoes"]);
  });

  it("adopts the target's parent on a sibling drop", () => {
    const out = moveCategory(LIST, PARENTS, "shoes", "t shirt", "sibling");
    expect(out.parents.shoes).toBe("shirt");
    expect(shape(out.list, out.parents)).toEqual([
      "top",
      "  shirt",
      "    shoes",
      "    t shirt",
      "bottom",
    ]);
  });

  it("lands before the target whichever direction the drag came from", () => {
    const down = moveCategory(LIST, {}, "top", "shoes", "sibling");
    expect(down.list).toEqual(["shirt", "t shirt", "bottom", "top", "shoes"]);
    const up = moveCategory(LIST, {}, "shoes", "shirt", "sibling");
    expect(up.list).toEqual(["top", "shoes", "shirt", "t shirt", "bottom"]);
  });

  it("lands after the target in \"after\" mode, which is how a category becomes last", () => {
    // Roots were top, bottom, shoes; "top" and its subtree move to the end.
    const out = moveCategory(LIST, PARENTS, "top", "shoes", "after");
    expect(out.list).toEqual(["bottom", "shoes", "top", "shirt", "t shirt"]);
    expect(shape(out.list, out.parents)).toEqual([
      "bottom",
      "shoes",
      "top",
      "  shirt",
      "    t shirt",
    ]);
  });

  it("un-nests to the end of the root level with \"after\"", () => {
    const out = moveCategory(LIST, PARENTS, "t shirt", "shoes", "after");
    expect(out.parents["t shirt"]).toBeUndefined();
    expect(out.list).toEqual(["top", "shirt", "bottom", "shoes", "t shirt"]);
  });

  /**
   * The move that would detach the tree: nesting a parent under its own child
   * leaves both unreachable from any root.
   */
  it("refuses to nest a category under its own descendant", () => {
    const out = moveCategory(LIST, PARENTS, "top", "t shirt", "child");
    expect(out.moved).toBe(false);
    expect(out.list).toEqual(LIST);
    expect(out.parents).toEqual(PARENTS);
  });

  it("refuses a drop on itself, and unknown categories", () => {
    expect(moveCategory(LIST, PARENTS, "top", "top", "child").moved).toBe(false);
    expect(moveCategory(LIST, PARENTS, "hat", "top", "child").moved).toBe(false);
    expect(moveCategory(LIST, PARENTS, "top", "hat", "child").moved).toBe(false);
  });

  it("returns a list in pre-order, so it can be stored as the display order", () => {
    const out = moveCategory(LIST, PARENTS, "bottom", "top", "child");
    expect(out.list).toEqual(categoryListFromTree(buildCategoryTree(out.list, out.parents)));
  });
});

describe("parentsAfterRemoval", () => {
  it("promotes children to the removed category's parent", () => {
    const out = parentsAfterRemoval(PARENTS, LIST, "shirt");
    expect(out).toEqual({ "t shirt": "top" });
  });

  it("promotes to the root when the removed category was a root", () => {
    expect(parentsAfterRemoval(PARENTS, LIST, "top")).toEqual({ "t shirt": "shirt" });
  });
});

describe("parentsAfterRename", () => {
  it("rewires the edge on both sides", () => {
    expect(parentsAfterRename(PARENTS, LIST, "shirt", "shirts")).toEqual({
      shirts: "top",
      "t shirt": "shirts",
    });
  });

  it("leaves unrelated edges alone", () => {
    expect(parentsAfterRename(PARENTS, LIST, "shoes", "footwear")).toEqual(PARENTS);
  });
});

describe("searchCategoryTree", () => {
  const tree = buildCategoryTree(LIST, PARENTS);

  it("keeps everything for an empty query", () => {
    expect(flattenCategoryTree(searchCategoryTree(tree, "  ")).length).toBe(LIST.length);
  });

  it("keeps a match with its whole subtree, so the nesting is visible", () => {
    // "top" survives as the path to the match, and "t shirt" as the match's
    // own subtree — both at their real depths, so the result reads as a tree
    // rather than a list of hits.
    const rows = flattenCategoryTree(searchCategoryTree(tree, "shirt"));
    expect(rows.map((r) => `${r.depth}:${r.name}`)).toEqual(["0:top", "1:shirt", "2:t shirt"]);
  });

  it("keeps the whole path down to a deep match", () => {
    const rows = flattenCategoryTree(searchCategoryTree(tree, "t shirt"));
    expect(rows.map((r) => `${r.depth}:${r.name}`)).toEqual(["0:top", "1:shirt", "2:t shirt"]);
  });

  it("drops branches with no match anywhere", () => {
    const rows = flattenCategoryTree(searchCategoryTree(tree, "shoe"));
    expect(rows.map((r) => r.name)).toEqual(["shoes"]);
  });

  it("matches case-insensitively", () => {
    expect(flattenCategoryTree(searchCategoryTree(tree, "SHOES")).map((r) => r.name)).toEqual([
      "shoes",
    ]);
  });
});

describe("picker rows", () => {
  /** The closet's Category filter for the LIST/PARENTS closet, None included. */
  const ROWS: CategoryOptionRow[] = [
    { value: "__none__", label: "None", depth: 0, descendants: [] },
    { value: "top", label: "top", depth: 0, descendants: ["shirt", "t shirt"] },
    { value: "shirt", label: "shirt", depth: 1, descendants: ["t shirt"] },
    { value: "t shirt", label: "t shirt", depth: 2, descendants: [] },
    { value: "bottom", label: "bottom", depth: 0, descendants: [] },
    { value: "shoes", label: "shoes", depth: 0, descendants: [] },
  ];

  describe("searchCategoryOptionRows", () => {
    it("keeps everything for an empty query", () => {
      expect(searchCategoryOptionRows(ROWS, "").length).toBe(ROWS.length);
      expect(searchCategoryOptionRows(ROWS, "   ").length).toBe(ROWS.length);
    });

    it("keeps a match with its ancestors and its subtree", () => {
      expect(searchCategoryOptionRows(ROWS, "shirt").map((r) => r.value)).toEqual([
        "top",
        "shirt",
        "t shirt",
      ]);
    });

    it("keeps the path to a deep match", () => {
      expect(searchCategoryOptionRows(ROWS, "t shirt").map((r) => r.value)).toEqual([
        "top",
        "shirt",
        "t shirt",
      ]);
    });

    it("keeps rows in their original order and depth, so the indent still reads", () => {
      // "o" matches None, top, bottom and shoes; "top" also drags in its
      // subtree. The result must stay in list order, parents before children.
      const out = searchCategoryOptionRows(ROWS, "o");
      expect(out.map((r) => `${r.depth}:${r.value}`)).toEqual([
        "0:__none__",
        "0:top",
        "1:shirt",
        "2:t shirt",
        "0:bottom",
        "0:shoes",
      ]);
    });

    it("returns nothing when no label matches", () => {
      expect(searchCategoryOptionRows(ROWS, "zzz")).toEqual([]);
    });

    it("matches a sentinel row by its label", () => {
      expect(searchCategoryOptionRows(ROWS, "none").map((r) => r.value)).toEqual(["__none__"]);
    });
  });

  describe("toggleCategoryOptionRow", () => {
    const top = ROWS[1]!;

    it("selecting a parent selects everything under it", () => {
      expect(toggleCategoryOptionRow([], top)).toEqual(["top", "shirt", "t shirt"]);
    });

    it("deselecting a parent clears the subtree with it", () => {
      expect(toggleCategoryOptionRow(["top", "shirt", "t shirt", "shoes"], top)).toEqual(["shoes"]);
    });

    it("leaves a leaf selection alone", () => {
      const leaf = ROWS[3]!;
      expect(toggleCategoryOptionRow(["shoes"], leaf)).toEqual(["shoes", "t shirt"]);
      expect(toggleCategoryOptionRow(["shoes", "t shirt"], leaf)).toEqual(["shoes"]);
    });

    it("does not duplicate a child already selected on its own", () => {
      expect(toggleCategoryOptionRow(["t shirt"], top)).toEqual(["t shirt", "top", "shirt"]);
    });
  });
});
