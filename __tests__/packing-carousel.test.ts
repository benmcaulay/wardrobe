import { describe, expect, it } from "vitest";
import {
  OPACITY_BACK,
  SCALE_BACK,
  carouselRadius,
  carouselRing,
  carouselSlot,
  frontIndex,
  phaseForIndex,
  shortestPhaseDelta,
  spinVelocity,
  wrapPhase,
} from "@/lib/packing/carousel";

const RING = { radiusX: 300, radiusY: 40 };

describe("carouselSlot", () => {
  it("puts slide 0 at the near point when the phase is zero", () => {
    const slot = carouselSlot(0, 5, RING);
    expect(slot.x).toBeCloseTo(0, 6);
    expect(slot.depth).toBeCloseTo(1, 6);
    expect(slot.scale).toBeCloseTo(1, 6);
    expect(slot.opacity).toBeCloseTo(1, 6);
  });

  it("puts the opposite slide at the far point, behind the front one", () => {
    const slot = carouselSlot(1, 2, RING);
    expect(slot.depth).toBeCloseTo(-1, 6);
    expect(slot.scale).toBeCloseTo(SCALE_BACK, 6);
    expect(slot.opacity).toBeCloseTo(OPACITY_BACK, 6);
    expect(slot.zIndex).toBeLessThan(carouselSlot(0, 2, RING).zIndex);
  });

  it("puts the neighbours out to either side", () => {
    const [, right, left] = carouselRing(3, RING);
    expect(right.x).toBeGreaterThan(0);
    expect(left.x).toBeLessThan(0);
  });

  /** The depth cue the whole effect rests on. */
  it("never draws a further slide larger, brighter or in front of a nearer one", () => {
    const slots = carouselRing(9, { ...RING, phase: 0.07 });
    const sorted = [...slots].sort((a, b) => b.depth - a.depth);
    for (let i = 1; i < sorted.length; i += 1) {
      expect(sorted[i].scale).toBeLessThanOrEqual(sorted[i - 1].scale + 1e-9);
      expect(sorted[i].opacity).toBeLessThanOrEqual(sorted[i - 1].opacity + 1e-9);
      expect(sorted[i].zIndex).toBeLessThanOrEqual(sorted[i - 1].zIndex);
    }
  });

  it("keeps scale and opacity inside their range", () => {
    for (const slot of carouselRing(12, { ...RING, phase: 0.31 })) {
      expect(slot.scale).toBeGreaterThanOrEqual(SCALE_BACK - 1e-9);
      expect(slot.scale).toBeLessThanOrEqual(1 + 1e-9);
      expect(slot.opacity).toBeGreaterThanOrEqual(OPACITY_BACK - 1e-9);
      expect(slot.opacity).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it("stays inside the ring's radius", () => {
    for (const slot of carouselRing(11, { ...RING, phase: 0.4 })) {
      expect(Math.abs(slot.x)).toBeLessThanOrEqual(RING.radiusX + 1e-9);
      expect(Math.abs(slot.y)).toBeLessThanOrEqual(RING.radiusY + 1e-9);
    }
  });

  it("lifts the back of the ring and leaves the front on the baseline", () => {
    expect(carouselSlot(0, 2, RING).y).toBeCloseTo(0, 6);
    expect(carouselSlot(1, 2, RING).y).toBeLessThan(0);
  });

  it("spaces slides evenly", () => {
    const xs = carouselRing(4, RING).map((s) => Number(s.x.toFixed(6)));
    expect(new Set(xs).size).toBeGreaterThan(1);
    // Opposite pairs mirror each other.
    expect(xs[1]).toBeCloseTo(-xs[3], 6);
  });

  it("returns to the start after a full turn", () => {
    const a = carouselSlot(2, 7, { ...RING, phase: 0.2 });
    const b = carouselSlot(2, 7, { ...RING, phase: 1.2 });
    expect(b.x).toBeCloseTo(a.x, 6);
    expect(b.depth).toBeCloseTo(a.depth, 6);
  });

  it("handles a single slide without dividing by zero", () => {
    const only = carouselSlot(0, 1, RING);
    expect(only.x).toBeCloseTo(0, 6);
    expect(only.scale).toBeCloseTo(1, 6);
  });

  it("returns nothing for an empty ring", () => {
    expect(carouselRing(0, RING)).toEqual([]);
  });
});

describe("phase bookkeeping", () => {
  it("wraps into a single turn", () => {
    expect(wrapPhase(0)).toBe(0);
    expect(wrapPhase(1.25)).toBeCloseTo(0.25, 6);
    expect(wrapPhase(-0.25)).toBeCloseTo(0.75, 6);
    expect(wrapPhase(NaN)).toBe(0);
  });

  it("round-trips an index through its phase", () => {
    for (const count of [1, 2, 5, 11]) {
      for (let i = 0; i < count; i += 1) {
        expect(frontIndex(phaseForIndex(i, count), count)).toBe(i);
      }
    }
  });

  it("reports the nearest slide when the ring is between two", () => {
    // Eleven slides, nudged just past slide 3's phase.
    const phase = phaseForIndex(3, 11) - 0.01;
    expect(frontIndex(phase, 11)).toBe(3);
  });

  it("stays in range for any phase", () => {
    for (const phase of [-3.7, -0.2, 0, 0.5, 2.9]) {
      const i = frontIndex(phase, 6);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(6);
    }
  });
});

describe("shortestPhaseDelta", () => {
  /**
   * Without this, clicking the chip next door can unwind the entire ring the
   * long way round.
   */
  it("takes the short way across the wrap point", () => {
    expect(shortestPhaseDelta(0.9, 0.1)).toBeCloseTo(0.2, 6);
    expect(shortestPhaseDelta(0.1, 0.9)).toBeCloseTo(-0.2, 6);
  });

  it("is plain subtraction well inside the turn", () => {
    expect(shortestPhaseDelta(0.2, 0.5)).toBeCloseTo(0.3, 6);
    expect(shortestPhaseDelta(0.5, 0.2)).toBeCloseTo(-0.3, 6);
  });

  it("is zero for the same phase", () => {
    expect(shortestPhaseDelta(0.4, 0.4)).toBeCloseTo(0, 6);
    expect(shortestPhaseDelta(0.4, 1.4)).toBeCloseTo(0, 6);
  });

  it("never travels more than half a turn", () => {
    for (let a = 0; a < 1; a += 0.07) {
      for (let b = 0; b < 1; b += 0.11) {
        expect(Math.abs(shortestPhaseDelta(a, b))).toBeLessThanOrEqual(0.5 + 1e-9);
      }
    }
  });
});

describe("spinVelocity", () => {
  const width = 1000;

  /** Settling on a look shouldn't require holding the cursor perfectly still. */
  it("is still inside the dead zone", () => {
    expect(spinVelocity(500, width)).toBe(0);
    expect(spinVelocity(540, width)).toBe(0);
    expect(spinVelocity(460, width)).toBe(0);
  });

  it("spins forward when the pointer is right of centre", () => {
    // Advancing to a later slide means a decreasing phase.
    expect(spinVelocity(900, width)).toBeLessThan(0);
    expect(frontIndex(phaseForIndex(0, 8) + spinVelocity(900, width), 8)).not.toBe(7);
  });

  it("spins backward when the pointer is left of centre", () => {
    expect(spinVelocity(100, width)).toBeGreaterThan(0);
  });

  it("goes faster the further out the pointer is", () => {
    const near = Math.abs(spinVelocity(700, width));
    const far = Math.abs(spinVelocity(980, width));
    expect(far).toBeGreaterThan(near);
  });

  it("eases in rather than lurching at the dead-zone edge", () => {
    // Squared response: just past the boundary is a crawl, not a jump.
    const justPast = Math.abs(spinVelocity(500 + 0.2 * 500, width));
    expect(justPast).toBeGreaterThan(0);
    expect(justPast).toBeLessThan(0.03);
  });

  it("caps at the maximum speed", () => {
    for (const x of [-500, 0, 1500, 1000]) {
      expect(Math.abs(spinVelocity(x, width))).toBeLessThanOrEqual(0.35 + 1e-9);
    }
  });

  it("respects custom limits", () => {
    expect(spinVelocity(1000, width, { maxTurnsPerSecond: 1 })).toBeCloseTo(-1, 6);
    expect(spinVelocity(1000, width, { deadZone: 0.99, maxTurnsPerSecond: 1 })).toBeCloseTo(-1, 6);
    expect(spinVelocity(760, width, { deadZone: 0.9 })).toBe(0);
  });

  it("does not blow up on a zero-width container", () => {
    expect(spinVelocity(100, 0)).toBe(0);
    expect(spinVelocity(NaN, width)).toBe(0);
  });
});

describe("carouselRadius", () => {
  it("keeps the ring inside the container", () => {
    expect(carouselRadius({ width: 1200, slideWidth: 400 })).toBeLessThanOrEqual(1200 / 2 - 24);
  });

  /**
   * The falloff is what makes the front slide read as selected. Linear, the
   * nearest neighbours on an eleven-slide ring render at 96% and nothing looks
   * chosen.
   */
  it("separates the front slide from its neighbours", () => {
    const ring = carouselRing(11, RING);
    const neighbour = ring[1];
    expect(neighbour.scale).toBeLessThan(0.9);
    expect(ring[0].scale - neighbour.scale).toBeGreaterThan(0.1);
  });

  it("scales with the slide so neighbours clear the front one", () => {
    const narrow = carouselRadius({ width: 2000, slideWidth: 200 });
    const wide = carouselRadius({ width: 2000, slideWidth: 400 });
    expect(wide).toBeGreaterThan(narrow);
  });

  it("stays usable in a tiny container", () => {
    expect(carouselRadius({ width: 10, slideWidth: 10 })).toBeGreaterThan(0);
  });
});
