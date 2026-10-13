/**
 * The packed items orbiting the bag in Pack mode.
 *
 * Every item gets its own orbit rather than a slot on one shared ring: its own
 * radius, its own tilt, its own starting angle, and — like planets — its own
 * speed, with the outer ones slower. A single ring reads as a carousel and all
 * the items move in lockstep; a system of orbits reads as a system, and the
 * constant relative drift means the arrangement never looks static even though
 * nothing is random.
 *
 * Deterministic on purpose. No `Math.random`, so the server and the client
 * agree on the first frame and these positions can be tested exactly.
 *
 * Everything is decided here so the component only writes transforms, and the
 * depth illusion — small, faint and behind the bag at the back; larger, clearer
 * and in front at the near side — can be checked without a browser.
 */

/** Time for the innermost orbit to complete one revolution. */
export const ORBIT_PERIOD_MS = 26_000;

/** The bag's own stacking index. Items straddle it. */
export const BAG_Z = 100;

/**
 * Opacity range. Still weighted so the far side recedes, but high enough that
 * you can actually recognise a garment on the near side — the depth cue is
 * worth having, the near-invisibility that came with it wasn't.
 */
const OPACITY_BACK = 0.35;
const OPACITY_FRONT = 0.85;

const SCALE_BACK = 0.6;
const SCALE_FRONT = 1;

/** Innermost orbit as a fraction of the available radius, so the bag stays clear. */
const INNER_RADIUS_FRACTION = 0.46;

export type PlanetOrbit = {
  radiusX: number;
  radiusY: number;
  /** Revolutions per base period. Outer orbits are slower. */
  speed: number;
  /** Starting angle, in turns. */
  offset: number;
};

export type OrbitSlot = {
  /** Offset from the system's centre, in px. */
  x: number;
  y: number;
  scale: number;
  opacity: number;
  /** Above `BAG_Z` draws in front of the bag, below it behind. */
  zIndex: number;
  /** True in the near half of the orbit. */
  inFront: boolean;
};

/**
 * A stable number in [0,1) for a string. FNV-1a, salted so one key can yield
 * several independent values.
 */
function hash01(key: string, salt: number): number {
  let h = (2166136261 ^ salt) >>> 0;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h >>> 8) / 0x1000000;
}

/**
 * The orbit belonging to one item, derived from its identity alone.
 *
 * This used to be a function of the item's index and the total count, which
 * meant packing or removing anything re-derived every other orbit: the whole
 * system lurched as radii and start angles were reassigned. Keying off the item
 * makes each orbit a property of the thing itself, so adding a jacket drops a
 * new body into the system and leaves every existing one exactly where it was.
 *
 * Radii are continuous rather than snapped to rings on purpose. Two items that
 * land close together also get near-identical Kepler speeds only if their radii
 * are near-identical — and because the speeds still differ slightly, any
 * overlap drifts apart on its own instead of persisting.
 */
export function orbitFor(
  key: string,
  options: { maxRadiusX: number; maxRadiusY: number },
): PlanetOrbit {
  const spread = INNER_RADIUS_FRACTION + (1 - INNER_RADIUS_FRACTION) * hash01(key, 1);
  // 0.88–1.12, so neighbouring orbits sit at visibly different tilts without
  // any of them collapsing to a flat line.
  const tilt = 0.88 + hash01(key, 2) * 0.24;
  return {
    radiusX: options.maxRadiusX * spread,
    radiusY: options.maxRadiusY * spread * tilt,
    speed: Math.pow(INNER_RADIUS_FRACTION / spread, 1.5),
    offset: hash01(key, 3),
  };
}

/** One orbit per item, in the order given. */
export function planetOrbits(
  keys: readonly string[],
  options: { maxRadiusX: number; maxRadiusY: number },
): PlanetOrbit[] {
  return keys.map((key) => orbitFor(key, options));
}

/** Where a planet is at a given phase. `phase` is turns, not radians. */
export function planetSlot(orbit: PlanetOrbit, phase = 0): OrbitSlot {
  const angle = (phase * orbit.speed + orbit.offset) * Math.PI * 2;

  // depth: +1 nearest the viewer, -1 furthest.
  const depth = -Math.cos(angle);
  const t = (depth + 1) / 2;

  return {
    x: Math.sin(angle) * orbit.radiusX,
    y: depth * orbit.radiusY,
    scale: SCALE_BACK + (SCALE_FRONT - SCALE_BACK) * t,
    opacity: OPACITY_BACK + (OPACITY_FRONT - OPACITY_BACK) * t,
    // Rounded so the value is stable frame to frame; a z-index that churns
    // makes the compositor restack on every tick.
    zIndex: BAG_Z + Math.round(depth * 50),
    inFront: depth >= 0,
  };
}

/** Every planet's position at once. */
export function orbitSystem(
  keys: readonly string[],
  options: { maxRadiusX: number; maxRadiusY: number; phase?: number },
): OrbitSlot[] {
  return planetOrbits(keys, options).map((orbit) => planetSlot(orbit, options.phase ?? 0));
}

/**
 * Phase for a timestamp, wrapped to [0,1) so the number stays small over a long
 * session rather than growing until float precision starts to stutter.
 *
 * Wrapping is only safe because every `speed` is ≤ 1: a faster orbit would jump
 * when the base phase wrapped. Speed is `(INNER / spread) ** 1.5` and `spread`
 * is never below `INNER`, so that holds for every possible key.
 */
export function phaseAt(elapsedMs: number, periodMs = ORBIT_PERIOD_MS): number {
  if (!Number.isFinite(elapsedMs) || periodMs <= 0) return 0;
  const turns = elapsedMs / periodMs;
  return turns - Math.floor(turns);
}

/**
 * How much room the system has inside its container.
 *
 * Both radii come from the box rather than being fixed, and the vertical one is
 * squashed to about a third so the orbits read as seen from slightly above
 * rather than head-on.
 */
/**
 * How big to draw the bag and its orbiting pieces for a stage of this size.
 *
 * These used to be fixed at 192px and 56px, which meant the system stayed the
 * same size whether it had a quarter of a laptop screen or the whole of one —
 * a small bag marooned in white space, and the only way to make it legible was
 * to zoom the browser, which blew the controls up with it.
 *
 * Driven by the stage's *smaller* side, so a wide-but-short window grows the
 * artwork no further than it has headroom for. Clamped at both ends: below the
 * floor the bag stops reading as a bag, and above the ceiling it crowds the
 * orbit it is supposed to sit inside.
 */
export function stageArtSizes(box: { width: number; height: number }): {
  bag: number;
  item: number;
} {
  const shortest = Math.min(box.width, box.height);
  // Before the stage has been measured, fall back to the old fixed pair rather
  // than to zero — the first frame should look like the old one, not empty.
  if (!Number.isFinite(shortest) || shortest <= 0) return { bag: 192, item: 56 };

  const bag = Math.round(Math.min(420, Math.max(176, shortest * 0.52)));
  // Proportional to the bag so the system keeps its proportions as it grows,
  // but it climbs more slowly: the pieces are read individually and oversized
  // thumbnails start colliding on the near side of the orbit.
  const item = Math.round(Math.min(104, Math.max(52, bag * 0.28)));
  return { bag, item };
}

export function orbitRadii(box: {
  width: number;
  height: number;
  /** Half the width of one orbiting thumbnail, so it can't clip the edge. */
  itemHalf: number;
}): { maxRadiusX: number; maxRadiusY: number } {
  const maxRadiusX = Math.max(60, box.width / 2 - box.itemHalf - 8);
  // The steepest tilt `orbitFor` can pick is 1.12, and it has to fit too.
  const room = Math.max(24, box.height / 2 - box.itemHalf - 8);
  return { maxRadiusX, maxRadiusY: Math.min(maxRadiusX * 0.34, room / 1.12) };
}
