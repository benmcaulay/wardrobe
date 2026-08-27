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

// -----------------------------------------------------------------------------
// Capture: how a newly packed item joins the system
// -----------------------------------------------------------------------------

/**
 * A dropped item spirals into its orbit from wherever it was released.
 *
 * It starts at the release point — the actual pointer position, converted into
 * this system's coordinates — circles twice while closing on the ring, and is
 * done. No pass through the bag, no separate merge: two turns and it is running
 * its orbit.
 *
 * Starting from the drop point is the part that makes it read as *this* item
 * arriving rather than a generic flourish, and it is why the start is a
 * parameter instead of a constant. The previous version began at a fixed 2.2x
 * radius on the ellipse, so a piece released near the bag visibly teleported
 * outward before starting its approach.
 *
 * Still expressed so the last frame is exactly `planetSlot(orbit, phase)`: the
 * angle offset unwinds to zero and the radius multiplier reaches one, so the
 * handoff to the steady rAF loop cannot jump.
 */

/** Full revolutions on the way in. */
export const APPROACH_TURNS = 2;

/** Two seconds — one second per revolution. */
export const CAPTURE_DURATION_MS = 2_000;

/** Below this the release point is treated as the centre and the angle kept. */
const MIN_START_RADIUS_SCALE = 0.04;

/**
 * Where the item was released, in the orbit system's own terms.
 *
 * `turns` is the angle around the ellipse; `radiusScale` is how far out it sits
 * as a multiple of this orbit's radius, so 1 is already on the ring.
 */
export type CaptureStart = { turns: number; radiusScale: number };

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * Convert a release point — offsets from the system's centre, in px — into a
 * start on this orbit.
 *
 * Inverts `planetSlot`'s parametrisation: x = sin(θ)·radiusX·k and
 * y = -cos(θ)·radiusY·k, so dividing out the radii recovers θ and k. Dividing
 * by the radii rather than using the raw offsets matters because the orbit is a
 * squashed ellipse — treating it as a circle would start the item at the wrong
 * angle and make the first loop lurch to correct.
 */
export function captureStartFromPoint(
  orbit: PlanetOrbit,
  dx: number,
  dy: number,
): CaptureStart {
  const nx = orbit.radiusX > 0 ? dx / orbit.radiusX : 0;
  const ny = orbit.radiusY > 0 ? dy / orbit.radiusY : 0;
  const radiusScale = Math.hypot(nx, ny);
  // atan2(sin, cos) with cos = -ny, matching y = -cos(θ)·radiusY·k.
  const turns = Math.atan2(nx, -ny) / (Math.PI * 2);
  return {
    turns: Number.isFinite(turns) ? turns : 0,
    radiusScale: Number.isFinite(radiusScale) ? radiusScale : 1,
  };
}

/** Steady angle of an orbit at a given phase, in turns. */
function steadyTurns(orbit: PlanetOrbit, phase: number): number {
  return phase * orbit.speed + orbit.offset;
}

/**
 * Total turns the item sweeps: two, adjusted to land exactly on the orbit angle.
 *
 * The item has to arrive at whatever angle the steady orbit is at when the
 * capture ends, and the drop point is wherever the user let go — so the sweep is
 * two turns plus the fraction needed to close that gap. Choosing the multiple
 * nearest two keeps the correction inside half a turn, so it always reads as two
 * circles rather than as one and a half or two and a half.
 */
export function captureSweepTurns(
  orbit: PlanetOrbit,
  start: CaptureStart,
  endPhase: number,
): number {
  const gap = steadyTurns(orbit, endPhase) - start.turns;
  // Shift `gap` by whole turns until it is as close to APPROACH_TURNS as
  // possible.
  return gap + Math.round(APPROACH_TURNS - gap);
}

/**
 * Where a capturing item sits.
 *
 * Angle advances linearly: a constant rate is what makes two revolutions
 * legible as two. Radius closes linearly too, so each loop tightens by the same
 * amount — easing it front-loads the shrink and the second loop then runs at a
 * flat radius, which does not read as still coming closer.
 */
export function captureSlot(
  orbit: PlanetOrbit,
  progress: number,
  start: CaptureStart,
  endPhase = 0,
): OrbitSlot {
  const p = clamp01(progress);
  const sweep = captureSweepTurns(orbit, start, endPhase);

  const turns = start.turns + sweep * p;
  const angle = turns * Math.PI * 2;

  // A release almost exactly on the centre has no meaningful angle, so treat it
  // as starting on the ring's own angle instead of snapping to atan2(0,0).
  const startRadius = Math.max(start.radiusScale, MIN_START_RADIUS_SCALE);
  const radiusScale = startRadius + (1 - startRadius) * p;

  const depth = -Math.cos(angle);
  const t = (depth + 1) / 2;

  return {
    x: Math.sin(angle) * orbit.radiusX * radiusScale,
    y: depth * orbit.radiusY * radiusScale,
    scale: SCALE_BACK + (SCALE_FRONT - SCALE_BACK) * t,
    opacity: OPACITY_BACK + (OPACITY_FRONT - OPACITY_BACK) * t,
    zIndex: BAG_Z + Math.round(depth * 50),
    inFront: depth >= 0,
  };
}

/** Capture progress for a timestamp. 1 means the capture is over. */
export function captureProgress(
  elapsedMs: number,
  durationMs = CAPTURE_DURATION_MS,
): number {
  if (!Number.isFinite(elapsedMs) || durationMs <= 0) return 1;
  return clamp01(elapsedMs / durationMs);
}
