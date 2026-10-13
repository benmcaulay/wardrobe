/**
 * The order trips appear in on the SmartPakker hub.
 *
 * Trips default to newest departure first, which is right until you want a
 * particular one at the top. A saved order overrides that, and lives in
 * `stylePrefs` next to the other arrangement lists rather than in a new
 * column — it is a view preference, and a schema migration for it would have
 * to reach production before the feature could ship.
 *
 * Pure, so the merge rule can be tested without a database.
 */

/** Anything with an id and a departure; the hub's TripView satisfies it. */
export type OrderableTrip = { id: string; startDate: string };

/**
 * Apply a saved order, newest-first for anything it does not mention.
 *
 * Unlisted trips go **first**, not last. The list is written out in full the
 * moment anything is dragged, so in practice the only trips missing from it
 * are ones created since — and a trip you just planned belongs at the top,
 * not buried under an arrangement that predates it.
 */
export function sortTrips<T extends OrderableTrip>(trips: readonly T[], order: readonly string[]): T[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  const listed: T[] = [];
  const unlisted: T[] = [];
  for (const trip of trips) (rank.has(trip.id) ? listed : unlisted).push(trip);

  listed.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  unlisted.sort((a, b) => b.startDate.localeCompare(a.startDate));
  return [...unlisted, ...listed];
}

/**
 * Move the trip at `from` to `to`, returning the full id order to save.
 *
 * The whole visible order is returned rather than a patch, so one drag is
 * enough to pin every trip's position — otherwise the first drag would move
 * one trip and leave the rest still floating on departure date.
 */
export function moveTrip<T extends OrderableTrip>(trips: readonly T[], from: number, to: number): string[] {
  const ids = trips.map((t) => t.id);
  if (from === to || from < 0 || to < 0 || from >= ids.length || to >= ids.length) return ids;
  const [moved] = ids.splice(from, 1);
  if (moved === undefined) return trips.map((t) => t.id);
  ids.splice(to, 0, moved);
  return ids;
}
