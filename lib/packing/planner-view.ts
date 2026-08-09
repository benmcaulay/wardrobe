/**
 * Small view-state helpers for the trip planner.
 *
 * These decide something the eye then reads as a claim — how long the plane is
 * in the air, whether there is more list below the fold — so they live here as
 * plain values and pure functions rather than inline in the JSX, where they
 * can't be tested and quietly drift.
 */

/**
 * How long the plane flies after the auto-pack button is pressed.
 *
 * Deliberately a fixed gesture, not a progress indicator. Tying it to the
 * request would make it a spinner that lies: a warm cache returns in 40ms and
 * the plane would twitch, a cold one takes seconds and it would loop like the
 * pack had stalled. One second of departure, every time, whatever the server
 * is doing.
 */
export const PLANE_FLIGHT_MS = 1000;

/**
 * The flight duration handed to CSS. Both the keyframes and the timer that
 * ends the flight read from `PLANE_FLIGHT_MS` through here, so they can't drift
 * apart and strand the plane mid-route.
 */
export function planeFlightVars(): Record<string, string> {
  return { "--plane-flight": `${PLANE_FLIGHT_MS}ms` };
}

/**
 * Has a scroll container reached its bottom?
 *
 * The `slack` absorbs sub-pixel layout: fractional element heights mean
 * scrollTop rarely lands exactly on scrollHeight - clientHeight, so an exact
 * comparison leaves the bag column's fade scrim stuck on at the very end.
 */
export function isScrolledToEnd(
  metrics: { scrollHeight: number; scrollTop: number; clientHeight: number },
  slack = 2,
): boolean {
  const remaining = metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight;
  return remaining <= slack;
}
