import { describe, expect, it } from "vitest";
import {
  FLY_IN_DURATION_MS,
  FLY_IN_TURNS,
  flyInFrame,
  flyInProgress,
} from "@/lib/packing/fly-in";

const RELEASE = { x: 640, y: 200 };
const TARGET = { x: 400, y: 500 };

function path(steps = 400, release = RELEASE, target = TARGET) {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const p = i / steps;
    return { p, f: flyInFrame(release, target, p) };
  });
}

describe("starting where you released it", () => {
  /**
   * The requirement every previous attempt failed. Not "on the orbit nearest
   * the release", not "the release converted into stage space after a
   * re-render" — the exact client coordinates of the pointer.
   */
  it("frame zero is exactly the release point", () => {
    for (const release of [
      { x: 640, y: 200 },
      { x: 0, y: 0 },
      { x: -50, y: 900 },
      { x: 400, y: 500 },
    ]) {
      const f = flyInFrame(release, TARGET, 0);
      expect(f.x).toBeCloseTo(release.x, 9);
      expect(f.y).toBeCloseTo(release.y, 9);
    }
  });

  it("is fully opaque and full size at the release", () => {
    const f = flyInFrame(RELEASE, TARGET, 0);
    expect(f.opacity).toBe(1);
    expect(f.scale).toBeCloseTo(1, 9);
  });

  it("holds still when released exactly on the target", () => {
    const f = flyInFrame(TARGET, TARGET, 0.5);
    expect(f.x).toBeCloseTo(TARGET.x, 9);
    expect(f.y).toBeCloseTo(TARGET.y, 9);
  });
});

describe("the flight", () => {
  it("ends on the target", () => {
    const f = flyInFrame(RELEASE, TARGET, 1);
    expect(f.x).toBeCloseTo(TARGET.x, 6);
    expect(f.y).toBeCloseTo(TARGET.y, 6);
  });

  it("closes on the target the whole way, never retreating", () => {
    let prev = Infinity;
    for (const { f } of path(800)) {
      const d = Math.hypot(f.x - TARGET.x, f.y - TARGET.y);
      expect(d).toBeLessThanOrEqual(prev + 1e-9);
      prev = d;
    }
  });

  it("circles the target twice on the way in", () => {
    /*
     * Unwrap the bearing and count total rotation, ignoring frames closer than
     * a pixel to the target: there the bearing is atan2 of ~zero over ~zero,
     * which is numerically meaningless and injects spurious rotation. Excluding
     * them measures the spiral rather than the noise at its centre.
     */
    let total = 0;
    let prev: number | null = null;
    for (const { f } of path(4000)) {
      const dx = f.x - TARGET.x;
      const dy = f.y - TARGET.y;
      if (Math.hypot(dx, dy) < 1) break;
      const a = Math.atan2(dy, dx);
      if (prev !== null) {
        let step = a - prev;
        while (step > Math.PI) step -= 2 * Math.PI;
        while (step < -Math.PI) step += 2 * Math.PI;
        total += step;
      }
      prev = a;
    }
    // Two turns, less only the sliver of easing left in the final pixel.
    const turns = Math.abs(total) / (2 * Math.PI);
    expect(turns).toBeGreaterThan(1.9);
    expect(turns).toBeLessThanOrEqual(FLY_IN_TURNS + 1e-6);
    expect(FLY_IN_TURNS).toBe(2);
  });

  it("shrinks and fades out by the end, handing over to the real piece", () => {
    const end = flyInFrame(RELEASE, TARGET, 1);
    expect(end.scale).toBeLessThan(0.5);
    expect(end.opacity).toBeCloseTo(0, 6);
    // Still visible for most of the flight, though.
    expect(flyInFrame(RELEASE, TARGET, 0.7).opacity).toBe(1);
  });

  /**
   * The target is re-measured every frame precisely because the layout reflows
   * mid-flight when the rail loses the packed row. A moved target must still
   * produce a landing, not an offset miss.
   */
  it("lands on a target that moved mid-flight", () => {
    const moved = { x: TARGET.x, y: TARGET.y - 90 };
    const f = flyInFrame(RELEASE, moved, 1);
    expect(f.x).toBeCloseTo(moved.x, 6);
    expect(f.y).toBeCloseTo(moved.y, 6);
  });

  it("stays finite and sane throughout", () => {
    for (const { f } of path(800, { x: -300, y: 1200 })) {
      expect(Number.isFinite(f.x)).toBe(true);
      expect(Number.isFinite(f.y)).toBe(true);
      expect(f.scale).toBeGreaterThan(0);
      expect(f.opacity).toBeGreaterThanOrEqual(0);
      expect(f.opacity).toBeLessThanOrEqual(1);
    }
  });

  it("clamps progress outside 0..1", () => {
    expect(flyInFrame(RELEASE, TARGET, -1)).toEqual(flyInFrame(RELEASE, TARGET, 0));
    expect(flyInFrame(RELEASE, TARGET, 9).x).toBeCloseTo(flyInFrame(RELEASE, TARGET, 1).x, 9);
  });
});

describe("flyInProgress", () => {
  it("runs for two seconds", () => {
    expect(FLY_IN_DURATION_MS).toBe(2_000);
    expect(flyInProgress(0)).toBe(0);
    expect(flyInProgress(1_000)).toBeCloseTo(0.5, 6);
    expect(flyInProgress(2_000)).toBe(1);
    expect(flyInProgress(5_000)).toBe(1);
  });

  it("treats nonsense as finished rather than animating forever", () => {
    expect(flyInProgress(Number.NaN)).toBe(1);
    expect(flyInProgress(100, 0)).toBe(1);
  });
});
