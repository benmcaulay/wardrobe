/**
 * Show the gap before you close it.
 *
 * When a piece leaves the closet the grid used to reflow instantly: the tile
 * vanished mid-frame and the neighbours slid over it, so the one moment this
 * product is named after — a garment gone, room where it was — happened in
 * about 16 milliseconds and off-screen. A vacancy holds that position open for
 * a beat first: an empty outlined cell exactly the size of the thing that left,
 * and only then does the grid close.
 *
 * Pure list arithmetic, kept out of the component because the interesting part
 * is *where* the hole goes. Removing the fourth of ten tiles has to leave the
 * hole in the fourth position of the nine that remain, not append it, and
 * removing three at once has to leave three holes in the right places.
 *
 * Deliberately id-based rather than index-based: the closet grid re-sorts on
 * every filter and sort change (lib/closet-sort.ts), so indices from the
 * previous render mean nothing on their own.
 */

/** A hole to hold open, and where in the *new* list to hold it. */
export type Vacancy = {
  /** The id that disappeared. Also the React key, so it must be the real id. */
  id: string;
  /** Insertion index into the new list. */
  index: number;
};

/**
 * Which ids disappeared, and where their holes belong in the new list.
 *
 * The index is the count of survivors that were ahead of the removed item, so
 * a hole opens where the tile actually was rather than at the end. Multiple
 * removals from the same neighbourhood come back with ascending indices, which
 * is what `withVacancies` needs to splice them without shifting each other.
 *
 * Returns nothing when the previous list was empty: a first render is not a
 * removal, and treating it as one would fill a fresh closet with holes.
 */
export function vacanciesBetween(
  prevIds: readonly string[],
  nextIds: readonly string[],
): Vacancy[] {
  if (prevIds.length === 0) return [];
  const surviving = new Set(nextIds);

  const out: Vacancy[] = [];
  let survivorsSoFar = 0;
  for (const id of prevIds) {
    if (surviving.has(id)) {
      survivorsSoFar += 1;
      continue;
    }
    out.push({ id, index: survivorsSoFar });
  }
  return out;
}

/** A cell in the rendered grid: a real piece, or the room one left behind. */
export type VacancySlot<T> =
  | { kind: "item"; key: string; item: T }
  | { kind: "vacancy"; key: string };

/**
 * Splice the holes back into the list.
 *
 * Walks the vacancies in order and inserts each at its recorded index plus the
 * number already inserted — the indices were computed against a list with no
 * holes in it, so each insertion shifts the ones after it by one.
 *
 * A vacancy whose id has since come back (undo, or a refresh that restored it)
 * is dropped, so an undone sale doesn't leave a permanent hole next to the tile
 * it belongs to.
 */
export function withVacancies<T>(
  items: readonly T[],
  vacancies: readonly Vacancy[],
  idOf: (item: T) => string,
): VacancySlot<T>[] {
  const slots: VacancySlot<T>[] = items.map((item) => ({
    kind: "item" as const,
    key: idOf(item),
    item,
  }));
  if (vacancies.length === 0) return slots;

  const present = new Set(slots.map((s) => s.key));
  let inserted = 0;
  for (const vacancy of [...vacancies].sort((a, b) => a.index - b.index)) {
    if (present.has(vacancy.id)) continue;
    const at = Math.min(vacancy.index + inserted, slots.length);
    slots.splice(at, 0, { kind: "vacancy", key: `vacancy:${vacancy.id}` });
    inserted += 1;
  }
  return slots;
}

/**
 * How long a hole stays open.
 *
 * Long enough to register as a deliberate pause rather than a dropped frame,
 * short enough that a bulk clear-out doesn't become a slideshow. Exported so
 * the component's timer and any test agree on one number.
 */
export const VACANCY_HOLD_MS = 620;
