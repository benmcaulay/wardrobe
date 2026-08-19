/**
 * Clothes you packed for one specific thing, not for Tuesday.
 *
 * Swim trunks classify as `bottom`, exactly like a pair of chinos, so the day
 * planner would happily schedule them as the bottom half of a Wednesday in
 * Seoul. Worse, they counted toward `coveredDays`, so packing swimwear made the
 * bag report better coverage for ordinary days than it actually had.
 *
 * The vocabulary for spotting these already existed in `./requirements.ts` —
 * the activity needs match on `/(swim|trunk|boardshort|bikini)/` and friends —
 * but it was only ever used to make sure such things got *packed*. Nothing
 * stopped them being *worn*. This is the other half.
 *
 * Derived, not tagged. This closet has `styleTags` at 7.2% populated (77% of
 * which says "Room Decor") and zero wear history, so a rule that depends on
 * someone labelling two hundred garments is a rule that never fires. A per-item
 * override exists for the cases the guess gets wrong — the same shape as the
 * weight and volume estimates, which are also derived-then-correctable.
 */

export type OccasionKind = "swim" | "sleep" | "formal";

/**
 * Patterns matched against an item's "subcategory + name", lowercased.
 *
 * Deliberately narrow. A false positive silently removes a wearable garment
 * from the rotation, which is a worse failure than leaving one in — so these
 * only cover things nobody wears to breakfast.
 *
 * Athletic kit is the notable omission. "Running shorts" and "gym tee" are
 * daily wear for plenty of people, and guessing wrong there would quietly
 * shrink a real wardrobe. Anyone who wants that behaviour can set the override
 * on the specific pieces.
 */
const PATTERNS: { kind: OccasionKind; match: RegExp }[] = [
  {
    kind: "swim",
    // "swimsuit" is caught by `swim`; "suit" on its own is not a pattern here
    // precisely because it would also catch tracksuits and brand names.
    match: /(swim|trunk|boardshort|board short|bikini|speedo|rash ?guard|wetsuit)/,
  },
  {
    kind: "sleep",
    match: /(pyjama|pajama|nightgown|nightie|sleepwear|dressing gown|onesie)/,
  },
  {
    kind: "formal",
    // Narrow on purpose: "suit jacket" and "blazer" are ordinary outerwear for
    // a lot of people, so only unambiguous black-tie pieces are listed.
    match: /(tuxedo|\btux\b|ball gown|cummerbund|bow tie)/,
  },
];

export type OccasionCandidate = {
  name?: string | null;
  subcategory?: string | null;
  category?: string | null;
  /**
   * The user's answer, which beats the guess in both directions: `true` forces
   * a piece into the daily rotation, `false` forces it out. Null or undefined
   * means "work it out".
   */
  dailyWear?: boolean | null;
};

/** The text the patterns are matched against. */
function searchText(item: OccasionCandidate): string {
  return `${item.subcategory ?? ""} ${item.name ?? ""} ${item.category ?? ""}`.toLowerCase();
}

/**
 * What kind of occasion a piece is for, ignoring any override — so the item
 * editor can show what the guess *would* be next to the switch that overrides it.
 */
export function deriveOccasion(item: OccasionCandidate): OccasionKind | null {
  const text = searchText(item);
  for (const { kind, match } of PATTERNS) {
    if (match.test(text)) return kind;
  }
  return null;
}

/**
 * Whether a piece belongs in the ordinary day-to-day rotation.
 *
 * The override wins outright. Everything else is daily wear unless it looks
 * like an occasion piece.
 */
export function isDailyWear(item: OccasionCandidate): boolean {
  if (typeof item.dailyWear === "boolean") return item.dailyWear;
  return deriveOccasion(item) == null;
}

/** The complement, for the places that want the occasion pieces themselves. */
export function isOccasionPiece(item: OccasionCandidate): boolean {
  return !isDailyWear(item);
}

/** Split a list once, rather than filtering it twice at every call site. */
export function partitionByDailyWear<T extends OccasionCandidate>(
  items: readonly T[],
): { daily: T[]; occasion: T[] } {
  const daily: T[] = [];
  const occasion: T[] = [];
  for (const item of items) (isDailyWear(item) ? daily : occasion).push(item);
  return { daily, occasion };
}

const LABELS: Record<OccasionKind, string> = {
  swim: "Swimwear",
  sleep: "Sleepwear",
  formal: "Formalwear",
};

export function occasionLabel(kind: OccasionKind): string {
  return LABELS[kind];
}

/**
 * The occasion an activity calls for, when it calls for one.
 *
 * Only two activities have a wardrobe the rest of the trip shouldn't touch.
 * Hiking, city walking and the gym are all done in ordinary clothes, so they
 * schedule nothing special — the activity needs in `./requirements.ts` already
 * make sure the right shoes get packed.
 */
export function occasionForActivity(activity: string): OccasionKind | null {
  if (activity === "beach") return "swim";
  if (activity === "formal") return "formal";
  return null;
}
