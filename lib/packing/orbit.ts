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
 * A new item does not simply appear in its orbit — it gets captured, the way a
 * body falling toward a planet does. It sweeps in from outside, tightens, dives
 * through the bag, comes out the far side, and settles.
 *
 * The whole thing is expressed as two multipliers on the steady orbit — an angle
 * offset and a radius scale — both of which reach identity at `progress === 1`.
 * That is the important property: the last frame of the capture is *exactly*
 * `planetSlot(orbit, phase)`, so handing off to the steady rAF loop cannot jump.
 * Anything that animated in its own coordinate space would need a fudge factor
 * to line up, and would drift whenever the orbit geometry changed.
 *
 * Pure and deterministic, like the rest of this module, so the trajectory can be
 * asserted frame by frame in a test rather than eyeballed in a browser.
 */

/** Revolutions swept while spiralling in, before the dive. */
const CAPTURE_TURNS = 2.5;

/** Progress at which the inward spiral ends and the dive into the bag begins. */
const DIVE_AT = 0.55;
/** Progress at which the item is fully inside the bag — the far-side exit point. */
const SWALLOWED_AT = 0.72;
/** Progress at which the outward burst is done and the settle begins. */
const SETTLED_AT = 0.88;

/** How far out the item starts, as a multiple of its final orbit radius. */
const ENTRY_RADIUS_SCALE = 2.1;
/** Slight overshoot on the way out, so the settle reads as elastic, not linear. */
const EXIT_RADIUS_SCALE = 1.12;
/** Scale while passing through the bag — small enough to read as "inside". */
const SWALLOWED_SCALE = 0.12;

export const CAPTURE_DURATION_MS = 2_600;

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Linear map of `t` from [a,b] to [0,1], clamped outside. */
function span(t: number, a: number, b: number): number {
  if (b <= a) return 1;
  return clamp01((t - a) / (b - a));
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Radius multiplier over the capture. Four segments: spiral in, dive to zero,
 * burst out past the target, ease back to it.
 */
export function captureRadiusScale(progress: number): number {
  const p = clamp01(progress);
  if (p < DIVE_AT) {
    // Wide sweep tightening toward the dive. Eased so the approach decelerates.
    const k = easeOutCubic(span(p, 0, DIVE_AT));
    return ENTRY_RADIUS_SCALE + (1.15 - ENTRY_RADIUS_SCALE) * k;
  }
  if (p < SWALLOWED_AT) {
    // Falling in. Reaches exactly 0 at the centre of the bag.
    const k = easeInOutCubic(span(p, DIVE_AT, SWALLOWED_AT));
    return 1.15 * (1 - k);
  }
  if (p < SETTLED_AT) {
    // Out the far side, overshooting slightly.
    const k = easeOutCubic(span(p, SWALLOWED_AT, SETTLED_AT));
    return EXIT_RADIUS_SCALE * k;
  }
  const k = easeInOutCubic(span(p, SETTLED_AT, 1));
  return EXIT_RADIUS_SCALE + (1 - EXIT_RADIUS_SCALE) * k;
}

/**
 * Extra angle, in turns, added to the steady orbit. Starts a full
 * `CAPTURE_TURNS + 0.5` behind and unwinds to zero, so the item circles several
 * times and the half-turn puts its emergence on the opposite side of the bag
 * from where it went in.
 */
export function captureAngleOffset(progress: number): number {
  const p = clamp01(progress);
  return -(CAPTURE_TURNS + 0.5) * (1 - easeInOutCubic(p));
}

/**
 * Where a capturing item sits. Same shape as `planetSlot`, so the component
 * writes identical transforms either way.
 *
 * While inside the bag the item is pushed behind it and dimmed, which is what
 * makes the dive read as "into the pack" rather than "across the pack".
 */
export function captureSlot(
  orbit: PlanetOrbit,
  progress: number,
  phase = 0,
): OrbitSlot {
  const p = clamp01(progress);
  const angle =
    (phase * orbit.speed + orbit.offset + captureAngleOffset(p)) * Math.PI * 2;
  const radiusScale = captureRadiusScale(p);

  const depth = -Math.cos(angle);
  const t = (depth + 1) / 2;

  // How buried the item is: 1 at the centre of the bag, 0 once clear of it.
  const buried = 1 - Math.min(1, radiusScale / 0.45);
  const steadyScale = SCALE_BACK + (SCALE_FRONT - SCALE_BACK) * t;
  const steadyOpacity = OPACITY_BACK + (OPACITY_FRONT - OPACITY_BACK) * t;

  // Entering the bag passes behind it; leaving comes out in front, regardless of
  // which half of the ellipse the angle happens to be on.
  const exiting = p >= SWALLOWED_AT;
  const zIndex = buried > 0.05 ? (exiting ? BAG_Z + 60 : BAG_Z - 60) : BAG_Z + Math.round(depth * 50);

  return {
    x: Math.sin(angle) * orbit.radiusX * radiusScale,
    y: depth * orbit.radiusY * radiusScale,
    scale: steadyScale * (1 - buried) + SWALLOWED_SCALE * buried,
    opacity: steadyOpacity * (1 - buried * 0.75),
    zIndex,
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
