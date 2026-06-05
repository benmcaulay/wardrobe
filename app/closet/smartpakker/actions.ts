"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { encode, parseSeasons, parseStringArray, type Season } from "@/lib/json";
import { saveUpload, deleteUpload, UploadError } from "@/lib/uploads";
import { DEFAULT_SILHOUETTE_ID, isSilhouetteId } from "@/lib/packing/silhouettes";
import { buildPackingPlan, type PackableItem, type PackingPlan } from "@/lib/packing/plan";
import { getClimateSummary, type ClimateSummary } from "@/lib/services/weather";

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

/* ---------------------------------------------------------------- trips --- */

function parseDate(value: string | Date): Date | null {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function createTrip(input: {
  name: string;
  destination: string;
  startDate: string;
  endDate: string;
  bagIds?: string[];
}): Promise<Result<{ id: string }>> {
  const user = await requireUser();
  const name = input.name.trim().slice(0, NAME_MAX);
  const destination = input.destination.trim().slice(0, DEST_MAX);
  if (!name) return { ok: false, error: "Trip name is required" };
  if (!destination) return { ok: false, error: "Where are you going?" };
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
  if (input.destination !== undefined) {
    const destination = input.destination.trim().slice(0, DEST_MAX);
    if (!destination) return { ok: false, error: "Where are you going?" };
    data.destination = destination;
    // Destination changed → stored climate is stale.
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
  });
  await prisma.packingTrip.update({
    where: { id: tripId },
    data: { climateData: encode(climate) },
  });
  revalidatePath(`/closet/smartpakker/${tripId}`);
  return { ok: true, climate };
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

  const rows = await prisma.wardrobeItem.findMany({
    where: { userId: user.id, isWishlist: false },
    select: {
      id: true,
      name: true,
      category: true,
      subcategory: true,
      material: true,
      season: true,
      weightGrams: true,
      volumeLiters: true,
    },
  });
  const items: PackableItem[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    subcategory: r.subcategory,
    material: r.material,
    season: parseSeasons(r.season) as Season[],
    weightGrams: r.weightGrams,
    volumeLiters: r.volumeLiters,
  }));

  const plan = buildPackingPlan({
    items,
    bags: bags.map((b) => ({ id: b.id, volumeLiters: b.volumeLiters, maxWeightKg: b.maxWeightKg })),
    days: climate.days,
    band: climate.band,
    rainChance: climate.rainChance,
  });

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
