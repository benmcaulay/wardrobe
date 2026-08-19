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
  /**
   * How many days of the trip each activity takes up.
   *
   * Ticking "Beach" says the trip has beach days; it can't say how many, and
   * the app has no way to know — a weekend by the sea and a fortnight in
   * Thailand are the same chip. So the count is the user's to give, defaulting
   * to one. It's what turns an activity from "pack swimwear" into "wear
   * swimwear on these days"; see `activityDaySchedule`.
   */
  activityDays?: Partial<Record<TripActivity, number>>;
  /** Laundry mid-trip — roughly doubles what each piece covers. */
  laundry: boolean;
};

export const EMPTY_REQUIREMENTS: TripRequirements = { activities: [], laundry: false };

/** Days an activity claims when the user hasn't said. */
export const DEFAULT_ACTIVITY_DAYS = 1;

/** Nobody is at the beach for more than a month. */
const MAX_ACTIVITY_DAYS = 30;

/** How many days an activity claims, clamped to something sane. */
export function activityDayCount(
  requirements: TripRequirements,
  activity: TripActivity,
): number {
  const raw = requirements.activityDays?.[activity];
  if (typeof raw !== "number" || !Number.isFinite(raw)) return DEFAULT_ACTIVITY_DAYS;
  return Math.min(MAX_ACTIVITY_DAYS, Math.max(1, Math.round(raw)));
}

/**
 * Which days of the trip belong to which activity.
 *
 * Spread evenly rather than bunched at the start: a beach trip with two beach
 * days wants them apart, and the arithmetic is the same either way. Deterministic
 * — the same trip always produces the same schedule, so the day plan doesn't
 * reshuffle itself between renders.
 *
 * Activities are laid out in the order they appear in `ACTIVITIES`, and a day
 * already claimed is skipped rather than doubled up: two things on one day is a
 * scheduling conflict the planner has no way to resolve, and silently dressing
 * you for both would be worse than dropping one.
 */
export function activityDaySchedule(
  days: number,
  requirements: TripRequirements,
): Map<number, TripActivity> {
  const total = Math.max(0, Math.floor(days));
  const schedule = new Map<number, TripActivity>();
  if (total === 0) return schedule;

  // ACTIVITIES order, not selection order, so the result doesn't depend on
  // which chip was tapped first.
  const chosen = ACTIVITIES.map((a) => a.id).filter((id) => requirements.activities.includes(id));

  for (const activity of chosen) {
    const wanted = Math.min(activityDayCount(requirements, activity), total);
    for (let i = 0; i < wanted; i += 1) {
      // Evenly through the trip: for one day that's the middle, for two the
      // thirds, and so on.
      const ideal = Math.round(((i + 1) * total) / (wanted + 1));
      let day = Math.min(total, Math.max(1, ideal));
      // Walk to the nearest free day if that one is taken.
      let step = 0;
      while (schedule.has(day) && step < total) {
        step += 1;
        const forward = day + step;
        const back = day - step;
        if (forward <= total && !schedule.has(forward)) day = forward;
        else if (back >= 1 && !schedule.has(back)) day = back;
      }
      if (!schedule.has(day)) schedule.set(day, activity);
    }
  }
  return schedule;
}

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
    const activityDays: Partial<Record<TripActivity, number>> = {};
    if (parsed.activityDays && typeof parsed.activityDays === "object") {
      for (const [key, value] of Object.entries(parsed.activityDays)) {
        if (!isTripActivity(key) || typeof value !== "number" || !Number.isFinite(value)) continue;
        activityDays[key] = Math.min(MAX_ACTIVITY_DAYS, Math.max(1, Math.round(value)));
      }
    }
    // Omitted when empty rather than written as `{}`: the field is optional,
    // and an absent key is the same statement as an empty one with less noise
    // in the column and in every equality check against EMPTY_REQUIREMENTS.
    return {
      activities,
      laundry: parsed.laundry === true,
      ...(Object.keys(activityDays).length > 0 ? { activityDays } : {}),
    };
  } catch {
    return EMPTY_REQUIREMENTS;
  }
}
