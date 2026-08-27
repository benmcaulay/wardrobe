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
 * A new item does not simply appear in its orbit — it gets captured.
 *
 * Three phases, in order:
 *
 *  1. **Two full circles**, tightening. Exactly 2.000 revolutions at a constant
 *     angular rate, with the radius shrinking the whole way, so you can watch it
 *     come round twice and see each pass sit closer in than the last.
 *  2. **Through the pack.** The radius collapses to exactly zero at the centre
 *     and opens out the far side, sweeping a further half turn — so it exits
 *     opposite where it went in rather than doubling back.
 *  3. **Merge.** A final half turn, decelerating, easing onto the ring it will
 *     keep. Still curved: the path is the same ellipse throughout, only its
 *     radius changes, so the item never travels in a straight line.
 *
 * The whole thing is expressed as two multipliers on the steady orbit — an angle
 * offset and a radius scale — both of which reach identity at `progress === 1`.
 * That is the property everything rests on: the last frame of the capture is
 * *exactly* `planetSlot(orbit, phase)`, so handing off to the steady rAF loop
 * cannot jump. Anything animated in its own coordinate space would need a fudge
 * factor to line up, and would drift whenever the orbit geometry changed.
 *
 * Pure and deterministic, like the rest of this module, so the trajectory can be
 * asserted frame by frame in a test rather than eyeballed in a browser.
 */

/** Full revolutions completed on approach. Two, exactly, and countable. */
export const APPROACH_TURNS = 2;
/** Swept while passing through the pack — half a turn puts the exit opposite. */
const THROUGH_TURNS = 0.5;
/** Swept while easing onto the ring. */
const MERGE_TURNS = 0.5;
/** Total sweep, which is also how far behind its final angle the item starts. */
const TOTAL_TURNS = APPROACH_TURNS + THROUGH_TURNS + MERGE_TURNS;

/**
 * Phase boundaries in progress.
 *
 * The approach owns most of the timeline because it owns most of the motion —
 * two of the three turns. Splitting the time evenly would make the circles race
 * and the merge crawl.
 */
const APPROACH_END = 0.62;
const THROUGH_END = 0.8;

/** How far out the item starts, as a multiple of its final orbit radius. */
const ENTRY_RADIUS_SCALE = 2.2;
/** Radius at the moment it starts pushing through — just inside the ring. */
const APPROACH_END_RADIUS_SCALE = 0.92;
/** Overshoot on the way out, so the merge reads as elastic rather than linear. */
const EXIT_RADIUS_SCALE = 1.15;
/** Scale while passing through the pack — small enough to read as "inside". */
const SWALLOWED_SCALE = 0.12;

/**
 * Long enough to actually watch two revolutions. At the old 2.6s the circles
 * were a blur, which is the complaint this rework answers.
 */
export const CAPTURE_DURATION_MS = 3_800;

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
 * Turns swept since the start of the capture.
 *
 * The approach is deliberately **linear**: constant angular rate is what makes
 * two revolutions legible as two revolutions. Easing it would smear the loops
 * into each other and you would not be able to count them, which was the whole
 * problem with the previous version.
 */
export function captureTurnsSwept(progress: number): number {
  const p = clamp01(progress);
  if (p < APPROACH_END) {
    return APPROACH_TURNS * span(p, 0, APPROACH_END);
  }
  if (p < THROUGH_END) {
    // Eased, so the pass through the centre accelerates in and out of it.
    return APPROACH_TURNS + THROUGH_TURNS * easeInOutCubic(span(p, APPROACH_END, THROUGH_END));
  }
  return (
    APPROACH_TURNS +
    THROUGH_TURNS +
    MERGE_TURNS * easeOutCubic(span(p, THROUGH_END, 1))
  );
}

/**
 * Extra angle, in turns, added to the steady orbit. Starts a full `TOTAL_TURNS`
 * behind and unwinds to exactly zero, so the item lands on its true orbit angle.
 */
export function captureAngleOffset(progress: number): number {
  return captureTurnsSwept(progress) - TOTAL_TURNS;
}

/**
 * Radius multiplier over the capture.
 *
 * Monotonically decreasing through the whole approach — that is what "getting
 * progressively closer" means, and it has to hold across both revolutions
 * rather than only on average.
 */
export function captureRadiusScale(progress: number): number {
  const p = clamp01(progress);

  if (p < APPROACH_END) {
    // Linear, deliberately. Easing this front-loads the tightening: with an
    // ease-out the radius was already at ~1.03 a third of the way in, so the
    // first loop did nearly all the closing and the second ran at a flat
    // radius — monotonic on paper, but it does not *look* like it is still
    // coming closer. Linear spends the same shrink on each revolution, so both
    // loops visibly tighten.
    return (
      ENTRY_RADIUS_SCALE +
      (APPROACH_END_RADIUS_SCALE - ENTRY_RADIUS_SCALE) * span(p, 0, APPROACH_END)
    );
  }

  if (p < THROUGH_END) {
    // Through the pack: down to exactly 0 at the halfway point of this phase,
    // then out the far side. Two mirrored eases meeting at the centre.
    const t = span(p, APPROACH_END, THROUGH_END);
    if (t < 0.5) {
      return APPROACH_END_RADIUS_SCALE * (1 - easeInOutCubic(t * 2));
    }
    return EXIT_RADIUS_SCALE * easeInOutCubic((t - 0.5) * 2);
  }

  const k = easeInOutCubic(span(p, THROUGH_END, 1));
  return EXIT_RADIUS_SCALE + (1 - EXIT_RADIUS_SCALE) * k;
}

/**
 * Where a capturing item sits. Same shape as `planetSlot`, so the component
 * writes identical transforms either way.
 *
 * While inside the pack the item is pushed behind it and dimmed, which is what
 * makes the pass read as *through* rather than *across*.
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

  // How buried the item is: 1 at the centre of the pack, 0 once clear of it.
  const buried = 1 - Math.min(1, radiusScale / 0.45);
  const steadyScale = SCALE_BACK + (SCALE_FRONT - SCALE_BACK) * t;
  const steadyOpacity = OPACITY_BACK + (OPACITY_FRONT - OPACITY_BACK) * t;

  // Going in passes behind the pack, coming out passes in front, regardless of
  // which half of the ellipse the angle happens to land on.
  const throughMidpoint = APPROACH_END + (THROUGH_END - APPROACH_END) / 2;
  const exiting = p >= throughMidpoint;
  const zIndex =
    buried > 0.05 ? (exiting ? BAG_Z + 60 : BAG_Z - 60) : BAG_Z + Math.round(depth * 50);

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
