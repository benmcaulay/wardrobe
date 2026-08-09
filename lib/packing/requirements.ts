/**
 * What the trip is actually for.
 *
 * Until now the planner knew only a destination and some dates, so a wedding in
 * Lisbon and a hiking week in Lisbon produced byte-identical bags. That is the
 * real cause of "it recommends the same thing every time" — not a weak
 * algorithm, a missing input. Everything here exists to give the planner
 * something to differ on.
 *
 * Requirements are expressed as *needs*: "this trip wants at least one thing
 * that looks like swimwear". They can only be matched against data that
 * actually exists, which on a real closet means garment kind plus the item's
 * name — `styleTags` is 7.2% populated and 77% of that says "Room Decor", so
 * formality cannot be inferred from tags. Keyword matching on names is
 * therefore not a shortcut here, it is the only honest option.
 *
 * Pure and deterministic, like the rest of lib/packing. An AI parser can later
 * populate this same structure from free text ("5 days in Lisbon for a
 * wedding") without the planner needing to know a model was involved.
 */
import type { CategoryBucket } from "./plan";

export type TripActivity = "beach" | "hiking" | "business" | "formal" | "city" | "gym";

export type TripRequirements = {
  activities: TripActivity[];
  /** Laundry mid-trip — roughly doubles what each piece covers. */
  laundry: boolean;
};

export const EMPTY_REQUIREMENTS: TripRequirements = { activities: [], laundry: false };

/** One thing a trip needs at least `count` of. */
export type ActivityNeed = {
  /** Shown when the closet can't satisfy it. */
  label: string;
  bucket: CategoryBucket;
  /** Matched against the item's lowercased "subcategory + name". */
  match: RegExp;
  count: number;
};

export const ACTIVITIES: {
  id: TripActivity;
  label: string;
  needs: ActivityNeed[];
}[] = [
  {
    id: "beach",
    label: "Beach",
    needs: [
      { label: "swimwear", bucket: "bottom", match: /(swim|trunk|boardshort|bikini)/, count: 1 },
      { label: "sandals", bucket: "shoes", match: /(sandal|slide|flip|croc|espadrille)/, count: 1 },
    ],
  },
  {
    id: "hiking",
    label: "Hiking",
    needs: [
      { label: "sturdy shoes", bucket: "shoes", match: /(boot|trail|hike|running|trainer|sneaker)/, count: 1 },
      { label: "long trousers", bucket: "bottom", match: /(pant|trouser|jean|legging|jogger)/, count: 1 },
    ],
  },
  {
    id: "business",
    label: "Business",
    needs: [
      { label: "a collared shirt", bucket: "top", match: /(shirt|blouse|polo|button)/, count: 1 },
      { label: "smart trousers", bucket: "bottom", match: /(trouser|chino|slack|dress pant)/, count: 1 },
      { label: "smart shoes", bucket: "shoes", match: /(loafer|oxford|derby|brogue|dress|heel)/, count: 1 },
    ],
  },
  {
    id: "formal",
    label: "Formal event",
    needs: [
      { label: "something dressy", bucket: "top", match: /(shirt|blouse|button|oxford)/, count: 1 },
      { label: "a jacket or blazer", bucket: "outerwear", match: /(blazer|suit|sport coat)/, count: 1 },
      { label: "smart shoes", bucket: "shoes", match: /(loafer|oxford|derby|brogue|dress|heel)/, count: 1 },
    ],
  },
  {
    id: "city",
    label: "City walking",
    needs: [
      { label: "comfortable shoes", bucket: "shoes", match: /(sneaker|trainer|running|walking|loafer)/, count: 1 },
    ],
  },
  {
    id: "gym",
    label: "Gym",
    needs: [
      { label: "trainers", bucket: "shoes", match: /(sneaker|trainer|running)/, count: 1 },
      { label: "shorts or leggings", bucket: "bottom", match: /(short|legging|jogger|track)/, count: 1 },
    ],
  },
];

const BY_ID = new Map(ACTIVITIES.map((a) => [a.id, a]));

export function isTripActivity(value: string): value is TripActivity {
  return BY_ID.has(value as TripActivity);
}

export function activityLabel(id: TripActivity): string {
  return BY_ID.get(id)?.label ?? id;
}

/**
 * Every need across the selected activities, de-duplicated. Two activities that
 * both want smart shoes should reserve one pair, not two.
 */
export function activityNeeds(requirements: TripRequirements): ActivityNeed[] {
  const seen = new Set<string>();
  const out: ActivityNeed[] = [];
  for (const id of requirements.activities) {
    for (const need of BY_ID.get(id)?.needs ?? []) {
      const key = `${need.bucket}:${need.match.source}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(need);
    }
  }
  return out;
}

/**
 * How much further each piece stretches. Laundry mid-trip roughly doubles it,
 * which is the single biggest lever on how much you need to carry.
 */
export function wearMultiplier(requirements: TripRequirements): number {
  return requirements.laundry ? 2 : 1;
}

/** Read requirements off a trip's stored JSON, discarding anything unknown. */
export function parseTripRequirements(raw: string | null | undefined): TripRequirements {
  if (!raw) return EMPTY_REQUIREMENTS;
  try {
    const parsed = JSON.parse(raw) as Partial<TripRequirements>;
    const activities = Array.isArray(parsed.activities)
      ? [...new Set(parsed.activities.filter((a): a is TripActivity => typeof a === "string" && isTripActivity(a)))]
      : [];
    return { activities, laundry: parsed.laundry === true };
  } catch {
    return EMPTY_REQUIREMENTS;
  }
}
