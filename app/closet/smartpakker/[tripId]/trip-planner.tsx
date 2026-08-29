"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CityPicker } from "@/components/city-picker";
import { GearIcon } from "@/components/gear-icon";
import { WorldMap } from "@/components/world-map";
import { flagEmoji, localTimeAt, placeLabel, type Place } from "@/lib/places";
import type { Season } from "@/lib/json";
import { formatVolume, formatWeight } from "@/lib/packing/estimate";
import { computeUsage, type CategoryBucket } from "@/lib/packing/plan";
import {
  completeDayCount,
  distinctOutfitCount,
  planDailyOutfits,
  rewearDayCount,
} from "@/lib/packing/outfits";
import {
  ACTIVITIES,
  activityDayCount,
  activityDaySchedule,
  activityLabel,
  wearMultiplier,
  type TripActivity,
  type TripRequirements,
} from "@/lib/packing/requirements";
import {
  GEAR_CATEGORIES,
  gearCategoryLabel,
  gearFootprint,
  gearIconName,
  suggestGear,
  type GearCategory,
} from "@/lib/packing/gear";
import { BAG_PANEL_PREFIX } from "@/lib/packing/panel-state";
import { EMPTY_LOOK_PREFS, type LookLayoutPrefs } from "@/lib/packing/look";
import { occasionForActivity, occasionLabel, type OccasionKind } from "@/lib/packing/occasion";
import { getSilhouette } from "@/lib/packing/silhouettes";
import { formatTripRange, tripDayCount } from "@/lib/packing/trip-dates";
import type { ClimateBand, ClimateSummary } from "@/lib/services/weather";
import { formatTemperature, type TemperatureUnit } from "@/lib/temperature";
import { PLANE_FLIGHT_MS } from "@/lib/packing/planner-view";
import { SpaceTile } from "@/components/space-tile";
import { thumbnailUrl } from "@/lib/image-paths";
import { easeOutExpo } from "@/lib/ui-motion";
import { type ItemTileMeta } from "@/lib/item-tile-meta";
import { CapacityMeter } from "./capacity-meter";
import { CollapsibleSection, PanelStateProvider, usePanels } from "./collapsible-section";
import { LooksCarousel, type LookDay } from "./looks-carousel";
import { PackMode, RAIL_ZONE, type PackBag, type PackCandidate } from "./pack-mode";
import { type DragPayload } from "./packing-drag";
import {
  fetchTripClimate,
  searchDestinations,
  setTripClimate,
  setTripGear,
  setTripRequirements,
  setItemDailyWear,
  parseTripDescription,
  generatePackingPlan,
  setItemPacking,
  updateTrip,
} from "../actions";

const BAND_LABELS: Record<ClimateBand, string> = {
  hot: "Hot",
  warm: "Warm",
  mild: "Mild",
  cool: "Cool",
  cold: "Cold",
};

export type PlannerBag = {
  id: string;
  name: string;
  volumeLiters: number;
  maxWeightKg: number | null;
  /** Silhouette id and photo, for the bag artwork in Pack mode. */
  silhouette: string;
  imagePath: string | null;
};

export type PlannerItem = {
  id: string;
  name: string;
  imagePath: string;
  /** How the item's thumbnail is framed — flip and zoom, saved on the item. */
  tile: ItemTileMeta;
  category: string;
  /** Matched against the activity needs in lib/packing/requirements.ts. */
  subcategory: string | null;
  bucket: CategoryBucket;
  colors: { name: string; hex: string }[];
  season: Season[];
  weightGrams: number;
  volumeLiters: number;
  priceCents: number | null;
  currency: string;
  hasOverride: boolean;
  /** False for pieces packed for one occasion — swimwear, formalwear. */
  dailyWear: boolean;
  /** What made it an occasion piece, when it is one. */
  occasion: OccasionKind | null;
  /** The user's answer, when they've given one. Null means "use the guess". */
  dailyWearOverride: boolean | null;
};

const BUCKET_LABELS: Record<CategoryBucket, string> = {
  top: "Tops",
  bottom: "Bottoms",
  dress: "Dresses",
  outerwear: "Outerwear",
  shoes: "Shoes",
  accessory: "Accessories",
  other: "Other",
};

const BUCKET_ORDER: CategoryBucket[] = [
  "top",
  "bottom",
  "dress",
  "outerwear",
  "shoes",
  "accessory",
  "other",
];

function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

export type PlannerTrip = {
  id: string;
  name: string;
  destination: string;
  /** Null until the destination is picked from the list rather than typed. */
  latitude: number | null;
  longitude: number | null;
  countryCode: string | null;
  timezone: string | null;
  startDate: string;
  endDate: string;
};

/** One line of the user's gear library, as the planner needs it. */
export type PlannerGear = {
  id: string;
  name: string;
  category: GearCategory;
  icon: string | null;
  quantity: number;
  weightGrams: number | null;
  volumeLiters: number | null;
  notes: string | null;
  essential: boolean;
};

const NONE = "__none__";

export function TripPlanner({
  trip,
  bags,
  items,
  gear,
  initialClimate,
  initialRequirements,
  initialAssignments,
  initialGearAssignments,
  lookPrefs = EMPTY_LOOK_PREFS,
  temperatureUnit,
}: {
  trip: PlannerTrip;
  bags: PlannerBag[];
  items: PlannerItem[];
  gear: PlannerGear[];
  initialClimate: ClimateSummary | null;
  initialRequirements: TripRequirements;
  initialAssignments: Record<string, string[]>;
  initialGearAssignments: Record<string, string[]>;
  /** The outfit canvas's placement rules, for the looks carousel. */
  lookPrefs?: LookLayoutPrefs;
  temperatureUnit: TemperatureUnit;
}) {
  const router = useRouter();
  const [climate, setClimate] = useState<ClimateSummary | null>(initialClimate);
  const [requirements, setRequirements] = useState<TripRequirements>(initialRequirements);
  const [tripText, setTripText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseNote, setParseNote] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<Record<string, string[]>>(initialAssignments);
  const [gearAssignments, setGearAssignments] =
    useState<Record<string, string[]>>(initialGearAssignments);
  const [estimates, setEstimates] = useState<Map<string, { weightGrams: number; volumeLiters: number }>>(
    () => new Map(items.map((i) => [i.id, { weightGrams: i.weightGrams, volumeLiters: i.volumeLiters }])),
  );
  const [loadingClimate, setLoadingClimate] = useState(false);
  const [packing, setPacking] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);

  /**
   * The departure animation runs on its own clock: one flight per press,
   * PLANE_FLIGHT_MS long, regardless of how the pack itself goes. `flightId`
   * remounts the strip so a second press restarts the plane instead of being
   * swallowed by the animation already running.
   */
  const [flightId, setFlightId] = useState(0);
  const [flying, setFlying] = useState(false);
  const flightTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (flightTimer.current) window.clearTimeout(flightTimer.current);
  }, []);

  function launchPlane() {
    setFlightId((n) => n + 1);
    setFlying(true);
    if (flightTimer.current) window.clearTimeout(flightTimer.current);
    flightTimer.current = window.setTimeout(() => setFlying(false), PLANE_FLIGHT_MS);
  }

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  // Which bag (if any) each item currently sits in.
  const bagOfItem = useMemo(() => {
    const map = new Map<string, string>();
    for (const [bagId, ids] of Object.entries(assignments)) {
      for (const id of ids) map.set(id, bagId);
    }
    return map;
  }, [assignments]);

  const gearById = useMemo(() => new Map(gear.map((g) => [g.id, g])), [gear]);

  /** Which bag (if any) each piece of gear is in. */
  const bagOfGear = useMemo(() => {
    const map = new Map<string, string>();
    for (const [bagId, ids] of Object.entries(gearAssignments)) {
      for (const id of ids) map.set(id, bagId);
    }
    return map;
  }, [gearAssignments]);

  /**
   * Bag meters count clothes and gear together, because a bag doesn't care
   * which is which — it only has so many litres. `computeUsage` is id-agnostic,
   * so feeding it the union of both maps and both size tables is all it takes.
   * The two stay separate everywhere else; see lib/packing/gear.ts.
   */
  const usage = useMemo(() => {
    const merged: Record<string, string[]> = {};
    for (const bag of bags) {
      merged[bag.id] = [...(assignments[bag.id] ?? []), ...(gearAssignments[bag.id] ?? [])];
    }
    const sizes = new Map(estimates);
    for (const g of gear) {
      const { weightGrams, volumeLiters } = gearFootprint(g);
      sizes.set(g.id, { weightGrams, volumeLiters });
    }
    return computeUsage(merged, bags, sizes);
  }, [assignments, gearAssignments, bags, estimates, gear]);

  const packedGearCount = bagOfGear.size;

  // Persist assignment edits (debounced) so a refresh keeps the layout.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const t = window.setTimeout(() => {
      void updateTrip({ id: trip.id, assignments });
    }, 700);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignments]);

  // Same debounced write as garment assignments, on its own column.
  const firstGearRun = useRef(true);
  useEffect(() => {
    if (firstGearRun.current) {
      firstGearRun.current = false;
      return;
    }
    const t = window.setTimeout(() => {
      void setTripGear({ tripId: trip.id, assignments: gearAssignments });
    }, 700);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gearAssignments]);

  function moveGear(gearId: string, targetBagId: string) {
    setGearAssignments((prev) => {
      const next: Record<string, string[]> = {};
      for (const bag of bags) {
        next[bag.id] = (prev[bag.id] ?? []).filter((id) => id !== gearId);
      }
      if (targetBagId !== NONE && next[targetBagId]) {
        next[targetBagId] = [...next[targetBagId], gearId];
      }
      return next;
    });
  }

  function moveItem(itemId: string, targetBagId: string) {
    setAssignments((prev) => {
      const next: Record<string, string[]> = {};
      for (const bag of bags) {
        next[bag.id] = (prev[bag.id] ?? []).filter((id) => id !== itemId);
      }
      if (targetBagId !== NONE && next[targetBagId]) {
        next[targetBagId] = [...next[targetBagId], itemId];
      }
      return next;
    });
  }

  /**
   * Take everything out of one bag at once.
   *
   * Garments and gear together, because "empty my bag" plainly means both and
   * leaving the gear behind would look like a bug. Not destructive and not
   * confirmed: the pieces go back to the rail, nothing is deleted, and
   * auto-pack or a drag puts them back.
   */
  function emptyBag(bagId: string) {
    setAssignments((prev) => ({ ...prev, [bagId]: [] }));
    setGearAssignments((prev) => ({ ...prev, [bagId]: [] }));
  }

  async function handleFetchClimate() {
    setLoadingClimate(true);
    const res = await fetchTripClimate(trip.id);
    setLoadingClimate(false);
    if (res.ok) setClimate(res.climate);
  }

  async function handleAutoPack() {
    launchPlane();
    setPacking(true);
    setWarnings([]);
    const res = await generatePackingPlan(trip.id);
    setPacking(false);
    if (!res.ok) {
      setWarnings([res.error]);
      return;
    }
    setClimate(res.climate);
    setAssignments(res.plan.assignments);
    setWarnings(res.plan.warnings);
  }

  async function saveOverride(itemId: string, weightGrams: number | null, volumeLiters: number | null) {
    const res = await setItemPacking({ itemId, weightGrams, volumeLiters });
    if (!res.ok) return;
    // Reflect the change locally so meters update without a full reload.
    if (weightGrams != null || volumeLiters != null) {
      setEstimates((prev) => {
        const next = new Map(prev);
        const cur = next.get(itemId);
        next.set(itemId, {
          weightGrams: weightGrams ?? cur?.weightGrams ?? 0,
          volumeLiters: volumeLiters ?? cur?.volumeLiters ?? 0,
        });
        return next;
      });
    } else {
      /*
       * Cleared. Dropping the local entry matters as much as the refresh:
       * `estimates` shadows the item's own numbers everywhere it has a key, so
       * leaving the old override in the map means "Reset to estimate" saves
       * server-side and then keeps showing the value it just cleared.
       */
      setEstimates((prev) => {
        if (!prev.has(itemId)) return prev;
        const next = new Map(prev);
        next.delete(itemId);
        return next;
      });
      router.refresh();
    }
  }

  const packedIds = new Set(bagOfItem.keys());

  /**
   * Packed, but never put on a day. Worth naming: a garment in your bag that
   * the plan never mentions otherwise looks like the planner forgot it.
   */
  const occasionPacked = useMemo(
    () => items.filter((i) => bagOfItem.has(i.id) && !i.dailyWear),
    [items, bagOfItem],
  );

  // Per-garment-type counts and total value of everything currently packed.
  const summary = useMemo(() => {
    const counts = {} as Record<CategoryBucket, number>;
    const valueByCurrency = new Map<string, number>();
    let pricedCount = 0;
    let total = 0;
    for (const item of items) {
      if (!bagOfItem.has(item.id)) continue;
      total += 1;
      counts[item.bucket] = (counts[item.bucket] ?? 0) + 1;
      if (item.priceCents != null) {
        const cur = item.currency || "USD";
        valueByCurrency.set(cur, (valueByCurrency.get(cur) ?? 0) + item.priceCents);
        pricedCount += 1;
      }
    }
    const typeRows = BUCKET_ORDER.filter((b) => (counts[b] ?? 0) > 0).map((b) => ({
      label: BUCKET_LABELS[b],
      count: counts[b],
    }));
    const valueLabel =
      valueByCurrency.size === 0
        ? null
        : [...valueByCurrency.entries()].map(([cur, cents]) => formatMoney(cents, cur)).join(" + ");
    return { typeRows, valueLabel, pricedCount, total };
  }, [items, bagOfItem]);

  // Derived from the live assignment rather than the last auto-pack, so
  // swapping a piece re-plans the week immediately. This is why lib/packing is
  // pure — the same code the server used runs here with no round trip.
  /** Which day belongs to which activity, from the chips above. */
  const activityByDay = useMemo(
    () => activityDaySchedule(climate?.days ?? 0, requirements),
    [climate?.days, requirements],
  );

  /** How many days the trip covers, from its own dates. */
  const tripDays = useMemo(
    () => tripDayCount(trip.startDate, trip.endDate),
    [trip.startDate, trip.endDate],
  );

  const dayPlan = useMemo(() => {
    // Occasion pieces are packed but never scheduled *by the rotation*: swim
    // trunks are a `bottom` like any other, so without this they turn up as the
    // bottom half of an ordinary Wednesday. They come back below, on the days
    // their activity actually falls. See lib/packing/occasion.ts.
    const packed = items
      .filter((i) => bagOfItem.has(i.id) && i.dailyWear)
      .map((i) => ({ id: i.id, bucket: i.bucket, colors: i.colors }));

    /*
     * Beach day: wear the trunks. Each scheduled day gets whatever packed
     * occasion pieces match its activity — one per bucket, so a beach day swaps
     * the bottom rather than stacking two.
     */
    const occasionByDay: Record<number, { id: string; bucket: CategoryBucket }[]> = {};
    for (const [day, activity] of activityByDay) {
      const perBucket = new Map<CategoryBucket, PlannerItem>();

      // The activity's own wardrobe first — swimwear on a beach day.
      const kind = occasionForActivity(activity);
      if (kind) {
        for (const i of items) {
          if (!bagOfItem.has(i.id) || i.dailyWear || i.occasion !== kind) continue;
          if (!perBucket.has(i.bucket)) perBucket.set(i.bucket, i);
        }
      }

      /*
       * Then whatever else the activity asks for. The needs already say a beach
       * day wants sandals; until now they only guaranteed sandals were *packed*,
       * so the rotation could still put you on the sand in walking boots.
       */
      for (const need of ACTIVITIES.find((a) => a.id === activity)?.needs ?? []) {
        if (perBucket.has(need.bucket)) continue;
        const match = items.find(
          (i) =>
            bagOfItem.has(i.id) &&
            i.bucket === need.bucket &&
            need.match.test(`${i.subcategory ?? ""} ${i.name}`.toLowerCase()),
        );
        if (match) perBucket.set(need.bucket, match);
      }

      if (perBucket.size > 0) {
        occasionByDay[day] = [...perBucket.values()].map((i) => ({ id: i.id, bucket: i.bucket }));
      }
    }

    const cold = climate ? ["cool", "cold"].includes(climate.band) || climate.rainChance >= 0.4 : false;
    /*
     * Outerwear also shows whenever it is actually in the bag.
     *
     * The cold/wet test alone meant a packed jacket vanished from every look on
     * a warm trip — the plan silently ignoring a piece the user had put in the
     * bag on purpose. Auto-pack does not pack outerwear for a warm trip, so the
     * only way it is in there is a deliberate drag, and a deliberate drag is a
     * statement of intent to wear it.
     */
    const outerwearPacked = packed.some((p) => p.bucket === "outerwear");
    return planDailyOutfits({
      packed,
      // The trip's dates know how long it is; the forecast is only needed to
      // decide *what* to wear. Taking the length from `climate` meant an
      // unpinned destination produced a zero-day plan, which disabled the
      // Day-by-day panel and blamed it on unpacked clothes.
      days: climate?.days ?? tripDays,
      includeOuterwear: cold || outerwearPacked,
      wearMultiplier: wearMultiplier(requirements),
      occasionByDay,
    });
  }, [items, bagOfItem, climate, requirements, activityByDay, tripDays]);

  /**
   * Everything dropped in Pack mode lands here, garment or gear. The rail is a
   * zone too — dropping an orbiting piece back on it takes it out of the bag.
   */
  function handleDrop(payload: DragPayload, zoneId: string) {
    const target = zoneId === RAIL_ZONE ? NONE : zoneId;
    if (payload.kind === "gear") moveGear(payload.id, target);
    else moveItem(payload.id, target);
  }

  /* ------------------------------------------------------------ pack mode --- */

  const [packOpen, setPackOpen] = useState(false);
  /**
   * Returning from the composer reopens the carousel on the look you left.
   *
   * `?look=<day>` is written into the return URL when Edit is pressed, so the
   * round trip lands you back where you were rather than on the trip page with
   * the carousel closed. Read once, from the initial URL, so closing the
   * carousel does not immediately reopen it.
   */
  const searchParams = useSearchParams();
  const returningToLook = useMemo(() => {
    const raw = searchParams.get("look");
    if (!raw) return null;
    const day = Number.parseInt(raw, 10);
    return Number.isFinite(day) && day > 0 ? day : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [looksOpen, setLooksOpen] = useState(returningToLook != null);
  const [activeBagId, setActiveBagId] = useState<string>(bags[0]?.id ?? NONE);

  const itemCandidate = useCallback(
    (item: PlannerItem): PackCandidate => {
      const est = estimates.get(item.id);
      return {
        kind: "item",
        id: item.id,
        name: item.name,
        imagePath: item.imagePath,
        tile: item.tile,
        group: BUCKET_LABELS[item.bucket],
        volumeLiters: est?.volumeLiters ?? item.volumeLiters,
        weightGrams: est?.weightGrams ?? item.weightGrams,
        occasion: item.occasion,
        dailyWearOverride: item.dailyWearOverride,
      };
    },
    [estimates],
  );

  const gearCandidate = useCallback((row: PlannerGear): PackCandidate => {
    const { volumeLiters, weightGrams } = gearFootprint(row);
    return {
      kind: "gear",
      id: row.id,
      name: row.name,
      icon: gearIconName(row),
      group: gearCategoryLabel(row.category),
      volumeLiters,
      weightGrams,
    };
  }, []);

  /** Everything not in any bag, garments and gear together. */
  const packCandidates = useMemo(
    () => [
      ...items.filter((i) => !bagOfItem.has(i.id)).map(itemCandidate),
      ...gear.filter((g) => !bagOfGear.has(g.id)).map(gearCandidate),
    ],
    [items, gear, bagOfItem, bagOfGear, itemCandidate, gearCandidate],
  );

  const packBags = useMemo<PackBag[]>(
    () =>
      bags.map((bag) => {
        const u = usage.perBag.find((p) => p.bagId === bag.id);
        return {
          id: bag.id,
          name: bag.name,
          silhouette: getSilhouette(bag.silhouette).id,
          imagePath: bag.imagePath,
          volumeLiters: bag.volumeLiters,
          maxWeightGrams: u?.maxWeightGrams ?? null,
          usedVolumeLiters: u?.usedVolumeLiters ?? 0,
          usedWeightGrams: u?.usedWeightGrams ?? 0,
          overVolume: u?.overVolume ?? false,
          overWeight: u?.overWeight ?? false,
        };
      }),
    [bags, usage],
  );

  const packContents = useCallback(
    (bagId: string): PackCandidate[] => [
      ...(assignments[bagId] ?? [])
        .map((id) => itemById.get(id))
        .filter(Boolean)
        .map((i) => itemCandidate(i as PlannerItem)),
      ...(gearAssignments[bagId] ?? [])
        .map((id) => gearById.get(id))
        .filter(Boolean)
        .map((g) => gearCandidate(g as PlannerGear)),
    ],
    [assignments, gearAssignments, itemById, gearById, itemCandidate, gearCandidate],
  );

  /** Persist the whole requirements object; the chips are the source of truth. */
  async function saveRequirements(next: TripRequirements) {
    const previous = requirements;
    setRequirements(next);
    const res = await setTripRequirements({
      tripId: trip.id,
      activities: next.activities,
      activityDays: next.activityDays as Record<string, number> | undefined,
      laundry: next.laundry,
    });
    if (!res.ok) setRequirements(previous);
  }

  function toggleActivity(id: TripActivity) {
    const on = requirements.activities.includes(id);
    void saveRequirements({
      ...requirements,
      activities: on
        ? requirements.activities.filter((a) => a !== id)
        : [...requirements.activities, id],
    });
  }

  function setActivityDays(id: TripActivity, days: number) {
    void saveRequirements({
      ...requirements,
      activityDays: { ...requirements.activityDays, [id]: days },
    });
  }

  async function describeTrip() {
    const text = tripText.trim();
    if (!text) return;
    setParsing(true);
    setParseNote(null);
    const res = await parseTripDescription({ tripId: trip.id, text });
    setParsing(false);
    if (!res.ok) {
      setParseNote(res.error);
      return;
    }
    // Prefill and persist, but the chips stay editable — the parse is a
    // suggestion the user confirms, never a silent write of something they
    // didn't say.
    const next = res.parsed.requirements;
    setParseNote(
      res.parsed.summary +
        (res.parsed.source === "keywords" ? " (matched on keywords — check the chips.)" : ""),
    );
    await saveRequirements(next);
  }

  /** The day plan, resolved to real pieces the carousel can compose. */
  const lookDays = useMemo<LookDay[]>(
    () =>
      dayPlan.map((day) => {
        const date = new Date(trip.startDate);
        date.setUTCDate(date.getUTCDate() + day.day - 1);
        return {
          day: day.day,
          label: date.toLocaleDateString(undefined, {
            weekday: "short",
            month: "short",
            day: "numeric",
            timeZone: "UTC",
          }),
          complete: day.complete,
          rewear: day.rewear,
          activity: activityByDay.get(day.day) ? activityLabel(activityByDay.get(day.day)!) : null,
          pieces: day.itemIds
            .map((id) => itemById.get(id))
            .filter(Boolean)
            .map((i) => ({
              id: (i as PlannerItem).id,
              category: (i as PlannerItem).category,
              imagePath: (i as PlannerItem).imagePath,
              name: (i as PlannerItem).name,
              tile: (i as PlannerItem).tile,
            })),
        };
      }),
    [dayPlan, itemById, trip.startDate, activityByDay],
  );

  /** Persist a daily-rotation override, then re-read so the plan reflects it. */
  async function setDailyWear(itemId: string, dailyWear: boolean | null) {
    const res = await setItemDailyWear({ itemId, dailyWear });
    if (res.ok) router.refresh();
  }

  /** Open Pack mode, optionally straight onto a particular bag. */
  function openPackMode(bagId?: string) {
    const target = bagId && bags.some((b) => b.id === bagId) ? bagId : null;
    if (target) setActiveBagId(target);
    else if (!bags.some((b) => b.id === activeBagId)) setActiveBagId(bags[0]?.id ?? NONE);
    setPackOpen(true);
  }

  return (
    // Two columns from lg up: the plan on the left, what's actually in the bags
    // on the right. Below lg they stack in the same order.
    <PanelStateProvider>
    {/* One column now. Packing used to run down a sticky right-hand rail
        beside all of this; Pack mode replaced it. */}
    <div className="mx-auto max-w-3xl">
      <div className="space-y-8">
        <TripHeader trip={trip} onSaved={() => router.refresh()} />

      {/* Destination — where you're going, drawn, and what it'll be doing there.
          The city used to exist only as a string in the edit form, which meant
          the one fact the whole plan hangs on was the least visible thing on
          the page. */}
      <DestinationCard
        trip={trip}
        climate={climate}
        temperatureUnit={temperatureUnit}
        loadingClimate={loadingClimate}
        onRefreshClimate={handleFetchClimate}
        onClimateSet={(next) => setClimate(next)}
        onMoved={() => router.refresh()}
      />

      {/* The two doors. Both lead to a full-screen animated space, so they're
          built as a matched, mirrored pair rather than as two more pills in a
          row of pills — and each carries the number that says what's waiting
          inside. Auto-pack used to sit here; it moved into Pack mode, next to
          the bags it fills. */}
      <section className="flex flex-col gap-3 sm:flex-row">
        <SpaceTile
          title="Pack"
          glyph="orbit"
          align="left"
          disabled={bags.length === 0}
          onClick={() => openPackMode()}
          summary={
            packedIds.size + packedGearCount === 0
              ? "Nothing in the bags yet"
              : /* Split because the numbers answer different questions: the
                   litres and kilos are what the bag has to carry, garments are
                   what the day plan can dress you from. */
                `${formatVolume(usage.totals.volumeLiters)} · ${formatWeight(usage.totals.weightGrams)} · ${
                  packedIds.size
                } ${packedIds.size === 1 ? "garment" : "garments"}${
                  packedGearCount > 0 ? ` · ${packedGearCount} gear` : ""
                }`
          }
        />
        <SpaceTile
          title="Day by day"
          glyph="carousel"
          align="right"
          disabled={dayPlan.length === 0}
          onClick={() => setLooksOpen(true)}
          summary={
            dayPlan.length === 0
              ? tripDays === 0
                ? "Set the trip dates first"
                : "Pack some clothes first"
              : `${completeDayCount(dayPlan)} of ${dayPlan.length} days dressed${
                  distinctOutfitCount(dayPlan) > 0
                    ? ` · ${distinctOutfitCount(dayPlan)} distinct ${
                        distinctOutfitCount(dayPlan) === 1 ? "outfit" : "outfits"
                      }`
                    : ""
                }${
                  /* Reconciles with the packing warning's "covers N of M days",
                     which counts only days you can dress in clean clothes. */
                  rewearDayCount(dayPlan) > 0 ? ` · ${rewearDayCount(dayPlan)} need a re-wear` : ""
                }`
          }
        />
      </section>

      {warnings.length > 0 ? (
        <ul className="space-y-1 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
          {warnings.map((w, i) => (
            <li key={i}>• {w}</li>
          ))}
        </ul>
      ) : null}

      {/* What the trip is for — the input that stops every trip packing alike,
          and the only thing that can say a day is a beach day. */}
      <CollapsibleSection
        id="purpose"
        title="What's this trip for?"
        summary={
          requirements.activities.length > 0
            ? requirements.activities.map((a) => activityLabel(a)).join(", ")
            : "Nothing set"
        }
      >
        <p className="text-sm text-ink-muted">We&apos;ll make sure the bag covers it.</p>

        <div className="mt-3 flex flex-wrap items-start gap-2">
          <input
            value={tripText}
            onChange={(e) => setTripText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void describeTrip();
            }}
            placeholder="Or describe it: 5 days in Lisbon for a wedding, plus a beach day"
            className="min-w-0 flex-1 rounded-2xl border border-ink/15 bg-surface px-3.5 py-2 text-sm placeholder:text-ink-muted/60 focus:border-ink/30"
          />
          <button
            type="button"
            onClick={() => void describeTrip()}
            disabled={parsing || !tripText.trim()}
            className="rounded-full border border-ink/25 px-4 py-2 text-xs transition hover:bg-paper-warm disabled:opacity-40"
          >
            {parsing ? "Reading…" : "Read it"}
          </button>
        </div>
        {parseNote ? <p className="mt-2 text-xs text-ink-muted">{parseNote}</p> : null}

        <div className="mt-3 flex flex-wrap gap-1.5">
          {ACTIVITIES.map((a) => {
            const on = requirements.activities.includes(a.id);
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => toggleActivity(a.id)}
                aria-pressed={on}
                className={`rounded-full border px-3.5 py-1.5 text-xs transition ${
                  on
                    ? "border-ink bg-ink text-paper"
                    : "border-ink/15 bg-surface text-ink hover:bg-paper-warm"
                }`}
              >
                {a.label}
              </button>
            );
          })}
          <span aria-hidden className="mx-1 w-px self-stretch bg-ink/10" />
          <button
            type="button"
            onClick={() => void saveRequirements({ ...requirements, laundry: !requirements.laundry })}
            aria-pressed={requirements.laundry}
            className={`rounded-full border px-3.5 py-1.5 text-xs transition ${
              requirements.laundry
                ? "border-ink bg-ink text-paper"
                : "border-ink/15 bg-surface text-ink hover:bg-paper-warm"
            }`}
          >
            Laundry available
          </button>
        </div>

        {/* How many days each one takes. Ticking "Beach" says the trip has
            beach days; only you can say how many, and it's the difference
            between packing swimwear and wearing it. */}
        {requirements.activities.length > 0 ? (
          <div className="mt-4 space-y-2 border-t border-ink/10 pt-3">
            {ACTIVITIES.filter((a) => requirements.activities.includes(a.id)).map((a) => {
              const count = activityDayCount(requirements, a.id);
              const scheduled = [...activityByDay.entries()]
                .filter(([, id]) => id === a.id)
                .map(([day]) => day);
              return (
                <div key={a.id} className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="w-28 shrink-0">{a.label}</span>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={count}
                    onChange={(e) => setActivityDays(a.id, Number(e.target.value))}
                    className="w-16 rounded-lg border border-ink/15 bg-surface px-2 py-1 text-xs focus:border-ink/40 focus:outline-none"
                  />
                  <span className="text-ink-muted">
                    {count === 1 ? "day" : "days"}
                    {scheduled.length > 0 ? ` · day ${scheduled.join(", ")}` : ""}
                    {occasionForActivity(a.id) ? "" : " · no special clothes"}
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}
      </CollapsibleSection>

      {/* The occasion pieces are called out because they're deliberately
          missing from the day plan: without a line saying so, "11 of 11 days
          dressed" looks like it forgot the trunks. */}
      {occasionPacked.length > 0 ? (
        <p
          className="text-xs text-ink-muted"
          title={occasionPacked.map((i) => i.name).join(", ")}
        >
          Plus{" "}
          {[...new Set(occasionPacked.map((i) => i.occasion))]
            .filter(Boolean)
            .map((k) => occasionLabel(k as OccasionKind).toLowerCase())
            .join(" and ")}
          , kept out of the daily rotation
        </p>
      ) : null}

      {/* What each bag is carrying. Read-only: this is the plan reporting on
          itself, and every change to it happens in Pack mode. */}
      <BagsOverview
        bags={bags}
        usage={usage}
        contentsOf={packContents}
        onPack={openPackMode}
      />

      {/* Gear — the half of the bag that isn't clothes. Sits after the day
          plan because the outfits are the reason for the trip; the charger is
          the reason you're annoyed when you land without one. */}
      <GearSection
        gear={gear}
        bags={bags}
        bagOfGear={bagOfGear}
        climate={climate}
        onPack={() => openPackMode()}
      />

      {/* Packed summary: garment-type counts + total value */}
      {summary.total > 0 ? (
        <CollapsibleSection
          id="summary"
          title="Packed summary"
          summary={`${summary.total} ${summary.total === 1 ? "piece" : "pieces"}`}
        >
          <div className="flex flex-wrap items-baseline justify-end gap-3">
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-[0.18em] text-ink-muted">
                Total value
              </div>
              <div className="text-lg">{summary.valueLabel ?? "—"}</div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {summary.typeRows.map((row) => (
              <span
                key={row.label}
                className="inline-flex items-center gap-1.5 rounded-full bg-paper-warm px-3 py-1 text-sm"
              >
                <span className="font-medium">{row.count}</span>
                <span className="text-ink-muted">{row.label}</span>
              </span>
            ))}
          </div>
          {summary.valueLabel != null && summary.pricedCount < summary.total ? (
            <p className="mt-3 text-[11px] text-ink-muted">
              Value covers {summary.pricedCount} of {summary.total} packed{" "}
              {summary.total === 1 ? "item" : "items"} with a recorded price.
            </p>
          ) : null}
        </CollapsibleSection>
      ) : null}
      </div>

    </div>

    {/* The packing surface. Full screen, not a panel beside the plan. */}
    <AnimatePresence>
      {packOpen ? (
        <PackMode
          bags={packBags}
          candidates={packCandidates}
          contentsOf={packContents}
          activeBagId={activeBagId}
          onActiveBagChange={setActiveBagId}
          onDrop={handleDrop}
          onAdjustSize={saveOverride}
          onSetDailyWear={setDailyWear}
          onAutoPack={handleAutoPack}
          onEmptyBag={emptyBag}
          autoPacking={packing}
          flightId={flightId}
          flying={flying}
          warnings={warnings}
          onClose={() => setPackOpen(false)}
        />
      ) : null}
    </AnimatePresence>

    <AnimatePresence>
      {looksOpen ? (
        <LooksCarousel
          days={lookDays}
          prefs={lookPrefs}
          initialDay={returningToLook != null ? returningToLook - 1 : 0}
          onClose={() => setLooksOpen(false)}
          onEditLook={(day) => {
            /*
             * Hand the look to the Outfits page, and tell it how to get back.
             *
             * No `tab`: the look lands on the page's own default tab, the Smart
             * Generator, with the outfit loaded onto its canvas. That is the
             * point — the destination should be the Outfits page the user knows,
             * with a way back added, not a different corner of it.
             *
             * `returnTo` carries the trip URL plus the day, so the button on the
             * other side returns to this trip with the carousel reopened on the
             * same look rather than dropping the user on the trip page.
             */
            const params = new URLSearchParams({
              items: day.pieces.map((p) => p.id).join(","),
              returnTo: `/closet/smartpakker/${trip.id}?look=${day.day}`,
              returnLabel: `Back to ${trip.destination || "trip"}`,
            });
            router.push(`/closet/outfits?${params.toString()}`);
          }}
        />
      ) : null}
    </AnimatePresence>
    </PanelStateProvider>
  );
}

/**
 * The gear on this trip, grouped by what kind of thing it is.
 *
 * Reads from the user's library rather than from a per-trip list, so the
 * charger you described once is one tap away on every trip afterwards. Packing
 * a piece of gear is the same gesture as packing a garment — pick a bag — and
 * it lands in the same meters.
 */
function GearSection({
  gear,
  bags,
  bagOfGear,
  climate,
  onPack,
}: {
  gear: PlannerGear[];
  bags: PlannerBag[];
  bagOfGear: Map<string, string>;
  climate: ClimateSummary | null;
  onPack: () => void;
}) {
  const packedCount = gear.filter((g) => bagOfGear.has(g.id)).length;

  const suggestions = useMemo(
    () =>
      suggestGear({
        library: gear.map((g) => ({
          id: g.id,
          name: g.name,
          category: g.category,
          packed: bagOfGear.has(g.id),
        })),
        rainChance: climate?.rainChance ?? null,
        band: climate?.band ?? null,
        days: climate?.days ?? 0,
      }),
    [gear, bagOfGear, climate],
  );

  // Preserve GEAR_CATEGORIES order rather than whatever the query returned, so
  // documents stay at the top where the things you can't replace live.
  const groups = GEAR_CATEGORIES.map((category) => ({
    category: category.id,
    label: category.label,
    rows: gear.filter((g) => g.category === category.id),
  })).filter((group) => group.rows.length > 0);

  return (
    <CollapsibleSection
      id="gear"
      title="Gear"
      summary={gear.length > 0 ? `${packedCount} of ${gear.length} packed` : undefined}
      actions={
        <Link
          href="/closet/smartpakker/gear"
          className="text-xs text-ink-muted underline hover:text-ink"
        >
          Manage gear
        </Link>
      }
    >
      {gear.length === 0 ? (
        <p className="text-sm text-ink-muted">
          Chargers, passport, toiletries — the things that aren&apos;t clothes but still
          fill the bag.{" "}
          <Link href="/closet/smartpakker/gear" className="text-ink underline">
            Set up your gear
          </Link>{" "}
          once and it&apos;s here for every trip.
        </p>
      ) : (
        <>
          {suggestions.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {suggestions.map((suggestion) => (
                <li key={suggestion.id}>
                  {/* A suggestion, not an action: it opens the place where
                      packing happens rather than being a third way to do it. */}
                  <button
                    type="button"
                    disabled={bags.length === 0}
                    onClick={() => onPack()}
                    title={bags.length === 0 ? "Add a bag first" : "Open Pack mode"}
                    className="rounded-full border border-accent/50 bg-accent/10 px-3 py-1.5 text-xs transition hover:bg-accent/20 disabled:opacity-40"
                  >
                    {suggestion.name}
                    <span className="ml-1.5 text-ink-muted">— {suggestion.reason}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-4 space-y-4">
            {groups.map((group) => (
              <div key={group.category}>
                <h3 className="text-[10px] uppercase tracking-[0.18em] text-ink-muted">
                  {group.label}
                </h3>
                <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                  {group.rows.map((row) => (
                    <GearRow
                      key={row.id}
                      gear={row}
                      bagName={bags.find((b) => b.id === bagOfGear.get(row.id))?.name ?? null}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
    </CollapsibleSection>
  );
}

/**
 * One piece of gear: what it is, what it costs, and where it ended up.
 *
 * Read-only, like `BagsOverview`. It used to carry a drag handle and a bag
 * picker, but with the packing rail gone there is nowhere on this page to drop
 * anything, and a second way to assign bags is exactly what Pack mode replaced.
 */
function GearRow({
  gear,
  bagName,
}: {
  gear: PlannerGear;
  /** Null when it isn't in a bag. */
  bagName: string | null;
}) {
  const { weightGrams, volumeLiters, estimated } = gearFootprint(gear);
  const packed = bagName != null;

  return (
    <li
      className={`flex items-center gap-3 rounded-xl border p-2.5 ${
        packed ? "border-ink/15 bg-paper" : "border-ink/10 bg-paper/40"
      }`}
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
          packed ? "bg-accent/20 text-ink" : "bg-paper-warm text-ink-muted"
        }`}
      >
        <GearIcon name={gearIconName(gear)} className="h-5 w-5" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="truncate text-sm">{gear.name}</span>
          {gear.quantity > 1 ? (
            <span className="shrink-0 text-[11px] text-ink-muted">×{gear.quantity}</span>
          ) : null}
        </div>
        <div className="text-[11px] text-ink-muted">
          {formatWeight(weightGrams)} · {formatVolume(volumeLiters)}
          {/* Say so when the numbers are ours rather than theirs, so a bag
              reading 94% full can be trusted exactly as far as its inputs. */}
          {estimated ? <span className="ml-1 opacity-70">(est.)</span> : null}
        </div>
      </div>

      <span className="shrink-0 text-[11px] text-ink-muted">{bagName ?? "Not packed"}</span>
    </li>
  );
}

/**
 * Local time at the destination.
 *
 * Rendered empty on the server and filled in after mount: `new Date()` differs
 * between the server render and the client hydration, and React treats that as
 * a mismatch. Ticks every 30 seconds, which is enough for a clock showing only
 * hours and minutes.
 */
function LocalTime({ timezone }: { timezone: string | null }) {
  const [time, setTime] = useState<string | null>(null);

  useEffect(() => {
    if (!timezone) {
      setTime(null);
      return;
    }
    const tick = () => setTime(localTimeAt(timezone, new Date()));
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, [timezone]);

  if (!time) return null;
  return <span className="tabular-nums">{time} there</span>;
}

/**
 * The destination: a map window, the city itself, and the weather.
 *
 * These three were previously either missing or scattered — the city was a
 * text input buried in the edit form, the weather was its own card, and there
 * was no map at all. They belong together because they are one fact: where
 * this trip is and what it will be like.
 */
function DestinationCard({
  trip,
  climate,
  temperatureUnit,
  loadingClimate,
  onRefreshClimate,
  onClimateSet,
  onMoved,
}: {
  trip: PlannerTrip;
  climate: ClimateSummary | null;
  temperatureUnit: TemperatureUnit;
  loadingClimate: boolean;
  onRefreshClimate: () => void;
  onClimateSet: (climate: ClimateSummary) => void;
  onMoved: () => void;
}) {
  const [changing, setChanging] = useState(false);
  const [draft, setDraft] = useState(trip.destination);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(place: Place) {
    setSaving(true);
    setError(null);
    const res = await updateTrip({
      id: trip.id,
      place: {
        destination: placeLabel(place),
        latitude: place.latitude,
        longitude: place.longitude,
        countryCode: place.countryCode,
        timezone: place.timezone,
      },
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setChanging(false);
    onMoved();
  }

  /** Saving free text keeps the label but gives up the pin — see `updateTrip`. */
  async function saveTyped() {
    const text = draft.trim();
    if (!text || text === trip.destination) {
      setChanging(false);
      return;
    }
    setSaving(true);
    setError(null);
    const res = await updateTrip({ id: trip.id, destination: text });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setChanging(false);
    onMoved();
  }

  const located = trip.latitude != null && trip.longitude != null;

  return (
    <CollapsibleSection
      id="destination"
      title="Destination"
      summary={
        climate && climate.source !== "unknown"
          ? `${trip.destination} · ${BAND_LABELS[climate.band]}`
          : trip.destination
      }
      actions={
        <button
          type="button"
          onClick={onRefreshClimate}
          disabled={loadingClimate}
          className="rounded-full border border-ink/15 px-4 py-1.5 text-xs transition hover:bg-paper-warm disabled:opacity-50"
        >
          {loadingClimate ? "Checking…" : climate ? "Refresh weather" : "Check the weather"}
        </button>
      }
    >
      <WorldMap
        latitude={trip.latitude}
        longitude={trip.longitude}
        countryCode={trip.countryCode}
        label={trip.destination}
      />

      {/* The city itself. Read-only until you ask to change it, so a stray
          keystroke can't quietly move the trip somewhere else. */}
      <div className="mt-4">
        {changing ? (
          <div>
            <CityPicker
              value={draft}
              onChange={setDraft}
              onPick={(place) => void pick(place)}
              search={async (query) => {
                const res = await searchDestinations(query);
                return res.ok ? res.places : [];
              }}
              autoFocus
            />
            <div className="mt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={() => void saveTyped()}
                disabled={saving}
                className="rounded-full border border-ink/25 px-3.5 py-1.5 text-xs transition hover:bg-paper-warm disabled:opacity-40"
              >
                {saving ? "Saving…" : "Use what I typed"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraft(trip.destination);
                  setChanging(false);
                  setError(null);
                }}
                className="text-xs text-ink-muted underline hover:text-ink"
              >
                Cancel
              </button>
              <span className="text-[11px] text-ink-muted">
                Pick from the list to pin it on the map.
              </span>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span aria-hidden className="text-base leading-none">
              {flagEmoji(trip.countryCode)}
            </span>
            <span className="text-lg">{trip.destination}</span>
            <span className="text-xs text-ink-muted">
              <LocalTime timezone={trip.timezone} />
            </span>
            <button
              type="button"
              onClick={() => {
                setDraft(trip.destination);
                setChanging(true);
              }}
              className="text-xs text-ink-muted underline hover:text-ink"
            >
              Change
            </button>
          </div>
        )}
        {error ? <p className="mt-2 text-xs text-rose-700">{error}</p> : null}
        {!located && !changing ? (
          <p className="mt-1.5 text-[11px] text-ink-muted">
            Not pinned to a place yet — choose it from the list and we&apos;ll map it and
            fetch a real forecast.
          </p>
        ) : null}
      </div>

      {/* Weather. When the climate is "unknown" we have no coordinates and
          therefore no real numbers — showing the placeholder as a forecast is
          how a June trip to Ireland used to read "Hot, 28°C". Ask instead. */}
      <div className="mt-4 border-t border-ink/10 pt-4">
        {climate && climate.source === "unknown" ? (
          <ClimateUnknown
            tripId={trip.id}
            destination={trip.destination}
            temperatureUnit={temperatureUnit}
            onSet={onClimateSet}
          />
        ) : climate ? (
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
            {/* Not "Forecast" — the same row also carries past records and the
                user's own guess. The footnote below says which. */}
            <Stat label="Conditions" value={BAND_LABELS[climate.band]} />
            <Stat label="Avg high" value={formatTemperature(climate.avgHighC, temperatureUnit)} />
            <Stat label="Avg low" value={formatTemperature(climate.avgLowC, temperatureUnit)} />
            <Stat label="Rain" value={`${Math.round(climate.rainChance * 100)}%`} />
            <Stat label="Days" value={String(climate.days)} />
            <span className="text-[11px] text-ink-muted">
              {climate.source === "forecast"
                ? "Live forecast"
                : climate.source === "climatology"
                  ? "From past records"
                  : "You set this"}
            </span>
          </div>
        ) : (
          <p className="text-sm text-ink-muted">
            Check the weather to tailor the packing list to it.
          </p>
        )}
      </div>
    </CollapsibleSection>
  );
}

/** Preset highs, so setting the weather by hand is a tap rather than typing. */
const CLIMATE_PRESETS: { label: string; avgHighC: number }[] = [
  { label: "Hot", avgHighC: 31 },
  { label: "Warm", avgHighC: 25 },
  { label: "Mild", avgHighC: 18 },
  { label: "Cool", avgHighC: 11 },
  { label: "Cold", avgHighC: 3 },
];

/**
 * Shown when we couldn't work out the destination's weather. Deliberately does
 * not display the placeholder temperatures — the whole point of the fix is that
 * we stop presenting a guess as a forecast — and offers the two ways forward:
 * try the lookup, or say what it'll be like.
 */
function ClimateUnknown({
  tripId,
  destination,
  temperatureUnit,
  onSet,
}: {
  tripId: string;
  destination: string;
  temperatureUnit: TemperatureUnit;
  onSet: (climate: ClimateSummary) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(avgHighC: number) {
    setBusy(true);
    setError(null);
    const res = await setTripClimate({ tripId, avgHighC });
    setBusy(false);
    if (res.ok) onSet(res.climate);
    else setError(res.error);
  }

  return (
    <div className="mt-3">
      <p className="text-sm text-ink-muted">
        We don&apos;t know what the weather is like in {destination || "your destination"} for these
        dates, so the packing list is using a neutral guess. Tell us roughly what to expect:
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {CLIMATE_PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            disabled={busy}
            onClick={() => choose(p.avgHighC)}
            className="rounded-full border border-ink/15 bg-surface px-3.5 py-1.5 text-xs transition hover:bg-paper-warm disabled:opacity-50"
          >
            {p.label}
            <span className="ml-1.5 text-ink-muted">
              {formatTemperature(p.avgHighC, temperatureUnit)}
            </span>
          </button>
        ))}
      </div>
      {error && <p className="mt-2 text-xs text-rose-700">{error}</p>}
    </div>
  );
}


function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.18em] text-ink-muted">{label}</div>
      <div className="text-lg">{value}</div>
    </div>
  );
}

/**
 * Trip name and dates.
 *
 * The destination used to be edited here too. It moved to `DestinationCard`,
 * next to the map it pins and the forecast it drives — two places to change
 * the same field is one place too many, and this was the one where you
 * couldn't see the consequence of the change.
 */
function TripHeader({ trip, onSaved }: { trip: PlannerTrip; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [startDate, setStartDate] = useState(trip.startDate.slice(0, 10));
  const [endDate, setEndDate] = useState(trip.endDate.slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const range = formatTripRange(trip.startDate, trip.endDate);

  async function save() {
    setBusy(true);
    setError(null);
    const res = await updateTrip({ id: trip.id, startDate, endDate });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setEditing(false);
    onSaved();
  }

  if (editing) {
    return (
      <div className="rounded-2xl border border-ink/15 bg-surface p-5 shadow-tile">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-[11px] uppercase tracking-wide text-ink-muted">Leaving</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="mt-1 w-full rounded-xl border border-ink/15 bg-paper px-3 py-2 text-sm focus:border-ink/40 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wide text-ink-muted">
              Returning
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="mt-1 w-full rounded-xl border border-ink/15 bg-paper px-3 py-2 text-sm focus:border-ink/40 focus:outline-none"
            />
          </div>
        </div>
        {error ? <p className="mt-2 text-xs text-rose-700">{error}</p> : null}
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="rounded-full bg-ink px-4 py-2 text-xs tracking-wide text-paper transition hover:bg-ink-soft disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded-full border border-ink/15 px-4 py-2 text-xs transition hover:bg-paper-warm"
          >
            Cancel
          </button>
        </div>
        <p className="mt-2 text-[11px] text-ink-muted">
          Changing the dates resets the weather — check it again afterwards.
        </p>
      </div>
    );
  }

  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="font-serif text-4xl tracking-tight">{trip.name}</h1>
        <p className="mt-1 text-ink-muted">
          {trip.destination} · {range}
        </p>
      </div>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="rounded-full border border-ink/15 px-4 py-1.5 text-xs transition hover:bg-paper-warm"
      >
        Edit dates
      </button>
    </header>
  );
}

/**
 * Each bag and how full it is — a readout, not a control.
 *
 * This replaces the sticky rail that used to run down the right of the page
 * with its own copy of every item row, bag picker and remove button. That rail
 * was a second packing interface competing with Pack mode; what's worth keeping
 * on the plan is the answer it gave at a glance, which is this.
 */
function BagsOverview({
  bags,
  usage,
  contentsOf,
  onPack,
}: {
  bags: PlannerBag[];
  usage: ReturnType<typeof computeUsage>;
  contentsOf: (bagId: string) => PackCandidate[];
  onPack: (bagId: string) => void;
}) {
  if (bags.length === 0) {
    return (
      <div className="rounded-2xl bg-paper-warm p-6 text-sm text-ink-muted">
        This trip has no bags.{" "}
        <Link href="/closet/smartpakker/bags" className="text-ink underline">
          Add a bag
        </Link>{" "}
        then edit the trip to include it.
      </div>
    );
  }

  return (
    <CollapsibleSection
      id="bags"
      title="Bags"
      summary={`${bags.length} ${bags.length === 1 ? "bag" : "bags"}`}
    >
      <ul className="space-y-4">
        {bags.map((bag) => {
          const u = usage.perBag.find((p) => p.bagId === bag.id);
          const count = u?.itemIds.length ?? 0;
          return (
            <li key={bag.id} className="rounded-xl border border-ink/10 bg-paper/60 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{bag.name}</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-ink-muted">
                    {count} {count === 1 ? "item" : "items"}
                  </span>
                  <button
                    type="button"
                    onClick={() => onPack(bag.id)}
                    className="rounded-full border border-ink/15 px-3 py-1 text-xs transition hover:bg-paper-warm"
                  >
                    Pack this
                  </button>
                </div>
              </div>

              <div className="mt-3 space-y-2">
                <CapacityMeter
                  label="Volume"
                  used={u?.usedVolumeLiters ?? 0}
                  capacity={bag.volumeLiters}
                  incoming={null}
                  format={formatVolume}
                  over={u?.overVolume ?? false}
                />
                {u?.maxWeightGrams != null ? (
                  <CapacityMeter
                    label="Weight"
                    used={u.usedWeightGrams}
                    capacity={u.maxWeightGrams}
                    incoming={null}
                    format={formatWeight}
                    over={u.overWeight}
                  />
                ) : null}
              </div>

              <BagContents contents={contentsOf(bag.id)} />
            </li>
          );
        })}
      </ul>
    </CollapsibleSection>
  );
}

/**
 * What's actually inside one bag.
 *
 * Closed by default: the point of the overview is the meters, and five bags
 * unrolled would put the page back where it was before Pack mode. Read-only —
 * this says what's in there, Pack mode changes it.
 */
function BagContents({ contents }: { contents: PackCandidate[] }) {
  const [open, setOpen] = useState(false);
  const reduceMotion = useReducedMotion();

  if (contents.length === 0) {
    return <p className="mt-3 text-[11px] text-ink-muted">Empty.</p>;
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="text-[11px] text-ink-muted underline hover:text-ink"
      >
        {open ? "Hide contents" : `Show all ${contents.length}`}
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            initial={reduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.24, ease: easeOutExpo }}
            className="overflow-hidden"
          >
            <ul className="mt-2 grid gap-1 sm:grid-cols-2">
              {contents.map((entry) => (
                <li
                  key={`${entry.kind}:${entry.id}`}
                  className="flex items-center gap-2 rounded-lg bg-paper px-2 py-1.5"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded bg-paper-warm">
                    {entry.kind === "item" && entry.imagePath ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={thumbnailUrl(entry.imagePath)}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <GearIcon name={entry.icon ?? "pouch"} className="h-3.5 w-3.5 text-ink-muted" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[11px]">{entry.name}</span>
                  {entry.occasion ? (
                    <span className="shrink-0 rounded-full bg-paper-warm px-1.5 text-[10px] text-ink-muted">
                      {occasionLabel(entry.occasion)}
                    </span>
                  ) : null}
                  <span className="shrink-0 text-[10px] text-ink-muted">
                    {formatVolume(entry.volumeLiters)}
                  </span>
                </li>
              ))}
            </ul>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
