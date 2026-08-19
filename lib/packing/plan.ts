/**
 * SmartPakker packing algorithm. Deterministic and pure so it's easy to test
 * and can run on the client for live recomputation after manual edits.
 *
 * Pipeline:
 *   1. derive target item counts per category from trip length + climate band
 *   2. score items on climate fit and colour versatility (see ./palette.ts)
 *   3. select the best candidates up to each target
 *   4. cover-then-fill them into the bags: guarantee a floor, then feed whichever
 *      bucket is the bottleneck until the trip is covered, then spend what's
 *      left on extras
 *
 * Step 4 is deliberately not a bin-pack. Filling litres and being dressed are
 * different objectives, and optimising the first produced bags with no tops in
 * them — see `coverThenFill`. `packItems` keeps the plain first-fit-decreasing
 * placement for callers that already know exactly what they want to place.
 */

import type { Color, Season } from "@/lib/json";
import { classifyGarmentKind, type GarmentKind } from "@/lib/categories";
import { estimateItemPacking, type EstimableItem } from "./estimate";
import { colorVersatility } from "./palette";
import { isOccasionPiece, partitionByDailyWear } from "./occasion";
import {
  activityNeeds,
  EMPTY_REQUIREMENTS,
  wearMultiplier,
  type ActivityNeed,
  type TripRequirements,
} from "./requirements";
import type { ClimateBand } from "@/lib/services/weather";

export type PackableItem = EstimableItem & {
  id: string;
  season?: Season[];
  /** Drives the versatility term in `climateScore`. See ./palette.ts. */
  colors?: Color[];
  /** Override for the daily-rotation guess. See ./occasion.ts. */
  dailyWear?: boolean | null;
};

export type PackBag = {
  id: string;
  volumeLiters: number;
  maxWeightKg?: number | null;
};

/**
 * Canonical category buckets the targets are expressed in. Same taxonomy as
 * `GarmentKind` — aliased rather than redeclared so the two can't drift.
 */
export type CategoryBucket = GarmentKind;

const BUCKETS: CategoryBucket[] = [
  "top",
  "bottom",
  "dress",
  "outerwear",
  "shoes",
  "accessory",
  "other",
];

/**
 * Which packing bucket an item belongs to.
 *
 * Delegates to the shared classifier so user-named categories ("shirt",
 * "sweater/hoodie", "pants") land where they should. This used to compare
 * normalized names against the canonical list, which meant any closet not using
 * the six default category names had almost everything fall through to "other"
 * — a bucket whose target is 0, so the planner packed no clothes at all.
 *
 * Accepts either a bare category (convenient, and what the board passes) or a
 * whole item, which classifies better because subcategory and name are
 * available to disambiguate a vague category.
 */
export function bucketFor(item: string | EstimableItem): CategoryBucket {
  if (typeof item === "string") return classifyGarmentKind({ category: item });
  return classifyGarmentKind({
    category: item.category,
    subcategory: item.subcategory,
    name: item.name,
  });
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Ideal number of pieces per category for a trip of `days` in a given climate.
 * Tuned for "pack light but be covered": tops roughly one per day (fewer when
 * hot since tees re-wear poorly but pack small), bottoms re-worn, outerwear and
 * base layers scaled by how cold it is, plus a rain layer when it's wet.
 *
 * A baseline kit is always covered regardless of climate: at least one jacket,
 * one pair of pants, one pair of shorts and one shirt (the shorts/pants split
 * is enforced in selectItems; here we just keep bottoms >= 2 so both fit). Shoes
 * are capped at a single pair for small loads.
 */
const SMALL_LOAD_LITERS = 25;

export function targetCounts(
  days: number,
  band: ClimateBand,
  rainChance: number,
  totalCapacityLiters = Infinity,
  /**
   * Laundry mid-trip (see ./requirements.ts). It has to shrink the *targets*,
   * not just stretch coverage: the fill phase spends whatever space is left up
   * to target, so without this a laundry trip packs MORE rather than less —
   * covered sooner, then topped up. Which is the opposite of the point.
   */
  wearMultiplier = 1,
): Record<CategoryBucket, number> {
  const d = clamp(Math.round(days), 1, 30);
  const m = wearMultiplier > 0 ? wearMultiplier : 1;

  const topsFactor = band === "hot" ? 1 : band === "cold" ? 0.9 : 0.8;
  const tops = clamp(Math.round((d * topsFactor) / m), 1, 14);
  // >= 2 so the one-shorts + one-pants baseline always has room.
  const bottoms = clamp(Math.ceil(d / (2.5 * m)), 2, 6);

  const dresses = band === "hot" || band === "warm" ? clamp(Math.ceil(d / (4 * m)), 0, 4) : 0;

  // Always bring a jacket; pack more layers as it gets cold or wet.
  let outerwear = { hot: 0, warm: 0, mild: 1, cool: 1, cold: 2 }[band];
  if (rainChance >= 0.4) outerwear = Math.max(outerwear, 1);
  outerwear = Math.max(outerwear, 1);

  // One pair of shoes for a small total load, otherwise two on longer trips.
  const shoes = totalCapacityLiters < SMALL_LOAD_LITERS ? 1 : d <= 3 ? 1 : 2;
  const accessory = clamp(Math.ceil(d / 3), 1, 4);

  return {
    top: tops,
    bottom: bottoms,
    dress: dresses,
    outerwear,
    shoes,
    accessory,
    other: 0,
  };
}

const PREFERRED_SEASONS: Record<ClimateBand, Season[]> = {
  hot: ["summer"],
  warm: ["summer", "spring"],
  mild: ["spring", "fall"],
  cool: ["fall", "spring"],
  cold: ["winter", "fall"],
};

/** 2 = season suits the climate, 1 = all-season/untagged, 0 = wrong season. */
export function seasonScore(seasons: Season[] | undefined, band: ClimateBand): 0 | 1 | 2 {
  if (!seasons || seasons.length === 0) return 1;
  const preferred = PREFERRED_SEASONS[band];
  return seasons.some((s) => preferred.includes(s)) ? 2 : 0;
}

const SHORTS_KEYWORDS = ["shorts", "short", "trunks", "boardshort"];
const PANTS_KEYWORDS = [
  "pants",
  "trouser",
  "jeans",
  "denim",
  "chinos",
  "slacks",
  "leggings",
  "joggers",
  "sweatpant",
];

function itemText(item: PackableItem): string {
  return `${item.subcategory ?? ""} ${item.name ?? ""}`.toLowerCase();
}

function matchesAny(text: string, keywords: string[]): boolean {
  return keywords.some((k) => text.includes(k));
}

export function isShorts(item: PackableItem): boolean {
  return matchesAny(itemText(item), SHORTS_KEYWORDS);
}

export function isPants(item: PackableItem): boolean {
  return matchesAny(itemText(item), PANTS_KEYWORDS);
}

/**
 * Rough warmth/heft of a garment on a 0 (summer-light) .. 3 (heavy winter)
 * scale. Lets us prefer shorts/tees/sandals in the heat and pants/sweaters/
 * boots/coats in the cold, beyond just season tags.
 */
export function garmentWarmth(item: PackableItem): number {
  const text = itemText(item);
  const material = (item.material ?? "").toLowerCase();

  // Accessories get their own scale before the garment rules run. Otherwise a
  // "Denim Cap" matches the jeans rule below and scores warmth 2, which reads
  // as a cold-weather garment and wins slots in mild climates — the same
  // order-dependent keyword collision that had it costed as a pair of jeans.
  if (bucketFor(item) === "accessory") {
    if (matchesAny(text, ["scarf", "glove", "mitten", "beanie", "balaclava", "earmuff"])) return 2;
    return 0.3;
  }

  if (matchesAny(text, ["puffer", "parka", "down", "winter coat"]) || material.includes("down")) {
    return 3;
  }
  if (matchesAny(text, ["coat", "trench"])) return 2.6;
  if (matchesAny(text, ["sweater", "knit", "cardigan", "hoodie", "sweatshirt", "fleece"])) return 2;
  if (
    matchesAny(text, ["jeans", "denim", "boots"]) ||
    material.includes("wool") ||
    material.includes("cashmere")
  ) {
    return 2;
  }
  if (matchesAny(text, ["blazer", "jacket"])) return 1.5;
  if (
    matchesAny(text, [
      "shorts",
      "tank",
      "tee",
      "t-shirt",
      "t shirt",
      "sandal",
      "slide",
      "flip",
      "swim",
      "bikini",
      "trunks",
    ]) ||
    material.includes("linen")
  ) {
    return 0;
  }
  if (matchesAny(text, ["shirt", "blouse", "trousers", "pants", "chinos", "skirt", "sneaker", "trainer", "polo"])) {
    return 1;
  }
  const bucket = bucketFor(item);
  if (bucket === "outerwear") return 2;
  if (bucket === "shoes" || bucket === "top" || bucket === "bottom") return 1;
  return 0.5;
}

/** Exported for lib/outfit/climate.ts, which needs the same tuned targets —
 *  duplicating the table would let the two drift apart silently. */
export const DESIRED_WARMTH: Record<ClimateBand, number> = {
  hot: 0,
  warm: 0.7,
  mild: 1.4,
  cool: 2,
  cold: 2.6,
};

/**
 * How much colour versatility can move an item's score.
 *
 * Tuned to break ties *within* a warmth band without jumping one. In mild
 * weather the gap between a shirt and a tee is 1.0, so at 0.8 a maximally
 * versatile tee still cannot outrank a poorly-coloured shirt — climate fit
 * stays dominant, which is the whole point of a climate score.
 */
const VERSATILITY_WEIGHT = 0.8;

/**
 * How well an item suits the trip. Higher = fitter.
 *
 * Three terms, in order of authority:
 *   1. season fit  — strongest signal *when present*, but see the note below
 *   2. warmth      — how close the garment is to what the climate wants
 *   3. versatility — how easily its colours combine with everything else
 *
 * The versatility term exists because the first two do not discriminate on real
 * data. `season` is 0% populated on the measured closet, so `seasonScore`
 * returns a constant and that term cancels out for every item; `garmentWarmth`
 * then resolves 73 tops into just 3 distinct scores, with 44 tied — meaning the
 * "best" tops were whichever the database happened to return first. Colour is
 * 100% populated, so it is what actually separates one shirt from another.
 *
 * Season is kept rather than removed: it costs nothing, and it starts working
 * the moment those tags exist.
 */
export function climateScore(item: PackableItem, band: ClimateBand): number {
  const season = seasonScore(item.season, band);
  const warmth = garmentWarmth(item);
  const versatility = colorVersatility(item.colors);
  return (
    season * 2 - Math.abs(warmth - DESIRED_WARMTH[band]) + VERSATILITY_WEIGHT * versatility
  );
}

/** Minimum pieces we'll backfill with off-season items if nothing better fits. */
const CATEGORY_MINIMUM: Partial<Record<CategoryBucket, number>> = {
  top: 1,
  outerwear: 1,
  shoes: 1,
};

/** Ranked candidate used during selection. */
type Candidate = {
  item: PackableItem;
  season: 0 | 1 | 2;
  score: number;
  weightGrams: number;
  volumeLiters: number;
};

export type SelectedItem = {
  id: string;
  bucket: CategoryBucket;
  weightGrams: number;
  volumeLiters: number;
  seasonOk: boolean;
  /** Carried through so activity needs can be matched without the full item. */
  name?: string | null;
  subcategory?: string | null;
};

export type PerBagUsage = {
  bagId: string;
  usedVolumeLiters: number;
  capacityLiters: number;
  usedWeightGrams: number;
  maxWeightGrams: number | null;
  itemIds: string[];
  overVolume: boolean;
  overWeight: boolean;
};

export type PackingPlan = {
  targets: Record<CategoryBucket, number>;
  selected: SelectedItem[];
  assignments: Record<string, string[]>;
  unplaced: string[];
  perBag: PerBagUsage[];
  totals: { volumeLiters: number; weightGrams: number; count: number };
  warnings: string[];
  /** How many of the trip's days the packed bag can actually dress you for. */
  coverage: { days: number; coveredDays: number };
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Bottoms get special handling so the baseline always includes one pair of
 * shorts and one pair of pants (in-season preferred), then fills the rest with
 * the best climate-fitting bottoms up to the target.
 */
function selectBottoms(candidates: Candidate[], target: number): Candidate[] {
  const inSeason = candidates.filter((c) => c.season > 0);
  const offSeason = candidates.filter((c) => c.season === 0);
  const chosen: Candidate[] = [];
  const used = new Set<string>();
  const add = (c: Candidate | undefined) => {
    if (c && !used.has(c.item.id)) {
      used.add(c.item.id);
      chosen.push(c);
    }
  };

  // Baseline: a pair of shorts and a pair of pants (best-fitting available).
  add(inSeason.find((c) => isShorts(c.item)) ?? offSeason.find((c) => isShorts(c.item)));
  add(inSeason.find((c) => isPants(c.item)) ?? offSeason.find((c) => isPants(c.item)));

  // Fill to the target with the best remaining in-season bottoms, then off-season.
  const goal = Math.max(target, chosen.length);
  for (const c of inSeason) {
    if (chosen.length >= goal) break;
    add(c);
  }
  for (const c of offSeason) {
    if (chosen.length >= goal) break;
    add(c);
  }
  return chosen;
}

/** Select the best items per category up to the targets for this climate. */
export function selectItems(
  items: PackableItem[],
  band: ClimateBand,
  targets: Record<CategoryBucket, number>,
): SelectedItem[] {
  const byBucket = new Map<CategoryBucket, Candidate[]>();
  for (const item of items) {
    const bucket = bucketFor(item);
    const est = estimateItemPacking(item);
    const arr = byBucket.get(bucket) ?? [];
    arr.push({
      item,
      season: seasonScore(item.season, band),
      score: climateScore(item, band),
      weightGrams: est.weightGrams,
      volumeLiters: est.volumeLiters,
    });
    byBucket.set(bucket, arr);
  }

  const toSelected = (c: Candidate, bucket: CategoryBucket): SelectedItem => ({
    id: c.item.id,
    bucket,
    weightGrams: c.weightGrams,
    volumeLiters: c.volumeLiters,
    seasonOk: c.season > 0,
    name: c.item.name,
    subcategory: c.item.subcategory,
  });

  const selected: SelectedItem[] = [];
  for (const bucket of BUCKETS) {
    const candidates = (byBucket.get(bucket) ?? []).slice();
    if (candidates.length === 0) continue;
    // Best climate fit first; ties broken by smaller packed volume (pack light).
    candidates.sort((a, b) => b.score - a.score || a.volumeLiters - b.volumeLiters);

    if (bucket === "bottom") {
      for (const c of selectBottoms(candidates, targets.bottom ?? 0)) {
        selected.push(toSelected(c, bucket));
      }
      continue;
    }

    const target = targets[bucket] ?? 0;
    const min = CATEGORY_MINIMUM[bucket] ?? 0;
    const pickCount = Math.max(target, min);
    if (pickCount === 0) continue;

    const inSeason = candidates.filter((c) => c.season > 0);
    const offSeason = candidates.filter((c) => c.season === 0);
    const chosen = inSeason.slice(0, pickCount);
    // Backfill toward the minimum (e.g. the baseline jacket) with off-season pieces.
    if (chosen.length < min) {
      chosen.push(...offSeason.slice(0, min - chosen.length));
    }

    for (const c of chosen) selected.push(toSelected(c, bucket));
  }
  return selected;
}

/**
 * First-fit-decreasing bin-pack of items into bags. Items are sorted largest
 * volume first; each is placed into the first bag with room (and within the
 * weight cap when one is set). Items that fit nowhere land in `unplaced`.
 */
export function packItems(
  items: SelectedItem[],
  bags: PackBag[],
): { assignments: Record<string, string[]>; unplaced: string[] } {
  const assignments: Record<string, string[]> = {};
  const usedVolume: Record<string, number> = {};
  const usedWeight: Record<string, number> = {};
  for (const bag of bags) {
    assignments[bag.id] = [];
    usedVolume[bag.id] = 0;
    usedWeight[bag.id] = 0;
  }

  const unplaced: string[] = [];
  const sorted = [...items].sort((a, b) => b.volumeLiters - a.volumeLiters);

  for (const item of sorted) {
    let placed = false;
    for (const bag of bags) {
      const fitsVolume = usedVolume[bag.id] + item.volumeLiters <= bag.volumeLiters + 1e-6;
      const capG = bag.maxWeightKg != null ? bag.maxWeightKg * 1000 : Infinity;
      const fitsWeight = usedWeight[bag.id] + item.weightGrams <= capG + 1e-6;
      if (fitsVolume && fitsWeight) {
        assignments[bag.id].push(item.id);
        usedVolume[bag.id] += item.volumeLiters;
        usedWeight[bag.id] += item.weightGrams;
        placed = true;
        break;
      }
    }
    if (!placed) unplaced.push(item.id);
  }

  return { assignments, unplaced };
}

/**
 * How many days one piece of each kind covers before it wants washing.
 *
 * Only the first three matter — a jacket, shoes and a hat are worn every day of
 * a trip, so their figure just has to exceed any realistic trip length.
 */
export const WEARS_PER_ITEM: Record<CategoryBucket, number> = {
  top: 1.5,
  bottom: 3,
  dress: 1.5,
  outerwear: 60,
  shoes: 60,
  accessory: 60,
  other: 60,
};

type BucketCounts = Partial<Record<CategoryBucket, number>>;

/**
 * How many days of the trip this set of counts can actually dress you for.
 *
 * A minimum, not a sum: eight tops and no bottoms dresses you for zero days.
 * That is the property the old packer was missing — it measured litres consumed,
 * which eight tops and no bottoms scores very well on. Dresses count toward both
 * halves, since one covers a whole day on its own.
 */
export function coveredDays(counts: BucketCounts, days: number, wearMultiplier = 1): number {
  const m = wearMultiplier > 0 ? wearMultiplier : 1;
  const dressDays = (counts.dress ?? 0) * WEARS_PER_ITEM.dress * m;
  const topDays = (counts.top ?? 0) * WEARS_PER_ITEM.top * m + dressDays;
  const bottomDays = (counts.bottom ?? 0) * WEARS_PER_ITEM.bottom * m + dressDays;
  const shoeDays = (counts.shoes ?? 0) > 0 ? days : 0;
  return Math.max(0, Math.min(days, topDays, bottomDays, shoeDays));
}

/** Which coverage bucket is currently the bottleneck, or null once covered. */
function bindingBucket(counts: BucketCounts, days: number, m = 1): CategoryBucket | null {
  const dressDays = (counts.dress ?? 0) * WEARS_PER_ITEM.dress * m;
  const ranked: [CategoryBucket, number][] = [
    ["top", (counts.top ?? 0) * WEARS_PER_ITEM.top * m + dressDays],
    ["bottom", (counts.bottom ?? 0) * WEARS_PER_ITEM.bottom * m + dressDays],
    ["shoes", (counts.shoes ?? 0) > 0 ? days : 0],
  ];
  // Deterministic: least-covered first, ties broken by name.
  ranked.sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
  return ranked[0][1] >= days ? null : ranked[0][0];
}

/** Buckets guaranteed one piece before anything else is considered. */
const FLOOR_BUCKETS: CategoryBucket[] = ["top", "bottom", "shoes", "outerwear"];

type BagState = { bag: PackBag; volume: number; weight: number; itemIds: string[] };

function placeInto(state: BagState[], item: SelectedItem): boolean {
  for (const s of state) {
    const capGrams = s.bag.maxWeightKg != null ? s.bag.maxWeightKg * 1000 : Infinity;
    const fitsVolume = s.volume + item.volumeLiters <= s.bag.volumeLiters + 1e-6;
    const fitsWeight = s.weight + item.weightGrams <= capGrams + 1e-6;
    if (fitsVolume && fitsWeight) {
      s.volume += item.volumeLiters;
      s.weight += item.weightGrams;
      s.itemIds.push(item.id);
      return true;
    }
  }
  return false;
}

/**
 * Decide what makes the cut AND where it goes, in one capacity-aware pass.
 *
 * The old pipeline chose items and placed them in two separate phases:
 * `selectItems` picked a full set of targets without knowing how big the bags
 * were, then first-fit-decreasing dropped whatever didn't fit. Because FFD
 * places largest-first, the shortfall fell entirely on the smallest pieces — on
 * a real 8-day trip into an 18 L bag that meant four bottoms, a leather jacket
 * and *zero tops*, reported as "7 items didn't fit".
 *
 * Cover-Then-Fill makes the trade-off explicit and lexicographic:
 *
 *   0. FLOOR    — one top, one bottom, one pair of shoes, one jacket. You can
 *                 leave the house.
 *   1. COVER    — keep adding to whichever bucket is the current bottleneck
 *                 until the bag dresses you for the whole trip.
 *   2. FILL     — only now spend leftover space on extras, up to target.
 *
 * Nothing in a later phase can displace something in an earlier one, so a second
 * pair of shoes can never cost you your fourth shirt. Items are consumed in the
 * order `selectItems` emitted them, which is best-scoring first within each
 * bucket — so the coverage phase still gets the most climate- and
 * colour-appropriate pieces, it just stops over-buying one bucket.
 *
 * Deterministic: no randomness, stable ordering, and the coverage loop is
 * bounded by the candidate count.
 */
export function coverThenFill(
  selected: readonly SelectedItem[],
  bags: readonly PackBag[],
  opts: {
    days: number;
    targets: Record<CategoryBucket, number>;
    /** Items the trip's activities demand, reserved before general coverage. */
    needs?: readonly ActivityNeed[];
    /** Laundry stretches every piece; see ./requirements.ts. */
    wearMultiplier?: number;
  },
): {
  assignments: Record<string, string[]>;
  unplaced: string[];
  counts: BucketCounts;
  /** Activity needs the closet couldn't satisfy, for the UI to report. */
  unmetNeeds: ActivityNeed[];
} {
  const state: BagState[] = bags.map((bag) => ({ bag, volume: 0, weight: 0, itemIds: [] }));
  const packed = new Set<string>();
  const counts: BucketCounts = {};

  // Preference order within a bucket is the order selectItems produced.
  const pool = new Map<CategoryBucket, SelectedItem[]>();
  for (const item of selected) {
    const list = pool.get(item.bucket) ?? [];
    list.push(item);
    pool.set(item.bucket, list);
  }

  /** Pack the best unpacked item of a bucket that fits. */
  const takeFrom = (bucket: CategoryBucket): boolean => {
    for (const item of pool.get(bucket) ?? []) {
      if (packed.has(item.id)) continue;
      if (!placeInto(state, item)) continue;
      packed.add(item.id);
      counts[bucket] = (counts[bucket] ?? 0) + 1;
      return true;
    }
    return false;
  };

  // 0a — what the trip specifically asked for. These come first because a
  // wedding without smart shoes is a failed trip however well the bag covers
  // the days, and because "same pack every time" is exactly what happens when
  // the planner has no idea what the trip is for.
  const unmetNeeds: ActivityNeed[] = [];
  for (const need of opts.needs ?? []) {
    let got = 0;
    // Smallest match first, not best-scoring first. A need is a yes/no
    // requirement rather than a preference, so satisfying it as cheaply as
    // possible leaves room for the others — otherwise one bulky match (a 3.5 L
    // blazer) can starve every remaining need in a tight bag.
    const matches = (pool.get(need.bucket) ?? [])
      .filter((i) => need.match.test(`${i.subcategory ?? ""} ${i.name ?? ""}`.toLowerCase()))
      .sort((a, b) => a.volumeLiters - b.volumeLiters || a.id.localeCompare(b.id));
    for (const item of matches) {
      if (got >= need.count) break;
      if (packed.has(item.id)) continue;
      if (!placeInto(state, item)) continue;
      packed.add(item.id);
      counts[need.bucket] = (counts[need.bucket] ?? 0) + 1;
      got += 1;
    }
    if (got < need.count) unmetNeeds.push(need);
  }

  // 0b — floor.
  for (const bucket of FLOOR_BUCKETS) {
    if ((opts.targets[bucket] ?? 0) > 0 && (counts[bucket] ?? 0) === 0) takeFrom(bucket);
  }

  // 1 — cover. Each pass feeds the bottleneck. A pass can leave coverage flat
  // when two buckets are tied; the next pass then targets the other one, so it
  // still converges. Bounded by the candidate count either way.
  const m = opts.wearMultiplier ?? 1;
  let guard = selected.length + FLOOR_BUCKETS.length + 1;
  while (coveredDays(counts, opts.days, m) < opts.days && guard-- > 0) {
    const bucket = bindingBucket(counts, opts.days, m);
    if (!bucket) break;
    // Respect the trip's target: past it, more of this bucket is hoarding.
    if ((counts[bucket] ?? 0) >= (opts.targets[bucket] ?? 0)) break;
    if (!takeFrom(bucket)) break; // nothing left that fits
  }

  // 2 — fill leftover space with extras, never exceeding target.
  for (const item of selected) {
    if (packed.has(item.id)) continue;
    if ((counts[item.bucket] ?? 0) >= (opts.targets[item.bucket] ?? 0)) continue;
    if (!placeInto(state, item)) continue;
    packed.add(item.id);
    counts[item.bucket] = (counts[item.bucket] ?? 0) + 1;
  }

  const assignments: Record<string, string[]> = {};
  for (const s of state) assignments[s.bag.id] = s.itemIds;

  return {
    assignments,
    unplaced: selected.filter((s) => !packed.has(s.id)).map((s) => s.id),
    counts,
    unmetNeeds,
  };
}

/** Recompute per-bag usage for an arbitrary assignment (used after edits). */
export function computeUsage(
  assignments: Record<string, string[]>,
  bags: PackBag[],
  estimates: Map<string, { weightGrams: number; volumeLiters: number }>,
): { perBag: PerBagUsage[]; totals: { volumeLiters: number; weightGrams: number; count: number } } {
  const perBag: PerBagUsage[] = [];
  let totalVolume = 0;
  let totalWeight = 0;
  let totalCount = 0;

  for (const bag of bags) {
    const itemIds = assignments[bag.id] ?? [];
    let vol = 0;
    let wt = 0;
    for (const id of itemIds) {
      const est = estimates.get(id);
      if (!est) continue;
      vol += est.volumeLiters;
      wt += est.weightGrams;
    }
    const maxWeightGrams = bag.maxWeightKg != null ? Math.round(bag.maxWeightKg * 1000) : null;
    perBag.push({
      bagId: bag.id,
      usedVolumeLiters: round1(vol),
      capacityLiters: bag.volumeLiters,
      usedWeightGrams: Math.round(wt),
      maxWeightGrams,
      itemIds,
      overVolume: vol > bag.volumeLiters + 1e-6,
      overWeight: maxWeightGrams != null && wt > maxWeightGrams + 1e-6,
    });
    totalVolume += vol;
    totalWeight += wt;
    totalCount += itemIds.length;
  }

  return {
    perBag,
    totals: { volumeLiters: round1(totalVolume), weightGrams: Math.round(totalWeight), count: totalCount },
  };
}

/**
 * Make sure anything an activity requires is a candidate at all.
 *
 * `selectItems` caps each bucket at the climate target, so a 4-day trip with a
 * small bag selects exactly one pair of shoes — the best-scoring one. If the
 * trip needs sandals and the trainers scored higher, the sandals were never in
 * the pool for `coverThenFill` to reserve, and the whole requirements layer
 * would silently do nothing. Needed items are appended so they can be reserved;
 * the target still caps everything chosen on preference alone.
 */
function withNeededItems(
  selected: SelectedItem[],
  all: readonly PackableItem[],
  needs: readonly ActivityNeed[],
): SelectedItem[] {
  if (needs.length === 0) return selected;
  const have = new Set(selected.map((s) => s.id));
  const extra: SelectedItem[] = [];

  for (const need of needs) {
    const matches = all
      .filter((item) => {
        if (have.has(item.id)) return false;
        if (bucketFor(item) !== need.bucket) return false;
        return need.match.test(`${item.subcategory ?? ""} ${item.name ?? ""}`.toLowerCase());
      })
      .map((item) => {
        const est = estimateItemPacking(item);
        return {
          id: item.id,
          bucket: need.bucket,
          weightGrams: est.weightGrams,
          volumeLiters: est.volumeLiters,
          seasonOk: true,
          name: item.name,
          subcategory: item.subcategory,
        } satisfies SelectedItem;
      })
      .sort((a, b) => a.volumeLiters - b.volumeLiters || a.id.localeCompare(b.id))
      .slice(0, need.count);

    for (const m of matches) {
      have.add(m.id);
      extra.push(m);
    }
  }

  return [...selected, ...extra];
}

/** Full plan: pick items for the climate/trip and pack them into the bags. */
export function buildPackingPlan(input: {
  items: PackableItem[];
  bags: PackBag[];
  days: number;
  band: ClimateBand;
  rainChance: number;
  requirements?: TripRequirements;
}): PackingPlan {
  const byId = new Map(input.items.map((i) => [i.id, i]));
  const totalCapacityLiters = input.bags.reduce((sum, b) => sum + b.volumeLiters, 0);
  const requirements = input.requirements ?? EMPTY_REQUIREMENTS;
  const multiplier = wearMultiplier(requirements);
  const targets = targetCounts(
    input.days,
    input.band,
    input.rainChance,
    totalCapacityLiters,
    multiplier,
  );
  const needs = activityNeeds(requirements);
  /*
   * Occasion pieces are kept out of the general selection but left available to
   * the activity needs below. Swim trunks are a `bottom` like any other, so
   * without this the packer picks them to cover an ordinary day — and then
   * counts them as one. Ticking "Beach" still reaches them, through
   * `withNeededItems`, which is handed the full list on purpose.
   */
  const { daily: dailyWearItems } = partitionByDailyWear(input.items);
  const selected = withNeededItems(
    selectItems(dailyWearItems, input.band, targets),
    input.items,
    needs,
  );
  const { assignments, unplaced, counts, unmetNeeds } = coverThenFill(selected, input.bags, {
    days: input.days,
    targets,
    needs,
    wearMultiplier: multiplier,
  });

  const estimates = new Map(
    selected.map((s) => [s.id, { weightGrams: s.weightGrams, volumeLiters: s.volumeLiters }]),
  );
  const { perBag, totals } = computeUsage(assignments, input.bags, estimates);

  const warnings: string[] = [];
  if (input.bags.length === 0) warnings.push("Add at least one bag to pack into.");
  for (const usage of perBag) {
    if (usage.overWeight) warnings.push("A bag is over its weight limit.");
  }

  // Leftover candidates are now expected — coverThenFill deliberately stops
  // buying a bucket once the trip is covered — so the old "N items didn't fit"
  // was both alarming and useless. What the user actually needs to know is
  // whether the bag dresses them for the whole trip.
  /*
   * Coverage counts only what you'd actually wear on an ordinary day. An
   * activity may have pulled trunks into the bag, but they don't dress you on
   * Tuesday, and counting them here is what used to inflate "covers N of M".
   */
  const bucketById = new Map(selected.map((s) => [s.id, s.bucket]));
  const dailyCounts: BucketCounts = {};
  for (const ids of Object.values(assignments)) {
    for (const id of ids) {
      if (isOccasionPiece(byId.get(id) ?? {})) continue;
      const bucket = bucketById.get(id);
      if (bucket) dailyCounts[bucket] = (dailyCounts[bucket] ?? 0) + 1;
    }
  }
  const covered = coveredDays(dailyCounts, input.days, multiplier);
  if (input.bags.length > 0 && covered < input.days) {
    const short = Math.max(1, Math.round(input.days - covered));
    warnings.push(
      `This packs enough to dress you for about ${Math.floor(covered)} of ${input.days} days — ${short} short. Add a bag, or free up space by dropping something bulky.`,
    );
  }

  // Say so when we couldn't fill a category. Previously a plan that found no
  // tops and no bottoms returned an empty `warnings` array — reporting success
  // while handing back a bag you couldn't get dressed out of. A shortfall is
  // nearly always a gap in the closet (or a category we failed to recognise),
  // and the user can only act on it if we name it.
  const selectedByBucket = new Map<CategoryBucket, number>();
  for (const s of selected) {
    selectedByBucket.set(s.bucket, (selectedByBucket.get(s.bucket) ?? 0) + 1);
  }
  if (unmetNeeds.length > 0) {
    // Naming the activity's need is far more actionable than a generic
    // shortfall — "no swimwear" tells you what to buy or un-tick.
    warnings.push(
      `Your closet has no ${unmetNeeds.map((n) => n.label).join(", no ")} for the activities you picked.`,
    );
  }

  const shortfalls = ESSENTIAL_BUCKETS.filter(
    (bucket) => (targets[bucket] ?? 0) > 0 && (selectedByBucket.get(bucket) ?? 0) === 0,
  );
  if (shortfalls.length > 0) {
    warnings.push(
      `Nothing in your closet matched ${listBuckets(shortfalls)} for this trip. Check those items' categories, or add some.`,
    );
  }

  return {
    targets,
    selected,
    assignments,
    unplaced,
    perBag,
    totals,
    warnings,
    coverage: { days: input.days, coveredDays: Math.round(covered * 10) / 10 },
  };
}

/** Buckets whose absence makes a plan unusable, so it's worth interrupting over. */
const ESSENTIAL_BUCKETS: CategoryBucket[] = ["top", "bottom", "shoes", "outerwear"];

const BUCKET_LABELS: Record<CategoryBucket, string> = {
  top: "tops",
  bottom: "bottoms",
  dress: "dresses",
  outerwear: "outerwear",
  shoes: "shoes",
  accessory: "accessories",
  other: "other pieces",
};

/** "tops", "tops or bottoms", "tops, bottoms or shoes". */
function listBuckets(buckets: CategoryBucket[]): string {
  const labels = buckets.map((b) => BUCKET_LABELS[b]);
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}`;
}
