"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { encode, parseColors, parseSeasons, parseStringArray, type Season } from "@/lib/json";
import { saveUpload, deleteUpload, UploadError } from "@/lib/uploads";
import { DEFAULT_SILHOUETTE_ID, isSilhouetteId } from "@/lib/packing/silhouettes";
import { buildPackingPlan, type PackableItem, type PackingPlan } from "@/lib/packing/plan";
import {
  GEAR_PRESETS,
  gearFootprint,
  isGearCategory,
  parseGearCategory,
  type GearCategory,
} from "@/lib/packing/gear";
import {
  isTripActivity,
  parseTripRequirements,
  type TripActivity,
  type TripRequirements,
} from "@/lib/packing/requirements";
import { parseTripText, type TripParse } from "@/lib/services/tripParser";
import { searchPlaces, type Place } from "@/lib/services/geocode";
import {
  getClimateSummary,
  manualClimateSummary,
  type ClimateSummary,
} from "@/lib/services/weather";

type Result<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

const NAME_MAX = 80;
const DEST_MAX = 120;

/* ----------------------------------------------------------------- bags --- */

/** Upload a silhouette photo for a bag; returns its stored relative path. */
export async function uploadBagImage(formData: FormData): Promise<Result<{ imagePath: string }>> {
  const user = await requireUser();
  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "No file provided" };
  }
  try {
    const saved = await saveUpload(file, user.id);
    return { ok: true, imagePath: saved.originalImagePath };
  } catch (err) {
    if (err instanceof UploadError) return { ok: false, error: err.message };
    throw err;
  }
}

export type BagInput = {
  name: string;
  volumeLiters: number;
  maxWeightKg?: number | null;
  silhouette: string;
  imagePath?: string | null;
};

function normalizeBagInput(input: BagInput): Result<{ data: Required<BagInput> }> {
  const name = input.name.trim().slice(0, NAME_MAX);
  if (!name) return { ok: false, error: "Bag name is required" };
  const volumeLiters = Number(input.volumeLiters);
  if (!Number.isFinite(volumeLiters) || volumeLiters <= 0) {
    return { ok: false, error: "Enter a volume in litres" };
  }
  const maxWeightKg =
    input.maxWeightKg == null || input.maxWeightKg === ("" as unknown)
      ? null
      : Number(input.maxWeightKg);
  if (maxWeightKg != null && (!Number.isFinite(maxWeightKg) || maxWeightKg <= 0)) {
    return { ok: false, error: "Weight limit must be a positive number" };
  }
  const silhouette = isSilhouetteId(input.silhouette) ? input.silhouette : DEFAULT_SILHOUETTE_ID;
  return {
    ok: true,
    data: {
      name,
      volumeLiters: Math.round(volumeLiters * 10) / 10,
      maxWeightKg: maxWeightKg == null ? null : Math.round(maxWeightKg * 10) / 10,
      silhouette,
      imagePath: input.imagePath ?? null,
    },
  };
}

export async function createBag(input: BagInput): Promise<Result<{ id: string }>> {
  const user = await requireUser();
  const norm = normalizeBagInput(input);
  if (!norm.ok) return norm;
  if (norm.data.imagePath && !norm.data.imagePath.startsWith(`${user.id}/`)) {
    return { ok: false, error: "Image does not belong to this user" };
  }
  const bag = await prisma.packingBag.create({
    data: { userId: user.id, ...norm.data },
    select: { id: true },
  });
  revalidatePath("/closet/smartpakker");
  return { ok: true, id: bag.id };
}

export async function updateBag(input: BagInput & { id: string }): Promise<Result> {
  const user = await requireUser();
  const existing = await prisma.packingBag.findUnique({
    where: { id: input.id },
    select: { userId: true, imagePath: true },
  });
  if (!existing || existing.userId !== user.id) return { ok: false, error: "Bag not found" };
  const norm = normalizeBagInput(input);
  if (!norm.ok) return norm;
  if (norm.data.imagePath && !norm.data.imagePath.startsWith(`${user.id}/`)) {
    return { ok: false, error: "Image does not belong to this user" };
  }
  // Clean up a replaced silhouette photo.
  if (existing.imagePath && existing.imagePath !== norm.data.imagePath) {
    await deleteUpload(existing.imagePath);
  }
  await prisma.packingBag.update({ where: { id: input.id }, data: norm.data });
  revalidatePath("/closet/smartpakker");
  return { ok: true };
}

export async function deleteBag(id: string): Promise<Result> {
  const user = await requireUser();
  const bag = await prisma.packingBag.findUnique({
    where: { id },
    select: { userId: true, imagePath: true },
  });
  if (!bag || bag.userId !== user.id) return { ok: false, error: "Bag not found" };
  if (bag.imagePath) await deleteUpload(bag.imagePath);
  await prisma.packingBag.delete({ where: { id } });
  revalidatePath("/closet/smartpakker");
  return { ok: true };
}

/* ------------------------------------------------------------- places --- */

/**
 * Type-ahead for the destination field.
 *
 * Read-only and rate-limited by nothing but the provider's own day-long cache,
 * so it's safe to call per keystroke from a debounced input. Requires a signed-in
 * user purely so an open endpoint can't be used to proxy the geocoder.
 */
export async function searchDestinations(query: string): Promise<Result<{ places: Place[] }>> {
  await requireUser();
  return { ok: true, places: await searchPlaces(query) };
}

/**
 * A destination chosen from the picker, rather than typed.
 *
 * Carrying the coordinates through from the moment of choice is the whole
 * point: the trip stores where it actually is, so the map can pin it and the
 * climate lookup never has to guess at the string again.
 */
export type PlacePick = {
  destination: string;
  latitude: number;
  longitude: number;
  countryCode?: string | null;
  timezone?: string | null;
};

/** Reject a pick whose coordinates aren't real coordinates. */
function normalizePlace(place: PlacePick): Result<{ data: Required<PlacePick> }> {
  const destination = place.destination.trim().slice(0, DEST_MAX);
  if (!destination) return { ok: false, error: "Where are you going?" };
  const { latitude, longitude } = place;
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  ) {
    return { ok: false, error: "That place has no usable coordinates" };
  }
  const countryCode =
    typeof place.countryCode === "string" && /^[A-Za-z]{2}$/.test(place.countryCode)
      ? place.countryCode.toUpperCase()
      : null;
  return {
    ok: true,
    data: {
      destination,
      latitude,
      longitude,
      countryCode,
      timezone: place.timezone?.slice(0, 64) || null,
    },
  };
}

/* ---------------------------------------------------------------- trips --- */

function parseDate(value: string | Date): Date | null {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function createTrip(input: {
  name: string;
  destination: string;
  /** Set when the destination came from the picker; carries its coordinates. */
  place?: PlacePick | null;
  startDate: string;
  endDate: string;
  bagIds?: string[];
}): Promise<Result<{ id: string }>> {
  const user = await requireUser();
  const name = input.name.trim().slice(0, NAME_MAX);
  const destination = input.destination.trim().slice(0, DEST_MAX);
  if (!name) return { ok: false, error: "Trip name is required" };
  if (!destination) return { ok: false, error: "Where are you going?" };

  // A pick is only honoured if it agrees with the text in the field. Otherwise
  // someone who chose Seoul and then typed over it would get a trip labelled
  // "Busan" pinned to Seoul's coordinates.
  let located: Required<PlacePick> | null = null;
  if (input.place && input.place.destination.trim() === destination) {
    const norm = normalizePlace(input.place);
    if (!norm.ok) return norm;
    located = norm.data;
  }

  const start = parseDate(input.startDate);
  const end = parseDate(input.endDate);
  if (!start || !end) return { ok: false, error: "Enter valid dates" };
  if (end < start) return { ok: false, error: "End date is before the start date" };

  const bagIds = await ownedBagIds(user.id, input.bagIds ?? []);

  const trip = await prisma.packingTrip.create({
    data: {
      userId: user.id,
      name,
      destination,
      latitude: located?.latitude ?? null,
      longitude: located?.longitude ?? null,
      countryCode: located?.countryCode ?? null,
      timezone: located?.timezone ?? null,
      startDate: start,
      endDate: end,
      bagIds: encode(bagIds),
      assignments: "{}",
    },
    select: { id: true },
  });
  revalidatePath("/closet/smartpakker");
  return { ok: true, id: trip.id };
}

export async function updateTrip(input: {
  id: string;
  name?: string;
  destination?: string;
  /** A destination chosen from the picker. Takes precedence over `destination`. */
  place?: PlacePick | null;
  startDate?: string;
  endDate?: string;
  bagIds?: string[];
  assignments?: Record<string, string[]>;
}): Promise<Result> {
  const user = await requireUser();
  const existing = await prisma.packingTrip.findUnique({
    where: { id: input.id },
    select: { userId: true },
  });
  if (!existing || existing.userId !== user.id) return { ok: false, error: "Trip not found" };

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const name = input.name.trim().slice(0, NAME_MAX);
    if (!name) return { ok: false, error: "Trip name is required" };
    data.name = name;
  }
  if (input.place) {
    const norm = normalizePlace(input.place);
    if (!norm.ok) return norm;
    data.destination = norm.data.destination;
    data.latitude = norm.data.latitude;
    data.longitude = norm.data.longitude;
    data.countryCode = norm.data.countryCode;
    data.timezone = norm.data.timezone;
    // Somewhere else → stored climate is stale.
    data.climateData = null;
  } else if (input.destination !== undefined) {
    const destination = input.destination.trim().slice(0, DEST_MAX);
    if (!destination) return { ok: false, error: "Where are you going?" };
    data.destination = destination;
    // Typed over by hand, so the old coordinates no longer describe the text.
    // Clearing them sends the climate lookup back to searching the string —
    // worse than a pin, but honest, where stale coordinates would silently
    // forecast the previous city.
    data.latitude = null;
    data.longitude = null;
    data.countryCode = null;
    data.timezone = null;
    data.climateData = null;
  }
  if (input.startDate !== undefined) {
    const start = parseDate(input.startDate);
    if (!start) return { ok: false, error: "Enter a valid start date" };
    data.startDate = start;
    data.climateData = null;
  }
  if (input.endDate !== undefined) {
    const end = parseDate(input.endDate);
    if (!end) return { ok: false, error: "Enter a valid end date" };
    data.endDate = end;
    data.climateData = null;
  }
  if (input.bagIds !== undefined) {
    data.bagIds = encode(await ownedBagIds(user.id, input.bagIds));
  }
  if (input.assignments !== undefined) {
    data.assignments = encode(await sanitizeAssignments(user.id, input.assignments));
  }
  if (Object.keys(data).length === 0) return { ok: true };

  await prisma.packingTrip.update({ where: { id: input.id }, data });
  revalidatePath("/closet/smartpakker");
  revalidatePath(`/closet/smartpakker/${input.id}`);
  return { ok: true };
}

export async function deleteTrip(id: string): Promise<Result> {
  const user = await requireUser();
  const trip = await prisma.packingTrip.findUnique({ where: { id }, select: { userId: true } });
  if (!trip || trip.userId !== user.id) return { ok: false, error: "Trip not found" };
  await prisma.packingTrip.delete({ where: { id } });
  revalidatePath("/closet/smartpakker");
  return { ok: true };
}

/** Keep only bag ids that belong to the user, in their given order. */
async function ownedBagIds(userId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const owned = await prisma.packingBag.findMany({
    where: { userId, id: { in: ids } },
    select: { id: true },
  });
  const ownedSet = new Set(owned.map((b) => b.id));
  return ids.filter((id) => ownedSet.has(id));
}

/** Drop unknown bag/item ids from an assignment map. */
async function sanitizeAssignments(
  userId: string,
  assignments: Record<string, string[]>,
): Promise<Record<string, string[]>> {
  const bagIds = Object.keys(assignments);
  const itemIds = [...new Set(Object.values(assignments).flat())];
  const [bags, items] = await Promise.all([
    prisma.packingBag.findMany({ where: { userId, id: { in: bagIds } }, select: { id: true } }),
    itemIds.length
      ? prisma.wardrobeItem.findMany({ where: { userId, id: { in: itemIds } }, select: { id: true } })
      : Promise.resolve([] as { id: string }[]),
  ]);
  const okBags = new Set(bags.map((b) => b.id));
  const okItems = new Set(items.map((i) => i.id));
  const out: Record<string, string[]> = {};
  for (const [bagId, list] of Object.entries(assignments)) {
    if (!okBags.has(bagId)) continue;
    out[bagId] = list.filter((id) => okItems.has(id));
  }
  return out;
}

/* ------------------------------------------------------------- climate --- */

export async function fetchTripClimate(tripId: string): Promise<Result<{ climate: ClimateSummary }>> {
  const user = await requireUser();
  const trip = await prisma.packingTrip.findUnique({ where: { id: tripId } });
  if (!trip || trip.userId !== user.id) return { ok: false, error: "Trip not found" };

  const climate = await getClimateSummary({
    destination: trip.destination,
    start: trip.startDate,
    end: trip.endDate,
    latitude: trip.latitude,
    longitude: trip.longitude,
  });
  await prisma.packingTrip.update({
    where: { id: tripId },
    data: { climateData: encode(climate) },
  });
  revalidatePath(`/closet/smartpakker/${tripId}`);
  return { ok: true, climate };
}

/**
 * Set the trip's weather by hand.
 *
 * The escape hatch for when we can't work it out — no weather provider
 * configured, an unresolvable destination, or simply a forecast the user knows
 * better than we do. Stored in the same `climateData` column with
 * `source: "manual"`, which outranks anything we'd infer and survives a
 * "Refresh climate" unless the user explicitly asks for one.
 */
export async function setTripClimate(input: {
  tripId: string;
  avgHighC: number;
  avgLowC?: number | null;
  rainChance?: number | null;
}): Promise<Result<{ climate: ClimateSummary }>> {
  const user = await requireUser();
  const trip = await prisma.packingTrip.findUnique({ where: { id: input.tripId } });
  if (!trip || trip.userId !== user.id) return { ok: false, error: "Trip not found" };

  if (!Number.isFinite(input.avgHighC)) return { ok: false, error: "Enter a typical high" };
  // Wide enough for Yakutsk and Death Valley; anything outside is a typo.
  if (input.avgHighC < -60 || input.avgHighC > 60) {
    return { ok: false, error: "That temperature doesn't look right" };
  }

  const climate = manualClimateSummary({
    destination: trip.destination,
    avgHighC: input.avgHighC,
    avgLowC: input.avgLowC,
    rainChance: input.rainChance,
    start: trip.startDate,
    end: trip.endDate,
  });

  await prisma.packingTrip.update({
    where: { id: input.tripId },
    data: { climateData: encode(climate) },
  });
  revalidatePath(`/closet/smartpakker/${input.tripId}`);
  return { ok: true, climate };
}

/**
 * Record what the trip is for.
 *
 * The planner had no way to tell a wedding from a hiking week, so every trip to
 * the same place in the same week packed identically. These chips are the
 * missing input; an AI parser can later fill the same structure from free text
 * without the planner knowing a model was involved.
 */
export async function setTripRequirements(input: {
  tripId: string;
  activities: string[];
  /** How many days each activity claims. See lib/packing/requirements.ts. */
  activityDays?: Record<string, number>;
  laundry: boolean;
}): Promise<Result<{ requirements: TripRequirements }>> {
  const user = await requireUser();
  const trip = await prisma.packingTrip.findUnique({
    where: { id: input.tripId },
    select: { userId: true },
  });
  if (!trip || trip.userId !== user.id) return { ok: false, error: "Trip not found" };

  const activities = [...new Set(input.activities.filter(isTripActivity))] as TripActivity[];
  const activityDays: Partial<Record<TripActivity, number>> = {};
  for (const [key, value] of Object.entries(input.activityDays ?? {})) {
    // Only for activities actually selected: a count left behind by an
    // unticked chip would come back the moment it was re-ticked.
    if (!isTripActivity(key) || !activities.includes(key)) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    activityDays[key] = Math.min(30, Math.max(1, Math.round(value)));
  }

  const requirements: TripRequirements = {
    activities,
    laundry: input.laundry === true,
    ...(Object.keys(activityDays).length > 0 ? { activityDays } : {}),
  };
  await prisma.packingTrip.update({
    where: { id: input.tripId },
    data: { requirements: encode(requirements) },
  });
  revalidatePath(`/closet/smartpakker/${input.tripId}`);
  return { ok: true, requirements };
}


/* ----------------------------------------------------------------- gear --- */

const GEAR_NAME_MAX = 60;
const GEAR_NOTES_MAX = 200;
/** Nobody packs 500 of anything, and a huge quantity is a typo that wrecks a meter. */
const GEAR_QUANTITY_MAX = 99;

export type GearInput = {
  name: string;
  category: string;
  icon?: string | null;
  quantity?: number | null;
  weightGrams?: number | null;
  volumeLiters?: number | null;
  notes?: string | null;
  essential?: boolean;
};

type NormalizedGear = {
  name: string;
  category: GearCategory;
  icon: string | null;
  quantity: number;
  weightGrams: number | null;
  volumeLiters: number | null;
  notes: string | null;
  essential: boolean;
};

/**
 * Blank and unparseable measurements both become null, not zero.
 *
 * The distinction matters downstream: null means "we'll estimate this from the
 * category and say so", while zero means "this genuinely weighs nothing" and
 * would silently under-report a full bag. See lib/packing/gear.ts.
 */
function optionalNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function normalizeGear(input: GearInput): Result<{ data: NormalizedGear }> {
  const name = input.name.trim().slice(0, GEAR_NAME_MAX);
  if (!name) return { ok: false, error: "Give it a name" };

  const quantity = Math.min(
    GEAR_QUANTITY_MAX,
    Math.max(1, Math.round(Number(input.quantity ?? 1) || 1)),
  );
  const weightGrams = optionalNumber(input.weightGrams);
  const volumeLiters = optionalNumber(input.volumeLiters);

  return {
    ok: true,
    data: {
      name,
      category: isGearCategory(input.category ?? "") ? (input.category as GearCategory) : parseGearCategory(null),
      icon: input.icon?.trim().slice(0, 40) || null,
      quantity,
      weightGrams: weightGrams == null ? null : Math.round(weightGrams),
      volumeLiters: volumeLiters == null ? null : Math.round(volumeLiters * 10) / 10,
      notes: input.notes?.trim().slice(0, GEAR_NOTES_MAX) || null,
      essential: input.essential === true,
    },
  };
}

export async function createGear(input: GearInput): Promise<Result<{ id: string }>> {
  const user = await requireUser();
  const norm = normalizeGear(input);
  if (!norm.ok) return norm;
  const gear = await prisma.packingGear.create({
    data: { userId: user.id, ...norm.data },
    select: { id: true },
  });
  revalidateGear();
  return { ok: true, id: gear.id };
}

export async function updateGear(input: GearInput & { id: string }): Promise<Result> {
  const user = await requireUser();
  const existing = await prisma.packingGear.findUnique({
    where: { id: input.id },
    select: { userId: true },
  });
  if (!existing || existing.userId !== user.id) return { ok: false, error: "Gear not found" };
  const norm = normalizeGear(input);
  if (!norm.ok) return norm;
  await prisma.packingGear.update({ where: { id: input.id }, data: norm.data });
  revalidateGear();
  return { ok: true };
}

/**
 * Delete a piece of gear.
 *
 * Trips reference gear by id inside a JSON blob, which no foreign key protects,
 * so a delete would leave dangling ids in every trip that packed it. Rather
 * than rewrite every trip's assignment map on the way out, the read path drops
 * ids it can't resolve — the same thing `sanitizeAssignments` already does for
 * garments.
 */
export async function deleteGear(id: string): Promise<Result> {
  const user = await requireUser();
  const gear = await prisma.packingGear.findUnique({ where: { id }, select: { userId: true } });
  if (!gear || gear.userId !== user.id) return { ok: false, error: "Gear not found" };
  await prisma.packingGear.delete({ where: { id } });
  revalidateGear();
  return { ok: true };
}

/**
 * Fill an empty library from the preset list.
 *
 * Only adds what isn't already there by name, so pressing it twice doesn't
 * double your toothbrush.
 */
export async function addGearPresets(names: string[]): Promise<Result<{ added: number }>> {
  const user = await requireUser();
  const wanted = new Set(names);
  const presets = GEAR_PRESETS.filter((p) => wanted.has(p.name));
  if (presets.length === 0) return { ok: true, added: 0 };

  const existing = await prisma.packingGear.findMany({
    where: { userId: user.id, name: { in: presets.map((p) => p.name) } },
    select: { name: true },
  });
  const have = new Set(existing.map((g) => g.name.toLowerCase()));
  const fresh = presets.filter((p) => !have.has(p.name.toLowerCase()));
  if (fresh.length === 0) return { ok: true, added: 0 };

  await prisma.packingGear.createMany({
    data: fresh.map((p) => ({
      userId: user.id,
      name: p.name,
      category: p.category,
      icon: p.icon ?? null,
      quantity: 1,
      weightGrams: p.weightGrams,
      volumeLiters: p.volumeLiters,
      essential: p.essential === true,
    })),
  });
  revalidateGear();
  return { ok: true, added: fresh.length };
}

/**
 * Save which gear sits in which bag for a trip.
 *
 * Mirrors `updateTrip`'s handling of garment assignments, including dropping
 * ids the user doesn't own — the map arrives from the client and is not to be
 * trusted with either bag ids or gear ids.
 */
export async function setTripGear(input: {
  tripId: string;
  assignments: Record<string, string[]>;
}): Promise<Result> {
  const user = await requireUser();
  const trip = await prisma.packingTrip.findUnique({
    where: { id: input.tripId },
    select: { userId: true },
  });
  if (!trip || trip.userId !== user.id) return { ok: false, error: "Trip not found" };

  const bagIds = Object.keys(input.assignments);
  const gearIds = [...new Set(Object.values(input.assignments).flat())];
  const [bags, gear] = await Promise.all([
    prisma.packingBag.findMany({ where: { userId: user.id, id: { in: bagIds } }, select: { id: true } }),
    gearIds.length
      ? prisma.packingGear.findMany({
          where: { userId: user.id, id: { in: gearIds } },
          select: { id: true },
        })
      : Promise.resolve([] as { id: string }[]),
  ]);
  const okBags = new Set(bags.map((b) => b.id));
  const okGear = new Set(gear.map((g) => g.id));

  const clean: Record<string, string[]> = {};
  for (const [bagId, list] of Object.entries(input.assignments)) {
    if (!okBags.has(bagId)) continue;
    clean[bagId] = list.filter((id) => okGear.has(id));
  }

  await prisma.packingTrip.update({
    where: { id: input.tripId },
    data: { gearAssignments: encode(clean) },
  });
  revalidatePath(`/closet/smartpakker/${input.tripId}`);
  return { ok: true };
}

/**
 * How much volume and weight the gear assigned to each bag accounts for.
 *
 * Shared by the planner so it packs into what's left rather than into the
 * bag's rated size. Unknown gear ids are skipped, which is the same tolerance
 * the read path applies — see `deleteGear`.
 */
async function reservedByGear(
  userId: string,
  gearAssignmentsJson: string,
): Promise<Map<string, { volumeLiters: number; weightGrams: number }>> {
  let assignments: Record<string, string[]>;
  try {
    const parsed = JSON.parse(gearAssignmentsJson) as Record<string, string[]>;
    assignments = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return new Map();
  }

  const gearIds = [...new Set(Object.values(assignments).flat())];
  if (gearIds.length === 0) return new Map();

  const rows = await prisma.packingGear.findMany({
    where: { userId, id: { in: gearIds } },
    select: { id: true, category: true, quantity: true, weightGrams: true, volumeLiters: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));

  const out = new Map<string, { volumeLiters: number; weightGrams: number }>();
  for (const [bagId, ids] of Object.entries(assignments)) {
    let volumeLiters = 0;
    let weightGrams = 0;
    for (const id of ids) {
      const row = byId.get(id);
      if (!row) continue;
      const footprint = gearFootprint({
        category: parseGearCategory(row.category),
        quantity: row.quantity,
        weightGrams: row.weightGrams,
        volumeLiters: row.volumeLiters,
      });
      volumeLiters += footprint.volumeLiters;
      weightGrams += footprint.weightGrams;
    }
    out.set(bagId, { volumeLiters, weightGrams });
  }
  return out;
}

const formatLiters = (liters: number) => `${Math.round(liters * 10) / 10} L`;

/** Gear shows up on the library page and inside every trip. */
function revalidateGear() {
  revalidatePath("/closet/smartpakker/gear");
  revalidatePath("/closet/smartpakker");
}

/* ---------------------------------------------------------------- plan --- */

export async function generatePackingPlan(
  tripId: string,
): Promise<Result<{ plan: PackingPlan; climate: ClimateSummary }>> {
  const user = await requireUser();
  const trip = await prisma.packingTrip.findUnique({ where: { id: tripId } });
  if (!trip || trip.userId !== user.id) return { ok: false, error: "Trip not found" };

  // Resolve climate (use stored summary, else fetch fresh).
  let climate = trip.climateData
    ? (JSON.parse(trip.climateData) as ClimateSummary)
    : null;
  if (!climate) {
    climate = await getClimateSummary({
      destination: trip.destination,
      start: trip.startDate,
      end: trip.endDate,
      latitude: trip.latitude,
      longitude: trip.longitude,
    });
    await prisma.packingTrip.update({
      where: { id: tripId },
      data: { climateData: encode(climate) },
    });
  }

  const bagIds = parseStringArray(trip.bagIds);
  const bags = (
    await prisma.packingBag.findMany({
      where: { userId: user.id, id: { in: bagIds.length ? bagIds : ["__none__"] } },
      select: { id: true, volumeLiters: true, maxWeightKg: true },
    })
  )
    // Preserve the user's chosen bag order.
    .sort((a, b) => bagIds.indexOf(a.id) - bagIds.indexOf(b.id));

  // Space the gear has already taken, per bag.
  //
  // The planner only ever sees garments, so without this it fills each bag to
  // its full rated volume and lands on top of whatever is already in there —
  // an 18L daypack holding a 2.5L wash bag got packed to 20.3L. Handing it the
  // *remaining* capacity keeps the plan honest without the packing algorithm
  // needing to learn what a toothbrush is.
  const reserved = await reservedByGear(user.id, trip.gearAssignments);
  const packable = bags.map((bag) => {
    const used = reserved.get(bag.id);
    const maxWeightGrams = bag.maxWeightKg == null ? null : bag.maxWeightKg * 1000;
    return {
      id: bag.id,
      volumeLiters: Math.max(0, Math.round((bag.volumeLiters - (used?.volumeLiters ?? 0)) * 10) / 10),
      maxWeightKg:
        maxWeightGrams == null
          ? null
          : Math.max(0, Math.round(maxWeightGrams - (used?.weightGrams ?? 0)) / 1000),
    };
  });

  const rows = await prisma.wardrobeItem.findMany({
    where: {
      userId: user.id,
      isWishlist: false,
      // Don't auto-pack pieces you're trying to sell — the last two trips each
      // packed three for-sale items. "skipped" means the user chose to keep it,
      // so those stay eligible. The user can still add any of these by hand.
      NOT: { saleListing: { status: { in: ["for_sale", "listed", "sold"] } } },
    },
    select: {
      id: true,
      name: true,
      category: true,
      subcategory: true,
      material: true,
      season: true,
      colors: true,
      weightGrams: true,
      volumeLiters: true,
      dailyWear: true,
    },
  });
  const items: PackableItem[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    subcategory: r.subcategory,
    material: r.material,
    season: parseSeasons(r.season) as Season[],
    // Colour drives the versatility term in climateScore — omitting it would
    // silently flatten selection back to a 3-valued warmth score.
    colors: parseColors(r.colors),
    weightGrams: r.weightGrams,
    volumeLiters: r.volumeLiters,
    // Lets the packer keep swimwear out of the ordinary rotation while still
    // reaching it for an activity that asks for it. See lib/packing/occasion.ts.
    dailyWear: r.dailyWear,
  }));

  const plan = buildPackingPlan({
    items,
    bags: packable,
    days: climate.days,
    band: climate.band,
    requirements: parseTripRequirements(trip.requirements),
    rainChance: climate.rainChance,
  });

  for (const bag of packable) {
    if (bag.volumeLiters > 0.05) continue;
    const original = bags.find((b) => b.id === bag.id);
    plan.warnings.push(
      `Gear fills ${original ? formatLiters(original.volumeLiters) : "a bag"} of a bag on its own — there's no room left for clothes in it.`,
    );
  }

  await prisma.packingTrip.update({
    where: { id: tripId },
    data: { assignments: encode(plan.assignments) },
  });
  revalidatePath(`/closet/smartpakker/${tripId}`);
  return { ok: true, plan, climate };
}

/* ------------------------------------------------------ item overrides --- */

export async function setItemPacking(input: {
  itemId: string;
  weightGrams?: number | null;
  volumeLiters?: number | null;
}): Promise<Result> {
  const user = await requireUser();
  const item = await prisma.wardrobeItem.findFirst({
    where: { id: input.itemId, userId: user.id },
    select: { id: true },
  });
  if (!item) return { ok: false, error: "Item not found" };

  const data: Record<string, unknown> = {};
  if (input.weightGrams !== undefined) {
    data.weightGrams =
      input.weightGrams == null ? null : Math.max(0, Math.round(input.weightGrams));
  }
  if (input.volumeLiters !== undefined) {
    data.volumeLiters =
      input.volumeLiters == null ? null : Math.max(0, Math.round(input.volumeLiters * 10) / 10);
  }
  if (Object.keys(data).length === 0) return { ok: true };

  await prisma.wardrobeItem.update({ where: { id: input.itemId }, data });
  return { ok: true };
}

/**
 * Override whether a garment belongs in the day-to-day rotation.
 *
 * `null` hands the decision back to the guess in lib/packing/occasion.ts, which
 * is the default for everything — this only exists for the cases it gets wrong,
 * in either direction: board shorts you genuinely wear as shorts, or a shirt
 * you're only bringing for one dinner.
 */
export async function setItemDailyWear(input: {
  itemId: string;
  dailyWear: boolean | null;
}): Promise<Result> {
  const user = await requireUser();
  const item = await prisma.wardrobeItem.findFirst({
    where: { id: input.itemId, userId: user.id },
    select: { id: true },
  });
  if (!item) return { ok: false, error: "Item not found" };

  await prisma.wardrobeItem.update({
    where: { id: input.itemId },
    data: { dailyWear: typeof input.dailyWear === "boolean" ? input.dailyWear : null },
  });
  return { ok: true };
}

/**
 * Parse a free-text trip description into requirements.
 *
 * Prefill only — it returns what it understood and does NOT save, exactly like
 * the payout-email parser. The model reads intent; the user confirms; the chips
 * remain the source of truth. Falls back to keyword matching whenever the model
 * is unavailable, so this never becomes a hard dependency.
 */
export async function parseTripDescription(input: {
  tripId: string;
  text: string;
}): Promise<Result<{ parsed: TripParse }>> {
  const user = await requireUser();
  const trip = await prisma.packingTrip.findUnique({
    where: { id: input.tripId },
    select: { userId: true },
  });
  if (!trip || trip.userId !== user.id) return { ok: false, error: "Trip not found" };

  const text = input.text.slice(0, 2000);
  return { ok: true, parsed: await parseTripText(text) };
}
