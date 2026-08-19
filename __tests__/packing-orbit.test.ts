import { describe, expect, it } from "vitest";
import {
  BAG_Z,
  ORBIT_PERIOD_MS,
  orbitFor,
  orbitRadii,
  orbitSystem,
  phaseAt,
  planetOrbits,
  planetSlot,
} from "@/lib/packing/orbit";
import {
  BAG_PANEL_PREFIX,
  PANEL_DEFAULTS,
  isPanelOpen,
  parsePanelState,
  serializePanelState,
  togglePanel,
} from "@/lib/packing/panel-state";

const SPACE = { maxRadiusX: 240, maxRadiusY: 80 };
const keys = (n: number) => Array.from({ length: n }, (_, i) => `item:clx${i}abc`);

describe("orbitFor", () => {
  it("is a pure function of the key", () => {
    expect(orbitFor("item:abc", SPACE)).toEqual(orbitFor("item:abc", SPACE));
    expect(orbitFor("item:abc", SPACE)).not.toEqual(orbitFor("item:xyz", SPACE));
  });

  it("keeps every orbit clear of the bag and inside the box", () => {
    for (const key of keys(40)) {
      const orbit = orbitFor(key, SPACE);
      expect(orbit.radiusX).toBeGreaterThanOrEqual(SPACE.maxRadiusX * 0.46 - 1e-9);
      expect(orbit.radiusX).toBeLessThanOrEqual(SPACE.maxRadiusX + 1e-9);
      expect(orbit.offset).toBeGreaterThanOrEqual(0);
      expect(orbit.offset).toBeLessThan(1);
    }
  });

  /**
   * `phaseAt` wraps to [0,1), which only stays continuous if no orbit is faster
   * than the base period. A speed above 1 would make that item jump on wrap.
   */
  it("never runs an orbit faster than the base period", () => {
    for (const key of keys(60)) {
      const orbit = orbitFor(key, SPACE);
      expect(orbit.speed).toBeGreaterThan(0);
      expect(orbit.speed).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it("slows the orbits that sit further out", () => {
    const sorted = keys(30)
      .map((k) => orbitFor(k, SPACE))
      .sort((a, b) => a.radiusX - b.radiusX);
    for (let i = 1; i < sorted.length; i += 1) {
      expect(sorted[i].speed).toBeLessThanOrEqual(sorted[i - 1].speed + 1e-9);
    }
  });

  it("gives different keys different orbits rather than stacking them", () => {
    const radii = keys(20).map((k) => orbitFor(k, SPACE).radiusX);
    expect(new Set(radii.map((r) => r.toFixed(3))).size).toBe(20);
  });

  it("varies the tilt so orbits aren't identical concentric ellipses", () => {
    const ratios = keys(12).map((k) => {
      const o = orbitFor(k, SPACE);
      return (o.radiusY / o.radiusX).toFixed(4);
    });
    expect(new Set(ratios).size).toBeGreaterThan(1);
  });
});

describe("planetOrbits", () => {
  it("returns one orbit per key, in order", () => {
    expect(planetOrbits([], SPACE)).toEqual([]);
    expect(planetOrbits(keys(5), SPACE)).toHaveLength(5);
    expect(planetOrbits(["a", "b"], SPACE)).toEqual([orbitFor("a", SPACE), orbitFor("b", SPACE)]);
  });

  /**
   * The reason orbits are keyed by item at all. These used to be derived from
   * index and count, so packing one thing re-derived every other orbit and the
   * whole system lurched.
   */
  it("leaves every existing orbit untouched when an item is added", () => {
    const before = planetOrbits(["a", "b", "c"], SPACE);
    const after = planetOrbits(["a", "b", "c", "d"], SPACE);
    expect(after.slice(0, 3)).toEqual(before);
  });

  it("leaves every surviving orbit untouched when an item is removed", () => {
    const before = planetOrbits(["a", "b", "c", "d"], SPACE);
    const after = planetOrbits(["a", "c", "d"], SPACE);
    expect(after).toEqual([before[0], before[2], before[3]]);
  });

  it("does not depend on the order the items happen to arrive in", () => {
    const forward = planetOrbits(["a", "b", "c"], SPACE);
    const shuffled = planetOrbits(["c", "a", "b"], SPACE);
    expect(shuffled).toEqual([forward[2], forward[0], forward[1]]);
  });

  it("is deterministic, so server and client agree on the first frame", () => {
    expect(planetOrbits(keys(7), SPACE)).toEqual(planetOrbits(keys(7), SPACE));
  });
});

describe("planetSlot", () => {
  const orbit = { radiusX: 200, radiusY: 68, speed: 1, offset: 0 };

  it("starts at the back, behind the bag, small and faint", () => {
    const slot = planetSlot(orbit, 0);
    expect(slot.y).toBeCloseTo(-orbit.radiusY, 6);
    expect(slot.inFront).toBe(false);
    expect(slot.zIndex).toBeLessThan(BAG_Z);
    expect(slot.scale).toBeCloseTo(0.6, 6);
    expect(slot.opacity).toBeCloseTo(0.35, 6);
  });

  it("comes to the front half a turn later", () => {
    const slot = planetSlot(orbit, 0.5);
    expect(slot.y).toBeCloseTo(orbit.radiusY, 6);
    expect(slot.inFront).toBe(true);
    expect(slot.zIndex).toBeGreaterThan(BAG_Z);
    expect(slot.scale).toBeCloseTo(1, 6);
    expect(slot.opacity).toBeCloseTo(0.85, 6);
  });

  /** Legible at the near side, still receding at the far side. */
  it("stays inside the opacity range", () => {
    for (let phase = 0; phase < 1; phase += 0.05) {
      const slot = planetSlot(orbit, phase);
      expect(slot.opacity).toBeGreaterThanOrEqual(0.35 - 1e-9);
      expect(slot.opacity).toBeLessThanOrEqual(0.85 + 1e-9);
    }
  });

  it("stays inside its own ellipse", () => {
    for (let phase = 0; phase < 1; phase += 0.037) {
      const slot = planetSlot(orbit, phase);
      expect(Math.abs(slot.x)).toBeLessThanOrEqual(orbit.radiusX + 1e-9);
      expect(Math.abs(slot.y)).toBeLessThanOrEqual(orbit.radiusY + 1e-9);
    }
  });

  it("returns to the same place after a full revolution", () => {
    const a = planetSlot(orbit, 0.2);
    const b = planetSlot(orbit, 1.2);
    expect(b.x).toBeCloseTo(a.x, 6);
    expect(b.y).toBeCloseTo(a.y, 6);
  });

  it("respects its own speed and offset", () => {
    const slow = { ...orbit, speed: 0.5 };
    expect(planetSlot(slow, 1).x).toBeCloseTo(planetSlot(orbit, 0.5).x, 6);
    const shifted = { ...orbit, offset: 0.25 };
    expect(planetSlot(shifted, 0).x).toBeCloseTo(planetSlot(orbit, 0.25).x, 6);
  });
});

describe("orbitSystem", () => {
  /**
   * The depth cue only works if it's consistent: nothing at the back may be
   * drawn larger, brighter or above anything at the front. Stated as a
   * partition rather than a per-item threshold, because an item exactly at the
   * side of its orbit sits where `cos` returns 6e-17 and epsilons flip.
   */
  it("never draws a back item larger, brighter or nearer than a front one", () => {
    const slots = orbitSystem(keys(9), { ...SPACE, phase: 0.07 });
    const front = slots.filter((s) => s.inFront);
    const back = slots.filter((s) => !s.inFront);
    expect(front.length).toBeGreaterThan(0);
    expect(back.length).toBeGreaterThan(0);

    expect(Math.min(...front.map((s) => s.scale))).toBeGreaterThanOrEqual(
      Math.max(...back.map((s) => s.scale)) - 1e-9,
    );
    expect(Math.min(...front.map((s) => s.opacity))).toBeGreaterThanOrEqual(
      Math.max(...back.map((s) => s.opacity)) - 1e-9,
    );
    expect(Math.min(...front.map((s) => s.zIndex))).toBeGreaterThanOrEqual(
      Math.max(...back.map((s) => s.zIndex)),
    );
  });

  it("drifts items relative to each other rather than moving them in lockstep", () => {
    const gap = (phase: number) => {
      const [a, b] = orbitSystem(["a", "b"], { ...SPACE, phase });
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    expect(Math.abs(gap(0) - gap(0.3))).toBeGreaterThan(1);
  });

  it("returns one slot per item", () => {
    expect(orbitSystem([], SPACE)).toEqual([]);
    expect(orbitSystem(keys(4), SPACE)).toHaveLength(4);
  });

  /** An added item must not move the ones already in flight. */
  it("holds every other item still across an addition", () => {
    const at = (ks: string[]) => orbitSystem(ks, { ...SPACE, phase: 0.42 });
    const before = at(["a", "b", "c"]);
    const after = at(["a", "b", "c", "d"]);
    expect(after.slice(0, 3)).toEqual(before);
  });
});

describe("phaseAt", () => {
  it("wraps to a single turn", () => {
    expect(phaseAt(0)).toBe(0);
    expect(phaseAt(ORBIT_PERIOD_MS / 4)).toBeCloseTo(0.25, 6);
    expect(phaseAt(ORBIT_PERIOD_MS)).toBeCloseTo(0, 6);
    expect(phaseAt(ORBIT_PERIOD_MS * 3.5)).toBeCloseTo(0.5, 6);
  });

  it("stays in range over a very long session", () => {
    const p = phaseAt(ORBIT_PERIOD_MS * 100_000 + 1234);
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThan(1);
  });

  it("does not blow up on nonsense input", () => {
    expect(phaseAt(NaN)).toBe(0);
    expect(phaseAt(1000, 0)).toBe(0);
  });
});

describe("orbitRadii", () => {
  it("keeps the widest orbit inside the box", () => {
    const { maxRadiusX, maxRadiusY } = orbitRadii({ width: 600, height: 420, itemHalf: 28 });
    expect(maxRadiusX + 28).toBeLessThanOrEqual(300);
    // Allow for the steepest tilt orbitFor can pick.
    expect(maxRadiusY * 1.12 + 28).toBeLessThanOrEqual(210 + 1e-9);
  });

  it("squashes the system so it reads as seen from above", () => {
    const { maxRadiusX, maxRadiusY } = orbitRadii({ width: 600, height: 420, itemHalf: 28 });
    expect(maxRadiusY).toBeLessThan(maxRadiusX / 2);
  });

  it("stays positive in a container too small to lay out properly", () => {
    const { maxRadiusX, maxRadiusY } = orbitRadii({ width: 40, height: 30, itemHalf: 28 });
    expect(maxRadiusX).toBeGreaterThan(0);
    expect(maxRadiusY).toBeGreaterThan(0);
  });
});

describe("panel state", () => {
  it("falls back to the defaults with nothing stored", () => {
    expect(parsePanelState(null)).toEqual(PANEL_DEFAULTS);
    expect(parsePanelState("")).toEqual(PANEL_DEFAULTS);
  });

  it("survives corrupt storage rather than taking the page down", () => {
    for (const raw of ["{", "null", "[]", '"nope"', "123"]) {
      expect(parsePanelState(raw)).toEqual(PANEL_DEFAULTS);
    }
  });

  it("applies stored values over the defaults", () => {
    const state = parsePanelState(JSON.stringify({ bags: false }));
    expect(state.bags).toBe(false);
    expect(state.gear).toBe(true);
  });

  it("ignores unknown sections and non-boolean values", () => {
    const state = parsePanelState(JSON.stringify({ ghosts: false, bags: "no", gear: 0 }));
    expect(state).toEqual(PANEL_DEFAULTS);
    expect("ghosts" in state).toBe(false);
  });

  it("round-trips through storage", () => {
    const state = togglePanel(parsePanelState(null), "bags");
    expect(parsePanelState(serializePanelState(state))).toEqual(state);
  });

  it("writes only known sections", () => {
    const written = JSON.parse(serializePanelState({ ...PANEL_DEFAULTS, ghosts: false }));
    expect("ghosts" in written).toBe(false);
  });

  it("toggles both ways", () => {
    let state = parsePanelState(null);
    expect(isPanelOpen(state, "gear")).toBe(true);
    state = togglePanel(state, "gear");
    expect(isPanelOpen(state, "gear")).toBe(false);
    state = togglePanel(state, "gear");
    expect(isPanelOpen(state, "gear")).toBe(true);
  });

  it("treats an unknown section as open", () => {
    expect(isPanelOpen({}, "brand-new-section")).toBe(true);
  });

  /**
   * There's one panel per bag and bag ids aren't known ahead of time, so they
   * can't be enumerated in the defaults — they're namespaced instead. The
   * unknown-key filter has to let them through or a folded bag springs back
   * open on every reload.
   */
  describe("bag panels", () => {
    const id = `${BAG_PANEL_PREFIX}clx123abc`;

    it("defaults a bag to open", () => {
      expect(isPanelOpen(parsePanelState(null), id)).toBe(true);
    });

    it("keeps a collapsed bag collapsed across a reload", () => {
      const collapsed = togglePanel(parsePanelState(null), id);
      expect(isPanelOpen(collapsed, id)).toBe(false);
      const reloaded = parsePanelState(serializePanelState(collapsed));
      expect(isPanelOpen(reloaded, id)).toBe(false);
    });

    it("stores bag panels alongside the fixed sections", () => {
      const state = togglePanel(togglePanel(parsePanelState(null), "bags"), id);
      const written = JSON.parse(serializePanelState(state));
      expect(written.bags).toBe(false);
      expect(written[id]).toBe(false);
    });

    it("still rejects keys that are neither a known section nor a bag", () => {
      const state = parsePanelState(JSON.stringify({ "ghost:1": false, [id]: false }));
      expect("ghost:1" in state).toBe(false);
      expect(state[id]).toBe(false);
    });
  });
});
