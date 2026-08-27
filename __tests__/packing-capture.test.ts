import { describe, expect, it } from "vitest";
import {
  APPROACH_TURNS,
  CAPTURE_DURATION_MS,
  captureProgress,
  captureSlot,
  captureStartFromPoint,
  captureSweepTurns,
  orbitFor,
  planetSlot,
} from "@/lib/packing/orbit";

const ORBIT = orbitFor("item:capture-test", { maxRadiusX: 200, maxRadiusY: 68 });

/** Start on the ring itself, for the cases that do not care about the drop. */
const ON_RING = { turns: ORBIT.offset, radiusScale: 1 };

function trajectory(start = ON_RING, steps = 400, endPhase = 0) {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const p = i / steps;
    return { p, slot: captureSlot(ORBIT, p, start, endPhase) };
  });
}

describe("captureStartFromPoint", () => {
  /**
   * The whole point of the rework: the animation begins where the piece was
   * released. Previously it began at a fixed radius on the ellipse, so a piece
   * dropped near the bag teleported outward before starting its approach.
   */
  it("starts exactly at the release point", () => {
    for (const [dx, dy] of [
      [120, -40],
      [-80, 30],
      [0, -68],
      [200, 0],
      [-15, -7],
    ] as const) {
      const start = captureStartFromPoint(ORBIT, dx, dy);
      const first = captureSlot(ORBIT, 0, start);
      expect(first.x).toBeCloseTo(dx, 6);
      expect(first.y).toBeCloseTo(dy, 6);
    }
  });

  /**
   * The orbit is a squashed ellipse, so the angle has to be derived in the
   * orbit's own normalised space. Treating it as a circle would start the item
   * at the wrong angle and make the first loop lurch to correct.
   */
  it("accounts for the ellipse rather than treating it as a circle", () => {
    // A point straight out to the side is a quarter turn round; straight up is
    // the top of the ellipse regardless of how squashed it is vertically.
    const side = captureStartFromPoint(ORBIT, ORBIT.radiusX, 0);
    expect(side.radiusScale).toBeCloseTo(1, 6);
    expect(side.turns).toBeCloseTo(0.25, 6);

    const top = captureStartFromPoint(ORBIT, 0, -ORBIT.radiusY);
    expect(top.radiusScale).toBeCloseTo(1, 6);
    expect(Math.abs(top.turns)).toBeCloseTo(0, 6);
  });

  it("reports how far out the release was, in ring multiples", () => {
    expect(captureStartFromPoint(ORBIT, ORBIT.radiusX * 2, 0).radiusScale).toBeCloseTo(2, 6);
    expect(captureStartFromPoint(ORBIT, ORBIT.radiusX / 2, 0).radiusScale).toBeCloseTo(0.5, 6);
  });

  it("survives a release on the exact centre", () => {
    const start = captureStartFromPoint(ORBIT, 0, 0);
    expect(Number.isFinite(start.turns)).toBe(true);
    expect(start.radiusScale).toBe(0);
    // And the slot it produces is still finite rather than NaN.
    const slot = captureSlot(ORBIT, 0, start);
    expect(Number.isFinite(slot.x)).toBe(true);
    expect(Number.isFinite(slot.y)).toBe(true);
  });
});

describe("two circles, then done", () => {
  it("sweeps about two turns from any release point", () => {
    for (const [dx, dy] of [
      [120, -40],
      [-300, 90],
      [10, 5],
      [-200, -60],
    ] as const) {
      const start = captureStartFromPoint(ORBIT, dx, dy);
      const sweep = captureSweepTurns(ORBIT, start, 0);
      // Two turns plus the fraction needed to land on the orbit angle, which is
      // always within half a turn either way.
      expect(Math.abs(sweep - APPROACH_TURNS)).toBeLessThanOrEqual(0.5 + 1e-9);
    }
  });

  it("is two turns, not three or one", () => {
    expect(APPROACH_TURNS).toBe(2);
  });

  it("advances at a constant rate, so the circles are countable", () => {
    const start = captureStartFromPoint(ORBIT, 150, -50);
    const sweep = captureSweepTurns(ORBIT, start, 0);
    // Equal slices of progress cover equal angle.
    const angleAt = (p: number) => start.turns + sweep * p;
    const d1 = angleAt(0.25) - angleAt(0);
    const d2 = angleAt(0.5) - angleAt(0.25);
    const d3 = angleAt(1) - angleAt(0.75);
    expect(d2).toBeCloseTo(d1, 9);
    expect(d3).toBeCloseTo(d1, 9);
  });

  it("closes on the ring by the same amount each loop", () => {
    const start = captureStartFromPoint(ORBIT, ORBIT.radiusX * 2, 0);
    const dist = (p: number) => {
      const s = captureSlot(ORBIT, p, start);
      // Radius multiple, recovered from the slot.
      return Math.hypot(s.x / ORBIT.radiusX, s.y / ORBIT.radiusY);
    };
    const firstLoop = dist(0) - dist(0.5);
    const secondLoop = dist(0.5) - dist(1);
    expect(firstLoop).toBeGreaterThan(0.2);
    expect(secondLoop).toBeCloseTo(firstLoop, 6);
  });

  it("never passes through the pack — that phase is gone", () => {
    // Released on the ring, it should stay on the ring the whole way, so the
    // distance from centre never collapses.
    const closest = Math.min(
      ...trajectory(ON_RING, 800).map((s) => Math.hypot(s.slot.x / ORBIT.radiusX, s.slot.y / ORBIT.radiusY)),
    );
    expect(closest).toBeCloseTo(1, 6);
  });

  /**
   * The property everything rests on: the final capture frame is the
   * steady-orbit frame, so the handoff to the rAF loop cannot jump.
   */
  it("ends exactly on the steady orbit slot, for any phase and any release", () => {
    for (const phase of [0, 0.13, 0.5, 0.77, 0.99]) {
      for (const [dx, dy] of [
        [120, -40],
        [-260, 70],
        [3, -2],
      ] as const) {
        const start = captureStartFromPoint(ORBIT, dx, dy);
        const captured = captureSlot(ORBIT, 1, start, phase);
        const steady = planetSlot(ORBIT, phase);
        expect(captured.x).toBeCloseTo(steady.x, 6);
        expect(captured.y).toBeCloseTo(steady.y, 6);
        expect(captured.scale).toBeCloseTo(steady.scale, 6);
        expect(captured.opacity).toBeCloseTo(steady.opacity, 6);
        expect(captured.zIndex).toBe(steady.zIndex);
      }
    }
  });

  it("stays finite and on-screen throughout", () => {
    const start = captureStartFromPoint(ORBIT, -400, 120);
    for (const { slot } of trajectory(start, 800)) {
      expect(Number.isFinite(slot.x)).toBe(true);
      expect(Number.isFinite(slot.y)).toBe(true);
      expect(slot.opacity).toBeGreaterThanOrEqual(0);
      expect(slot.opacity).toBeLessThanOrEqual(1);
      // Radius only ever shrinks toward the ring, so it cannot exceed the start.
      expect(Math.hypot(slot.x / ORBIT.radiusX, slot.y / ORBIT.radiusY)).toBeLessThanOrEqual(
        start.radiusScale + 1e-9,
      );
    }
  });
});

describe("captureProgress", () => {
  it("runs for two seconds", () => {
    expect(CAPTURE_DURATION_MS).toBe(2_000);
  });

  it("maps elapsed time onto 0..1 and clamps", () => {
    expect(captureProgress(0)).toBe(0);
    expect(captureProgress(1_000)).toBeCloseTo(0.5, 6);
    expect(captureProgress(2_000)).toBe(1);
    expect(captureProgress(20_000)).toBe(1);
  });

  it("treats nonsense input as finished rather than animating forever", () => {
    expect(captureProgress(Number.NaN)).toBe(1);
    expect(captureProgress(100, 0)).toBe(1);
  });
});
