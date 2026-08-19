import { describe, expect, it } from "vitest";
import {
  DRAG_THRESHOLD_PX,
  fitPreview,
  passedThreshold,
  zoneAtPoint,
  type DropZone,
} from "@/lib/packing/drag";

const rect = (left: number, top: number, right: number, bottom: number) => ({
  left,
  top,
  right,
  bottom,
});

describe("zoneAtPoint", () => {
  const zones: DropZone[] = [
    { id: "bag-a", rect: rect(0, 0, 100, 100) },
    { id: "bag-b", rect: rect(200, 0, 300, 100) },
  ];

  it("finds the zone under the pointer", () => {
    expect(zoneAtPoint(zones, 50, 50)).toBe("bag-a");
    expect(zoneAtPoint(zones, 250, 50)).toBe("bag-b");
  });

  it("returns null in the gap between zones", () => {
    expect(zoneAtPoint(zones, 150, 50)).toBeNull();
    expect(zoneAtPoint(zones, 50, 500)).toBeNull();
  });

  it("counts the edges as inside, so a drop on the border still lands", () => {
    expect(zoneAtPoint(zones, 0, 0)).toBe("bag-a");
    expect(zoneAtPoint(zones, 100, 100)).toBe("bag-a");
  });

  it("has no zone to find in an empty list", () => {
    expect(zoneAtPoint([], 10, 10)).toBeNull();
  });

  /**
   * Nothing nests today, but the pool and the bags share a scroll column and a
   * layout change could put one inside the other. Smallest-wins means the drop
   * goes where the pointer visibly is rather than to whichever registered first.
   */
  it("prefers the smallest zone when they overlap", () => {
    const nested: DropZone[] = [
      { id: "outer", rect: rect(0, 0, 400, 400) },
      { id: "inner", rect: rect(100, 100, 200, 200) },
    ];
    expect(zoneAtPoint(nested, 150, 150)).toBe("inner");
    expect(zoneAtPoint(nested, 50, 50)).toBe("outer");
    // Order of registration must not matter.
    expect(zoneAtPoint([...nested].reverse(), 150, 150)).toBe("inner");
  });

  it("ignores zero-area zones", () => {
    expect(zoneAtPoint([{ id: "collapsed", rect: rect(10, 10, 10, 10) }], 10, 10)).toBe("collapsed");
  });
});

describe("fitPreview", () => {
  it("reports the current fill when nothing is incoming", () => {
    const p = fitPreview({ used: 9, capacity: 18, incoming: 0 });
    expect(p.usedFraction).toBeCloseTo(0.5, 6);
    expect(p.previewFraction).toBeCloseTo(0.5, 6);
    expect(p.overflows).toBe(false);
    expect(p.overBy).toBe(0);
  });

  it("extends the preview past the solid fill", () => {
    const p = fitPreview({ used: 9, capacity: 18, incoming: 4.5 });
    expect(p.usedFraction).toBeCloseTo(0.5, 6);
    expect(p.previewFraction).toBeCloseTo(0.75, 6);
    expect(p.overflows).toBe(false);
  });

  it("flags an overflow and says by how much", () => {
    const p = fitPreview({ used: 16, capacity: 18, incoming: 4 });
    expect(p.overflows).toBe(true);
    expect(p.overBy).toBeCloseTo(2, 6);
    // The bar stops at full rather than running off the end of the track.
    expect(p.previewFraction).toBe(1);
  });

  it("treats an exact fit as fitting", () => {
    const p = fitPreview({ used: 15.5, capacity: 18, incoming: 2.5 });
    expect(p.overflows).toBe(false);
    expect(p.previewFraction).toBe(1);
  });

  /**
   * 0.1 + 0.2 is famously not 0.3. Without the tolerance, dropping a 2.5L item
   * into 15.5L of an 18L bag could report "0.0000000000000018 L over" and paint
   * the meter red on a perfect fit.
   */
  it("does not call floating-point noise an overflow", () => {
    const p = fitPreview({ used: 0.1 + 0.2, capacity: 0.3, incoming: 0 });
    expect(p.overflows).toBe(false);
  });

  it("reports empty for a bag with no stated capacity", () => {
    for (const capacity of [null, 0, -5, NaN, Infinity]) {
      const p = fitPreview({ used: 4, capacity, incoming: 3 });
      expect(p.usedFraction).toBe(0);
      expect(p.previewFraction).toBe(0);
      expect(p.overflows).toBe(false);
    }
  });

  it("clamps a bag that is already over, rather than overrunning the track", () => {
    const p = fitPreview({ used: 30, capacity: 18, incoming: 0 });
    expect(p.usedFraction).toBe(1);
  });
});

describe("passedThreshold", () => {
  const origin = { x: 100, y: 100 };

  it("ignores a wobble, so a click on a draggable row is still a click", () => {
    expect(passedThreshold(origin, { x: 102, y: 101 })).toBe(false);
    expect(passedThreshold(origin, origin)).toBe(false);
  });

  it("triggers once the pointer has really moved", () => {
    expect(passedThreshold(origin, { x: 100 + DRAG_THRESHOLD_PX, y: 100 })).toBe(true);
    expect(passedThreshold(origin, { x: 100, y: 100 - DRAG_THRESHOLD_PX })).toBe(true);
    expect(passedThreshold(origin, { x: 140, y: 60 })).toBe(true);
  });

  it("measures diagonally, not per axis", () => {
    // 5,5 is under 6 on each axis but 7.07 away.
    expect(passedThreshold(origin, { x: 105, y: 105 })).toBe(true);
  });

  it("honours a custom threshold", () => {
    expect(passedThreshold(origin, { x: 110, y: 100 }, 20)).toBe(false);
    expect(passedThreshold(origin, { x: 130, y: 100 }, 20)).toBe(true);
  });
});
