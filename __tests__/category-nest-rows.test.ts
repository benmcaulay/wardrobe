import { describe, expect, it } from "vitest";
import { nestDepthRows } from "../lib/category-tree";

const r = (name: string, depth: number) => ({ name, depth });

describe("nestDepthRows", () => {
  it("nests children under the preceding shallower row", () => {
    // The real closet: shirt with three children, then a sibling root.
    const out = nestDepthRows([
      r("shirt", 0),
      r("t shirt", 1),
      r("long sleeve shirt", 1),
      r("dress shirt", 1),
      r("outerwear", 0),
      r("jacket", 1),
    ]);
    expect(out.map((n) => n.name)).toEqual(["shirt", "outerwear"]);
    expect(out[0]!.children.map((c) => c.name)).toEqual([
      "t shirt",
      "long sleeve shirt",
      "dress shirt",
    ]);
    expect(out[1]!.children.map((c) => c.name)).toEqual(["jacket"]);
  });

  it("handles grandchildren", () => {
    const out = nestDepthRows([r("bottom", 0), r("pants", 1), r("jeans", 2), r("shorts", 1)]);
    expect(out).toHaveLength(1);
    const pants = out[0]!.children[0]!;
    expect(pants.name).toBe("pants");
    expect(pants.children.map((c) => c.name)).toEqual(["jeans"]);
    expect(out[0]!.children.map((c) => c.name)).toEqual(["pants", "shorts"]);
  });

  it("treats a flat list as all roots", () => {
    const out = nestDepthRows([r("hat", 0), r("shoes", 0), r("accessory", 0)]);
    expect(out).toHaveLength(3);
    expect(out.every((n) => n.children.length === 0)).toBe(true);
  });

  it("attaches a skipped depth to the nearest shallower ancestor", () => {
    // Hand-edited prefs can produce a jump; dropping the row would hide a
    // category that exists.
    const out = nestDepthRows([r("bottom", 0), r("jeans", 3)]);
    expect(out).toHaveLength(1);
    expect(out[0]!.children.map((c) => c.name)).toEqual(["jeans"]);
  });

  it("promotes a leading non-zero depth to a root rather than dropping it", () => {
    const out = nestDepthRows([r("orphan", 2), r("hat", 0)]);
    expect(out.map((n) => n.name)).toEqual(["orphan", "hat"]);
  });

  it("returns [] for no rows and does not mutate the input", () => {
    const rows = [r("hat", 0)];
    const frozen = JSON.stringify(rows);
    expect(nestDepthRows([])).toEqual([]);
    nestDepthRows(rows);
    expect(JSON.stringify(rows)).toBe(frozen);
  });

  it("preserves the original row fields", () => {
    const out = nestDepthRows([{ name: "shirt", depth: 0, nested: 3 }]);
    expect(out[0]!.nested).toBe(3);
  });
});
