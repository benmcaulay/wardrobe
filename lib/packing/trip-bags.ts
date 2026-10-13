/**
 * Changing which bags a trip uses, without losing what is already packed.
 *
 * Both `assignments` (garments) and `gearAssignments` are keyed by bag id, so
 * a bag is not just a name on the trip — it is the key its contents live
 * under. Editing `bagIds` alone would leave those contents stranded under a
 * key nothing renders: the items vanish from the plan, and reappear if the
 * bag is ever added back. Every change here moves or drops both maps with the
 * bag list, so the two can never disagree.
 *
 * Pure, so the rules are testable without a trip or a database.
 */

/** `{ [bagId]: ids }` — the shape of both assignments and gearAssignments. */
export type BagContents = Record<string, string[]>;

export type TripBagState = {
  bagIds: string[];
  assignments: BagContents;
  gear: BagContents;
};

function dedupe(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

/**
 * Move one bag's contents onto another within a single map.
 *
 * Exported because the trip planner holds `assignments` in client state keyed
 * by bag id: the server moves the contents, but a router refresh only renews
 * the props, so the client has to apply the same move or a swapped bag reads
 * as empty.
 */
export function moveBagContents(map: BagContents, fromId: string, toId: string): BagContents {
  if (fromId === toId) return map;
  const incoming = map[fromId] ?? [];
  if (incoming.length === 0) {
    // Nothing to carry, but the empty key still has to go or it outlives its bag.
    const { [fromId]: _dropped, ...rest } = map;
    return rest;
  }
  const { [fromId]: _moved, ...rest } = map;
  // Existing contents first: when the destination is already on the trip this
  // is a merge, and what was deliberately packed there keeps its order.
  return { ...rest, [toId]: dedupe([...(map[toId] ?? []), ...incoming]) };
}

/** Drop every bag not in `keepIds`; its contents become unpacked. */
export function pruneBagContents(map: BagContents, keepIds: readonly string[]): BagContents {
  const keep = new Set(keepIds);
  return Object.fromEntries(Object.entries(map).filter(([bagId]) => keep.has(bagId)));
}

/**
 * Put `toId` in `fromId`'s place and carry everything across.
 *
 * Swapping onto a bag the trip already uses is a merge rather than an error —
 * it is the same request ("put this somewhere else"), just aimed at a bag
 * that happens to be here, and refusing it would be a puzzle rather than a
 * safeguard. Capacity is deliberately not checked: the meters already show an
 * overfull bag, and blocking the move would strand the items instead.
 */
export function swapTripBag(state: TripBagState, fromId: string, toId: string): TripBagState {
  if (fromId === toId) return state;
  if (!state.bagIds.includes(fromId)) return state;

  const bagIds: string[] = [];
  for (const id of state.bagIds) {
    if (id === fromId) bagIds.push(toId);
    else if (id !== toId) bagIds.push(id);
  }

  return {
    bagIds,
    assignments: moveBagContents(state.assignments, fromId, toId),
    gear: moveBagContents(state.gear, fromId, toId),
  };
}

/**
 * Set the trip's bags outright.
 *
 * A bag that leaves takes no items with it: its entries are dropped, which
 * returns those pieces to the unpacked pool rather than deleting them —
 * "unpacked" is just "in no bag's list". Use `swapTripBag` when the contents
 * should follow the change; this is for adding and removing.
 */
export function setTripBags(state: TripBagState, nextIds: readonly string[]): TripBagState {
  const bagIds = dedupe(nextIds);
  return {
    bagIds,
    assignments: pruneBagContents(state.assignments, bagIds),
    gear: pruneBagContents(state.gear, bagIds),
  };
}
