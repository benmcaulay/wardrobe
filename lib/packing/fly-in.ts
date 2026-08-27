/**
 * The path a dropped piece takes from where you released it into the pack.
 *
 * ── Why this is a rewrite ───────────────────────────────────────────────────
 *
 * The previous attempt animated the *orbiting planet*: it recorded the release
 * point, waited for the server round trip to add the item, and then started the
 * planet's first frame at that point. Three separate things went wrong with
 * that, and fixing two of them did not fix the third:
 *
 *  1. The coordinates were converted after a re-render, by which time packing
 *     the piece had removed its row from the rail and shifted the stage.
 *  2. The animation could not begin until the server responded, so the piece
 *     vanished at the drop and reappeared a few hundred milliseconds later.
 *  3. It was expressed as an offset on an orbit, so the start was only ever
 *     "somewhere on that ellipse", never literally where the pointer was.
 *
 * This version is viewport-based and starts immediately. At pointerup we know
 * the release point in client coordinates; the flying element is fixed-position,
 * so it can begin exactly there on the very next frame, while the server request
 * is still in flight. Nothing about it depends on React re-render timing.
 *
 * The target is measured per frame rather than once, so the piece still lands
 * correctly even though the layout reflows underneath it mid-flight — the
 * failure that broke the previous version becomes a non-issue.
 */

/** Two seconds. */
export const FLY_IN_DURATION_MS = 2_000;

/** Full revolutions around the pack on the way in. */
export const FLY_IN_TURNS = 2;

export type Point = { x: number; y: number };

export type FlyInFrame = {
  /** Client coordinates for the flying element's centre. */
  x: number;
  y: number;
  scale: number;
  opacity: number;
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

/**
 * Where the flying piece is at `progress`, in client coordinates.
 *
 * The spiral is built in polar terms around the target: the radius is the
 * release distance shrinking to zero, and the angle is the release bearing plus
 * two full turns. At progress 0 that is exactly the release point — not
 * approximately, and not "the nearest point on an orbit" — because the radius is
 * the measured distance and the angle the measured bearing.
 *
 * `release` and `target` are both live client coordinates, so a layout shift
 * between frames just moves the target and the path follows it.
 */
export function flyInFrame(
  release: Point,
  target: Point,
  progress: number,
): FlyInFrame {
  const p = clamp01(progress);

  const dx = release.x - target.x;
  const dy = release.y - target.y;
  const startRadius = Math.hypot(dx, dy);
  const startAngle = Math.atan2(dy, dx);

  // Eased so it leaves the hand briskly and settles rather than arriving at
  // full speed. Angle uses the same curve as radius, so the spiral stays even.
  const k = easeInOutSine(p);
  const radius = startRadius * (1 - k);
  const angle = startAngle + FLY_IN_TURNS * 2 * Math.PI * k;

  return {
    x: target.x + Math.cos(angle) * radius,
    y: target.y + Math.sin(angle) * radius,
    // Shrinks as it is drawn in, so it reads as falling into the pack rather
    // than sliding across it.
    scale: 1 - 0.55 * k,
    // Holds opacity until the last stretch, then fades as the real orbiting
    // piece takes over underneath.
    opacity: p < 0.8 ? 1 : 1 - (p - 0.8) / 0.2,
  };
}

/** Progress for an elapsed time. 1 means the flight is over. */
export function flyInProgress(
  elapsedMs: number,
  durationMs = FLY_IN_DURATION_MS,
): number {
  if (!Number.isFinite(elapsedMs) || durationMs <= 0) return 1;
  return clamp01(elapsedMs / durationMs);
}
