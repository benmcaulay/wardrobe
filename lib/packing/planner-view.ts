/**
 * Small view-state helpers for the trip planner.
 *
 * Both of these decide something the eye then reads as a claim — whether the
 * bag has been packed, whether there is more list below the fold — so they live
 * here as pure functions rather than inline in the JSX, where they can't be
 * tested and quietly drift.
 */

/**
 * Where the plane sits on the flight strip beside the auto-pack button.
 *
 *   idle    — nothing packed yet this session; parked at the origin
 *   flying  — a pack is running
 *   landed  — a pack came back with a plan
 *
 * `packing` wins: a re-pack puts the plane back in the air rather than leaving
 * it sitting at the destination while work is happening.
 */
export type PlaneRouteState = "idle" | "flying" | "landed";

export function planeRouteState(input: { packing: boolean; packed: boolean }): PlaneRouteState {
  if (input.packing) return "flying";
  return input.packed ? "landed" : "idle";
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
