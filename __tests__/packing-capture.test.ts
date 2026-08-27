import { describe, expect, it } from "vitest";
import {
  BAG_Z,
  CAPTURE_DURATION_MS,
  captureAngleOffset,
  captureProgress,
  captureRadiusScale,
  captureSlot,
  orbitFor,
  planetSlot,
} from "@/lib/packing/orbit";

const ORBIT = orbitFor("item:capture-test", { maxRadiusX: 200, maxRadiusY: 68 });

/** Samples across the whole capture, for scanning the trajectory. */
function trajectory(steps = 200, phase = 0) {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const p = i / steps;
    return { p, slot: captureSlot(ORBIT, p, phase) };
  });
}

describe("captureRadiusScale", () => {
  it("starts wide, outside the final orbit", () => {
    expect(captureRadiusScale(0)).toBeGreaterThan(1.5);
  });

  it("passes through exactly zero — the item goes into the bag, not past it", () => {
    const samples = trajectory(400).map((s) => captureRadiusScale(s.p));
    expect(Math.min(...samples)).toBeLessThan(0.02);
  });

  it("returns to the orbit radius by the end", () => {
    expect(captureRadiusScale(1)).toBeCloseTo(1, 6);
  });

  it("overshoots on the way out, so the settle is elastic", () => {
    const afterDive = trajectory(400).filter((s) => s.p > 0.75 && s.p < 0.9);
    const peak = Math.max(...afterDive.map((s) => captureRadiusScale(s.p)));
    expect(peak).toBeGreaterThan(1);
  });

  it("is clamped outside 0..1", () => {
    expect(captureRadiusScale(-1)).toBe(captureRadiusScale(0));
    expect(captureRadiusScale(2)).toBeCloseTo(captureRadiusScale(1), 6);
  });
});

describe("captureAngleOffset", () => {
  it("circles several times before settling", () => {
    // Total sweep is the offset it has to unwind, in turns.
    expect(Math.abs(captureAngleOffset(0))).toBeGreaterThanOrEqual(2.5);
  });

  it("unwinds to zero so the item lands on its true orbit angle", () => {
    expect(captureAngleOffset(1)).toBeCloseTo(0, 6);
  });

  it("advances monotonically — it never doubles back", () => {
    const samples = trajectory(200).map((s) => captureAngleOffset(s.p));
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1] - 1e-9);
    }
  });
});

describe("captureSlot", () => {
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

  it("starts further from the centre than it finishes", () => {
    const start = captureSlot(ORBIT, 0);
    const end = captureSlot(ORBIT, 1);
    const dist = (s: { x: number; y: number }) => Math.hypot(s.x, s.y);
    expect(dist(start)).toBeGreaterThan(dist(end));
  });

  it("reaches the bag's centre mid-flight", () => {
    const closest = Math.min(
      ...trajectory(400).map((s) => Math.hypot(s.slot.x, s.slot.y)),
    );
    expect(closest).toBeLessThan(4);
  });

  it("shrinks to almost nothing while inside the bag", () => {
    const smallest = Math.min(...trajectory(400).map((s) => s.slot.scale));
    expect(smallest).toBeLessThan(0.2);
  });

  it("passes behind the bag going in and in front coming out", () => {
    const samples = trajectory(400);
    const buried = samples.filter((s) => s.slot.scale < 0.3);
    expect(buried.length).toBeGreaterThan(0);
    const entering = buried.filter((s) => s.p < 0.72);
    const exiting = buried.filter((s) => s.p >= 0.72);
    expect(entering.every((s) => s.slot.zIndex < BAG_Z)).toBe(true);
    expect(exiting.every((s) => s.slot.zIndex > BAG_Z)).toBe(true);
  });

  it("emerges on the opposite side from where it entered", () => {
    // Half a turn is baked into the angle offset, so the x sign must flip
    // between the last frame before the dive and the first frame after it.
    const before = captureSlot(ORBIT, 0.54);
    const after = captureSlot(ORBIT, 0.86);
    expect(Math.sign(before.x)).not.toBe(Math.sign(after.x));
  });

  it("never leaves the stage: no NaN, and radius stays bounded", () => {
    for (const { slot } of trajectory(400)) {
      expect(Number.isFinite(slot.x)).toBe(true);
      expect(Number.isFinite(slot.y)).toBe(true);
      expect(Number.isFinite(slot.scale)).toBe(true);
      expect(slot.opacity).toBeGreaterThanOrEqual(0);
      expect(slot.opacity).toBeLessThanOrEqual(1);
      expect(Math.abs(slot.x)).toBeLessThanOrEqual(ORBIT.radiusX * 2.2);
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

  it("treats nonsense input as finished rather than animating forever", () => {
    expect(captureProgress(Number.NaN)).toBe(1);
    expect(captureProgress(100, 0)).toBe(1);
  });
});
