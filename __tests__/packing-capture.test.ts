import { describe, expect, it } from "vitest";
import {
  APPROACH_TURNS,
  BAG_Z,
  CAPTURE_DURATION_MS,
  captureAngleOffset,
  captureProgress,
  captureRadiusScale,
  captureSlot,
  captureTurnsSwept,
  orbitFor,
  planetSlot,
} from "@/lib/packing/orbit";

const ORBIT = orbitFor("item:capture-test", { maxRadiusX: 200, maxRadiusY: 68 });

/** Samples across the whole capture, for scanning the trajectory. */
function trajectory(steps = 400, phase = 0) {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const p = i / steps;
    return { p, slot: captureSlot(ORBIT, p, phase) };
  });
}

describe("the two approach circles", () => {
  /**
   * The point of the rework. The previous version swept 2.5 turns with easing
   * applied across the whole capture, so the loops smeared together and you
   * could not see two of them. Two exact revolutions, at a constant rate.
   */
  it("completes exactly two revolutions before pushing through", () => {
    const atDiveStart = captureTurnsSwept(0.62);
    expect(atDiveStart).toBeCloseTo(APPROACH_TURNS, 6);
    expect(APPROACH_TURNS).toBe(2);
  });

  it("sweeps the approach at a constant rate, so the circles are countable", () => {
    // Equal slices of approach progress must cover equal angle.
    const quarter = captureTurnsSwept(0.62 * 0.25);
    const half = captureTurnsSwept(0.62 * 0.5);
    const threeQuarters = captureTurnsSwept(0.62 * 0.75);
    expect(quarter).toBeCloseTo(0.5, 6);
    expect(half).toBeCloseTo(1, 6);
    expect(threeQuarters).toBeCloseTo(1.5, 6);
  });

  it("crosses each of the two full turns exactly once", () => {
    const crossings = [1, 2].map((turn) => {
      let count = 0;
      let prev = captureTurnsSwept(0);
      for (let i = 1; i <= 2000; i++) {
        const cur = captureTurnsSwept(i / 2000);
        if (prev < turn && cur >= turn) count++;
        prev = cur;
      }
      return count;
    });
    expect(crossings).toEqual([1, 1]);
  });

  /**
   * "Progressively closer" has to hold across both loops, not merely on
   * average — otherwise the second pass could sit further out than the first.
   */
  it("tightens monotonically for the whole approach", () => {
    let prev = Infinity;
    for (let i = 0; i <= 620; i++) {
      const r = captureRadiusScale((i / 1000));
      expect(r).toBeLessThanOrEqual(prev + 1e-9);
      prev = r;
    }
  });

  /**
   * Each revolution must close in by the same amount. An eased approach is
   * monotonic but front-loads the shrink — the first version had the radius
   * down to ~1.03 a third of the way in, leaving the second loop running at a
   * flat radius, which does not read as "still getting closer".
   */
  it("spends the same shrink on each of the two revolutions", () => {
    const start = captureRadiusScale(0);
    const afterFirst = captureRadiusScale(0.31);
    const afterSecond = captureRadiusScale(0.6199);
    const firstLoop = start - afterFirst;
    const secondLoop = afterFirst - afterSecond;
    expect(firstLoop).toBeGreaterThan(0.2);
    expect(secondLoop).toBeCloseTo(firstLoop, 2);
  });

  it("starts outside the ring and reaches it by the dive", () => {
    expect(captureRadiusScale(0)).toBeGreaterThan(1.5);
    expect(captureRadiusScale(0.619)).toBeLessThan(1);
  });
});

describe("pushing through the pack", () => {
  it("passes through exactly zero radius — through, not across", () => {
    const samples = trajectory(2000).map((s) => captureRadiusScale(s.p));
    expect(Math.min(...samples)).toBeLessThan(0.01);
  });

  it("reaches the centre of the pack", () => {
    const closest = Math.min(
      ...trajectory(2000).map((s) => Math.hypot(s.slot.x, s.slot.y)),
    );
    expect(closest).toBeLessThan(2);
  });

  it("shrinks to almost nothing while inside", () => {
    expect(Math.min(...trajectory(800).map((s) => s.slot.scale))).toBeLessThan(0.2);
  });

  it("emerges on the opposite side from where it entered", () => {
    // Half a turn is swept through the pass, so the x sign must flip between
    // the last approach frame and the first fully-emerged one.
    const before = captureSlot(ORBIT, 0.61);
    const after = captureSlot(ORBIT, 0.81);
    expect(Math.sign(before.x)).not.toBe(Math.sign(after.x));
  });

  it("passes behind the pack going in and in front coming out", () => {
    const buried = trajectory(2000).filter((s) => s.slot.scale < 0.3);
    expect(buried.length).toBeGreaterThan(0);
    const midpoint = 0.62 + (0.8 - 0.62) / 2;
    expect(buried.filter((s) => s.p < midpoint).every((s) => s.slot.zIndex < BAG_Z)).toBe(true);
    expect(buried.filter((s) => s.p >= midpoint).every((s) => s.slot.zIndex > BAG_Z)).toBe(true);
  });
});

describe("merging with the ring", () => {
  it("keeps curving after the pass — never a straight line", () => {
    // Angle must keep advancing through the merge, not hold while the radius
    // settles: a fixed angle with a changing radius is a radial straight line.
    const a = captureTurnsSwept(0.82);
    const b = captureTurnsSwept(0.9);
    const c = captureTurnsSwept(0.98);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it("overshoots then eases back, so the settle is elastic", () => {
    const peak = Math.max(
      ...trajectory(2000).filter((s) => s.p > 0.78 && s.p < 0.95).map((s) => captureRadiusScale(s.p)),
    );
    expect(peak).toBeGreaterThan(1);
    expect(captureRadiusScale(1)).toBeCloseTo(1, 6);
  });

  /**
   * The property the whole design rests on: the final capture frame is the
   * steady-orbit frame. If these diverged, every arrival would end with a
   * visible snap as the rAF loop took over.
   */
  it("ends exactly on the steady orbit slot, for any phase", () => {
    for (const phase of [0, 0.13, 0.5, 0.77, 0.99]) {
      const captured = captureSlot(ORBIT, 1, phase);
      const steady = planetSlot(ORBIT, phase);
      expect(captured.x).toBeCloseTo(steady.x, 6);
      expect(captured.y).toBeCloseTo(steady.y, 6);
      expect(captured.scale).toBeCloseTo(steady.scale, 6);
      expect(captured.opacity).toBeCloseTo(steady.opacity, 6);
      expect(captured.zIndex).toBe(steady.zIndex);
    }
  });

  it("unwinds its angle offset to exactly zero", () => {
    expect(captureAngleOffset(1)).toBeCloseTo(0, 6);
    expect(Math.abs(captureAngleOffset(0))).toBeCloseTo(3, 6);
  });
});

describe("the sweep as a whole", () => {
  it("only ever advances — it never doubles back", () => {
    let prev = -Infinity;
    for (let i = 0; i <= 2000; i++) {
      const swept = captureTurnsSwept(i / 2000);
      expect(swept).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = swept;
    }
  });

  it("is clamped outside 0..1", () => {
    expect(captureRadiusScale(-1)).toBe(captureRadiusScale(0));
    expect(captureRadiusScale(2)).toBeCloseTo(captureRadiusScale(1), 6);
    expect(captureTurnsSwept(-5)).toBe(0);
  });

  it("never leaves the stage: no NaN, bounded radius, valid opacity", () => {
    for (const { slot } of trajectory(800)) {
      expect(Number.isFinite(slot.x)).toBe(true);
      expect(Number.isFinite(slot.y)).toBe(true);
      expect(Number.isFinite(slot.scale)).toBe(true);
      expect(slot.opacity).toBeGreaterThanOrEqual(0);
      expect(slot.opacity).toBeLessThanOrEqual(1);
      expect(Math.abs(slot.x)).toBeLessThanOrEqual(ORBIT.radiusX * 2.3);
    }
  });
});

describe("captureProgress", () => {
  it("maps elapsed time onto 0..1 and clamps", () => {
    expect(captureProgress(0)).toBe(0);
    expect(captureProgress(CAPTURE_DURATION_MS / 2)).toBeCloseTo(0.5, 6);
    expect(captureProgress(CAPTURE_DURATION_MS)).toBe(1);
    expect(captureProgress(CAPTURE_DURATION_MS * 10)).toBe(1);
  });

  it("is long enough to actually watch two revolutions", () => {
    // Under about a second per revolution the loops stop being legible.
    expect(CAPTURE_DURATION_MS / APPROACH_TURNS).toBeGreaterThan(1_000);
  });

  it("treats nonsense input as finished rather than animating forever", () => {
    expect(captureProgress(Number.NaN)).toBe(1);
    expect(captureProgress(100, 0)).toBe(1);
  });
});
