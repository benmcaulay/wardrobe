/**
 * Fitting the outfit canvas on screen.
 *
 * The canvas is a fixed logical coordinate space (560 x ~960) because every
 * placed piece stores an absolute x/y in it, and saved layouts are those exact
 * numbers. Resizing the coordinate space would move everything already saved.
 *
 * So instead of resizing, we render it at a CSS `scale()` that fits the
 * viewport and keep the coordinate space untouched. The only cost is that
 * pointer maths has to divide by the scale — see toFrameSpace().
 */

/** Never blow the artwork up past 1:1, and never shrink it into uselessness. */
export const MIN_FRAME_SCALE = 0.35;
export const MAX_FRAME_SCALE = 1;

export function computeFrameScale(opts: {
  frameWidth: number;
  frameHeight: number;
  availableWidth: number;
  availableHeight: number;
}): number {
  const { frameWidth, frameHeight, availableWidth, availableHeight } = opts;
  if (frameWidth <= 0 || frameHeight <= 0) return MAX_FRAME_SCALE;

  // A zero/unknown measurement means "not measured yet" — don't collapse the
  // frame to the minimum on the first paint, just render it unscaled.
  const wRatio = availableWidth > 0 ? availableWidth / frameWidth : MAX_FRAME_SCALE;
  const hRatio = availableHeight > 0 ? availableHeight / frameHeight : MAX_FRAME_SCALE;

  const fit = Math.min(wRatio, hRatio, MAX_FRAME_SCALE);
  return Math.max(MIN_FRAME_SCALE, roundScale(fit));
}

/** Snap to 3dp so tiny resize jitter doesn't cause re-render churn. */
function roundScale(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Convert a screen point into the frame's logical coordinate space.
 * `rect` is the *scaled* bounding box, so displayed pixels divide by the scale.
 */
export function toFrameSpace(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number },
  scale: number,
): { x: number; y: number } {
  const s = scale > 0 ? scale : 1;
  return { x: (clientX - rect.left) / s, y: (clientY - rect.top) / s };
}

export function clampToFrame(
  x: number,
  y: number,
  frameWidth: number,
  frameHeight: number,
): { x: number; y: number } {
  return {
    x: Math.min(Math.max(x, 0), frameWidth),
    y: Math.min(Math.max(y, 0), frameHeight),
  };
}
