/**
 * The spinning ring the looks carousel runs on.
 *
 * One shared ellipse with the slides spaced evenly around it, seen from the
 * front: the slide at the near point is upright, full size and fully opaque,
 * and everything receding round the ring gets smaller and fainter until it
 * passes behind the front slide. A coverflow, in other words.
 *
 * This is deliberately *not* `lib/packing/orbit.ts`. That one scatters items
 * onto their own orbits at their own speeds so a bag's contents drift like a
 * solar system; this one keeps rigid, even spacing because the whole point is
 * to line looks up and pick one. Same trigonometry, opposite intent.
 *
 * Pure, so the depth cues and the pointer-to-spin mapping can be tested without
 * a DOM — the component only writes transforms.
 */

/**
 * Size and opacity at the far point of the ring, relative to the near point.
 * Exported so tests describe the ring rather than restating its numbers.
 */
export const SCALE_BACK = 0.42;
export const SCALE_FRONT = 1;
export const OPACITY_BACK = 0.2;
export const OPACITY_FRONT = 1;

/**
 * How sharply the depth cues bite.
 *
 * Linear falloff is nearly useless at the front of a crowded ring: with eleven
 * slides the immediate neighbours sit at 33 degrees, where the cosine is still
 * 0.84, so they render at 96% of full size and nothing looks selected. Raising
 * the curve concentrates the change near the front, which is the only place
 * anyone is looking.
 *
 * Size is pushed harder than opacity — the point is for the chosen look to come
 * forward, not for the others to disappear.
 */
const SCALE_FALLOFF = 2.4;
const OPACITY_FALLOFF = 1.5;

/** Base stacking index. Slides straddle it by depth. */
const BASE_Z = 200;

export type CarouselSlot = {
  /** Horizontal offset from the ring's centre, in px. */
  x: number;
  /** Vertical offset. Small — the ring is seen very slightly from above. */
  y: number;
  scale: number;
  opacity: number;
  zIndex: number;
  /** +1 at the near point, -1 at the far point. */
  depth: number;
};

/**
 * Where slide `index` of `count` sits at a given phase.
 *
 * `phase` is in turns. At phase 0 slide 0 is at the near point; each whole
 * turn brings the ring back to where it started.
 */
export function carouselSlot(
  index: number,
  count: number,
  options: { radiusX: number; radiusY?: number; phase?: number },
): CarouselSlot {
  const n = Math.max(1, count);
  const phase = options.phase ?? 0;
  const radiusY = options.radiusY ?? 0;
  const angle = (index / n + phase) * Math.PI * 2;

  // Near point at angle 0, so cosine is the depth directly.
  const depth = Math.cos(angle);
  const t = (depth + 1) / 2;

  return {
    x: Math.sin(angle) * options.radiusX,
    // Back of the ring sits a little higher, which is what stops a coverflow
    // reading as a flat row of shrinking cards.
    y: (1 - t) * -radiusY,
    scale: SCALE_BACK + (SCALE_FRONT - SCALE_BACK) * Math.pow(t, SCALE_FALLOFF),
    opacity: OPACITY_BACK + (OPACITY_FRONT - OPACITY_BACK) * Math.pow(t, OPACITY_FALLOFF),
    // Rounded so the value is stable frame to frame; a churning z-index forces
    // the compositor to restack every tick.
    zIndex: BASE_Z + Math.round(depth * 100),
    depth,
  };
}

/** Every slide's position at once. */
export function carouselRing(
  count: number,
  options: { radiusX: number; radiusY?: number; phase?: number },
): CarouselSlot[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) => carouselSlot(i, count, options));
}

/** Wrap a phase into [0,1) so it stays small over a long session. */
export function wrapPhase(phase: number): number {
  if (!Number.isFinite(phase)) return 0;
  return phase - Math.floor(phase);
}

/**
 * Which slide is currently nearest the front.
 *
 * Inverse of `phaseForIndex`: slide `i` is at the near point when
 * `i / n + phase` is a whole number, so the front index is `-phase * n`.
 */
export function frontIndex(phase: number, count: number): number {
  const n = Math.max(1, count);
  return ((Math.round(-wrapPhase(phase) * n) % n) + n) % n;
}

/** The phase that brings slide `index` to the near point. */
export function phaseForIndex(index: number, count: number): number {
  const n = Math.max(1, count);
  return wrapPhase(-index / n);
}

/**
 * The shortest signed distance from `from` to `to` around the ring.
 *
 * Spinning from 0.9 to 0.1 should travel +0.2 forwards, not -0.8 backwards, or
 * clicking the last chip unwinds the whole carousel to get to its neighbour.
 */
export function shortestPhaseDelta(from: number, to: number): number {
  const raw = wrapPhase(to) - wrapPhase(from);
  if (raw > 0.5) return raw - 1;
  if (raw < -0.5) return raw + 1;
  return raw;
}

/**
 * How fast to spin, from where the pointer is.
 *
 * Returns phase-turns per second. Negative for a pointer right of centre,
 * because advancing to a *later* slide means decreasing the phase — see
 * `frontIndex`. So pushing right walks forward through the days, which is the
 * only mapping anyone expects.
 *
 * The dead zone in the middle is what makes the thing usable: without it the
 * ring creeps whenever the cursor is anywhere in the frame, and settling on a
 * look becomes a game of holding perfectly still. Beyond the dead zone the
 * response is squared, so it eases in rather than lurching the moment you
 * cross the boundary.
 */
export function spinVelocity(
  pointerX: number,
  width: number,
  options: { deadZone?: number; maxTurnsPerSecond?: number } = {},
): number {
  if (!Number.isFinite(pointerX) || width <= 0) return 0;
  const deadZone = options.deadZone ?? 0.15;
  const max = options.maxTurnsPerSecond ?? 0.35;

  const offset = Math.max(-1, Math.min(1, (pointerX - width / 2) / (width / 2)));
  const magnitude = Math.abs(offset);
  if (magnitude <= deadZone) return 0;

  const beyond = (magnitude - deadZone) / (1 - deadZone);
  return -Math.sign(offset) * beyond * beyond * max;
}

/**
 * Ring radius for a container.
 *
 * Wide enough that neighbours stand clear of the front slide rather than
 * crowding it, and never so wide that the ring leaves the frame. The container
 * is usually the binding constraint on a laptop, which is the point: take all
 * the width there is.
 */
export function carouselRadius(box: { width: number; slideWidth: number }): number {
  return Math.max(80, Math.min(box.width / 2 - 24, box.slideWidth * 1.9));
}
