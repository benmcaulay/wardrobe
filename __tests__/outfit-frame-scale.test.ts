import { describe, it, expect } from "vitest";
import {
  MAX_FRAME_SCALE,
  MIN_FRAME_SCALE,
  clampToFrame,
  computeFrameScale,
  toFrameSpace,
} from "../lib/outfit-frame-scale";

const FRAME = { frameWidth: 560, frameHeight: 960 };

describe("computeFrameScale", () => {
  it("stays 1:1 when there's room for the whole frame", () => {
    expect(
      computeFrameScale({ ...FRAME, availableWidth: 800, availableHeight: 1200 }),
    ).toBe(1);
  });

  it("never upscales past 1, however much room there is", () => {
    expect(
      computeFrameScale({ ...FRAME, availableWidth: 5000, availableHeight: 5000 }),
    ).toBe(MAX_FRAME_SCALE);
  });

  it("shrinks to fit the limiting dimension", () => {
    // Height is the constraint: 480/960 = 0.5
    expect(computeFrameScale({ ...FRAME, availableWidth: 800, availableHeight: 480 })).toBe(0.5);
    // Width is the constraint: 280/560 = 0.5
    expect(computeFrameScale({ ...FRAME, availableWidth: 280, availableHeight: 2000 })).toBe(0.5);
  });

  it("picks the smaller of the two ratios", () => {
    // width→0.75, height→0.5; must choose 0.5 or the frame overflows vertically.
    expect(computeFrameScale({ ...FRAME, availableWidth: 420, availableHeight: 480 })).toBe(0.5);
  });

  it("refuses to shrink below the usable floor", () => {
    expect(
      computeFrameScale({ ...FRAME, availableWidth: 50, availableHeight: 50 }),
    ).toBe(MIN_FRAME_SCALE);
  });

  it("renders unscaled when nothing has been measured yet", () => {
    // First paint has no layout numbers; collapsing to the floor would make the
    // canvas visibly jump on mount.
    expect(computeFrameScale({ ...FRAME, availableWidth: 0, availableHeight: 0 })).toBe(1);
  });

  it("uses whichever dimension has been measured", () => {
    expect(computeFrameScale({ ...FRAME, availableWidth: 0, availableHeight: 480 })).toBe(0.5);
    expect(computeFrameScale({ ...FRAME, availableWidth: 280, availableHeight: 0 })).toBe(0.5);
  });

  it("survives a degenerate frame", () => {
    expect(
      computeFrameScale({ frameWidth: 0, frameHeight: 0, availableWidth: 100, availableHeight: 100 }),
    ).toBe(1);
  });

  it("rounds so resize jitter doesn't thrash re-renders", () => {
    const s = computeFrameScale({ ...FRAME, availableWidth: 800, availableHeight: 707 });
    expect(s).toBe(Number(s.toFixed(3)));
  });

  it("is monotonic — more room never means a smaller scale", () => {
    let previous = 0;
    for (let h = 100; h <= 1200; h += 50) {
      const s = computeFrameScale({ ...FRAME, availableWidth: 5000, availableHeight: h });
      expect(s).toBeGreaterThanOrEqual(previous);
      previous = s;
    }
  });
});

describe("toFrameSpace", () => {
  const rect = { left: 100, top: 50 };

  it("is a plain offset at 1:1", () => {
    expect(toFrameSpace(300, 250, rect, 1)).toEqual({ x: 200, y: 200 });
  });

  it("divides displayed pixels by the scale", () => {
    // Half-scale: 100 displayed px is 200 logical px.
    expect(toFrameSpace(200, 150, rect, 0.5)).toEqual({ x: 200, y: 200 });
  });

  it("maps the far corner of a scaled frame to the full logical size", () => {
    // A 560x960 frame at 0.5 occupies 280x480 on screen.
    expect(toFrameSpace(100 + 280, 50 + 480, rect, 0.5)).toEqual({ x: 560, y: 960 });
  });

  it("treats a zero or negative scale as 1 rather than dividing by zero", () => {
    expect(toFrameSpace(300, 250, rect, 0)).toEqual({ x: 200, y: 200 });
    expect(Number.isFinite(toFrameSpace(300, 250, rect, 0).x)).toBe(true);
  });
});

describe("clampToFrame", () => {
  it("keeps a point inside the frame", () => {
    expect(clampToFrame(300, 400, 560, 960)).toEqual({ x: 300, y: 400 });
  });

  it("clamps past either edge", () => {
    expect(clampToFrame(-20, -5, 560, 960)).toEqual({ x: 0, y: 0 });
    expect(clampToFrame(9999, 9999, 560, 960)).toEqual({ x: 560, y: 960 });
  });
});
