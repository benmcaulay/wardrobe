import { describe, expect, it } from "vitest";
import {
  countRowBands,
  findWrappedRows,
  GALLERY_CHILD_THRESHOLD,
  isGallery,
  MIN_ROW_CHILDREN,
  type Candidate,
  type Rect,
} from "@/lib/eval/layout-rows";

const chip = (left: number, top: number, w = 60, h = 24): Rect => ({
  left, right: left + w, top, bottom: top + h, width: w,
});

describe("countRowBands", () => {
  it("counts a single row of equal-height items as one row", () => {
    expect(countRowBands([chip(0, 0), chip(70, 0), chip(140, 0)])).toBe(1);
  });

  it("counts a wrapped set as two rows", () => {
    expect(countRowBands([chip(0, 0), chip(70, 0), chip(0, 30), chip(70, 30)])).toBe(2);
  });

  it("treats differing heights on one line as ONE row", () => {
    // The bug that sent an investigation to the wrong file: a 24px pill beside a
    // 16px checkbox has a different `top`, but they share a visual row.
    const row = [chip(0, 0, 60, 24), chip(70, 4, 40, 16), chip(120, 2, 50, 20)];
    expect(countRowBands(row)).toBe(1);
  });

  it("still separates rows when a tall item is followed by a genuine wrap", () => {
    const rows = [chip(0, 0, 60, 40), chip(70, 8, 40, 16), chip(0, 44, 60, 24)];
    expect(countRowBands(rows)).toBe(2);
  });

  it("is order-independent", () => {
    const a = [chip(0, 30), chip(70, 0), chip(0, 0), chip(70, 30)];
    expect(countRowBands(a)).toBe(2);
  });

  it("handles the degenerate cases", () => {
    expect(countRowBands([])).toBe(0);
    expect(countRowBands([chip(0, 0)])).toBe(1);
  });

  it("absorbs sub-pixel offsets within the slack", () => {
    expect(countRowBands([chip(0, 0, 60, 24), chip(70, 1.4, 60, 24)])).toBe(1);
  });

  it("counts three rows for a three-line wrap", () => {
    expect(countRowBands([chip(0, 0), chip(0, 30), chip(0, 60)])).toBe(3);
  });
});

describe("isGallery", () => {
  it("treats large child counts as intentional grids", () => {
    expect(isGallery(GALLERY_CHILD_THRESHOLD)).toBe(true);
    expect(isGallery(194)).toBe(true);
    expect(isGallery(9)).toBe(false);
  });
});

describe("findWrappedRows", () => {
  const cand = (kids: Rect[], sel = "div.row"): Candidate => ({
    sel, kids, width: 400, labels: [],
  });

  it("reports a wrapped control row", () => {
    const kids = [chip(0, 0), chip(70, 0), chip(140, 0), chip(210, 0), chip(0, 30)];
    const out = findWrappedRows([cand(kids)]);
    expect(out).toHaveLength(1);
    expect(out[0]!.rows).toBe(2);
    expect(out[0]!.kids).toBe(5);
  });

  it("ignores a single-row container", () => {
    const kids = Array.from({ length: 6 }, (_, i) => chip(i * 70, 0));
    expect(findWrappedRows([cand(kids)])).toEqual([]);
  });

  it("ignores galleries, which are supposed to wrap", () => {
    const kids = Array.from({ length: 40 }, (_, i) => chip((i % 5) * 70, Math.floor(i / 5) * 30));
    expect(findWrappedRows([cand(kids)])).toEqual([]);
  });

  it("ignores containers with too few children to be a row", () => {
    const kids = Array.from({ length: MIN_ROW_CHILDREN - 1 }, (_, i) => chip(0, i * 30));
    expect(findWrappedRows([cand(kids)])).toEqual([]);
  });

  it("carries the selector and labels through for reporting", () => {
    const kids = [chip(0, 0), chip(70, 0), chip(140, 0), chip(210, 0), chip(0, 30)];
    const out = findWrappedRows([
      { sel: "div.flex.gap-2", kids, width: 421, labels: ["hat", "shirt"] },
    ]);
    expect(out[0]!.sel).toBe("div.flex.gap-2");
    expect(out[0]!.width).toBe(421);
    expect(out[0]!.labels).toEqual(["hat", "shirt"]);
  });
});
