"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { encode } from "@/lib/json";
import { saveUpload, deleteUpload, UploadError } from "@/lib/uploads";
import {
  createVirtualTryOn,
  virtualTryOnUsesAppCredits,
  type VirtualTryOnResult,
} from "@/lib/services/virtualTryOn";

const REAL_VTON = process.env.USE_REAL_VIRTUAL_TRYON === "true";
const MAX_PERSON_PHOTOS = 5;

export type UploadPersonPhotoResponse =
  | { ok: true; id: string; imagePath: string }
  | { ok: false; error: string };

/**
 * Save a person reference photo. The caller is responsible for limiting how
 * many they upload, but we hard-cap at MAX_PERSON_PHOTOS so a user can't keep
 * appending past a sensible cap.
 */
export async function uploadPersonPhoto(
  formData: FormData,
): Promise<UploadPersonPhotoResponse> {
  const user = await requireUser();
  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "No file provided" };
  }

  const existingCount = await prisma.personPhoto.count({ where: { userId: user.id } });
  if (existingCount >= MAX_PERSON_PHOTOS) {
    return {
      ok: false,
      error: `You can keep up to ${MAX_PERSON_PHOTOS} photos. Delete one first.`,
    };
  }

  let saved;
  try {
    saved = await saveUpload(file, user.id);
  } catch (err) {
    if (err instanceof UploadError) return { ok: false, error: err.message };
    throw err;
  }

  const label = (formData.get("label") as string | null)?.trim() || null;
  const created = await prisma.personPhoto.create({
    data: {
      userId: user.id,
      imagePath: saved.originalImagePath,
      label,
    },
  });

  revalidatePath("/closet/try-on");
  return { ok: true, id: created.id, imagePath: created.imagePath };
}

export type DeletePersonPhotoResponse =
  | { ok: true }
  | { ok: false; error: string };

export async function deletePersonPhoto(
  photoId: string,
): Promise<DeletePersonPhotoResponse> {
  const user = await requireUser();
  const photo = await prisma.personPhoto.findUnique({ where: { id: photoId } });
  if (!photo || photo.userId !== user.id) {
    return { ok: false, error: "Photo not found" };
  }
  await prisma.personPhoto.delete({ where: { id: photoId } });
  await deleteUpload(photo.imagePath);
  revalidatePath("/closet/try-on");
  return { ok: true };
}

export type GenerateTryOnInput = {
  personPhotoId: string;
  itemIds: string[];
  outfitId?: string | null;
  prompt?: string;
};

export type GenerateTryOnResponse =
  | {
      ok: true;
      tryOnId: string;
      resultImagePath: string;
      creditsRemaining: number;
      creditsUsed: number;
    }
  | { ok: false; error: string };

/**
 * Generate a virtual try-on image. Picks the best available image for each
 * selected wardrobe item (ghost > original) so the model has the
 * cleanest possible garment reference. Real-mode call decrements credits
 * atomically with the VirtualTryOn row insert; failure does not charge.
 */
export async function generateVirtualTryOn(
  input: GenerateTryOnInput,
): Promise<GenerateTryOnResponse> {
  const user = await requireUser();

  if (input.itemIds.length === 0) {
    return { ok: false, error: "Select at least one garment or a saved outfit." };
  }

  const [person, items, dbUser] = await Promise.all([
    prisma.personPhoto.findUnique({ where: { id: input.personPhotoId } }),
    prisma.wardrobeItem.findMany({
      where: { id: { in: input.itemIds }, userId: user.id },
    }),
    prisma.user.findUnique({ where: { id: user.id }, select: { credits: true } }),
  ]);

  if (!person || person.userId !== user.id) {
    return { ok: false, error: "Person photo not found" };
  }
  if (items.length !== input.itemIds.length) {
    return { ok: false, error: "One or more selected items could not be found." };
  }
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const orderedItems = input.itemIds
    .map((id) => itemsById.get(id))
    .filter((item): item is NonNullable<typeof item> => item != null);
  if (orderedItems.length !== items.length) {
    return { ok: false, error: "One or more selected items could not be found." };
  }

  if (REAL_VTON && virtualTryOnUsesAppCredits() && (dbUser?.credits ?? 0) < 1) {
    return { ok: false, error: "Out of credits" };
  }

  if (input.outfitId) {
    const outfit = await prisma.outfit.findUnique({ where: { id: input.outfitId } });
    if (!outfit || outfit.userId !== user.id) {
      return { ok: false, error: "Outfit not found" };
    }
  }

  // Pick the best image for each item: ghost > original (order matches UI selection).
  const garmentPaths = orderedItems.map(
    (item) => item.ghostImagePath ?? item.originalImagePath,
  );
  const garmentCategories = orderedItems.map((item) =>
    [item.category, item.subcategory].filter(Boolean).join(" ").trim(),
  );

  let result: VirtualTryOnResult;
  try {
    result = await createVirtualTryOn({
      userId: user.id,
      personImagePath: person.imagePath,
      garmentImagePaths: garmentPaths,
      garmentCategories,
      prompt: input.prompt,
    });
  } catch (err) {
    console.error("[generateVirtualTryOn] failed:", (err as Error).message);
    return { ok: false, error: (err as Error).message ?? "Generation failed" };
  }

  const { tryOnId, creditsRemaining } = await prisma.$transaction(async (tx) => {
    const created = await tx.virtualTryOn.create({
      data: {
        userId: user.id,
        personPhotoId: person.id,
        outfitId: input.outfitId ?? null,
        itemIds: encode(input.itemIds),
        prompt: input.prompt?.trim() || null,
        resultImagePath: result.resultImagePath,
        creditsUsed: result.credits,
      },
    });
    let remaining = dbUser?.credits ?? 0;
    if (REAL_VTON && result.credits > 0) {
      const updated = await tx.user.update({
        where: { id: user.id },
        data: { credits: { decrement: result.credits } },
        select: { credits: true },
      });
      remaining = updated.credits;
    }
    return { tryOnId: created.id, creditsRemaining: remaining };
  });

  revalidatePath("/closet/try-on");
  return {
    ok: true,
    tryOnId,
    resultImagePath: result.resultImagePath,
    creditsRemaining,
    creditsUsed: result.credits,
  };
}

export type SaveOutfitResponse =
  | { ok: true; id: string }
  | { ok: false; error: string };

export async function saveOutfit(
  name: string,
  itemIds: string[],
): Promise<SaveOutfitResponse> {
  const user = await requireUser();
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Outfit name is required" };
  if (itemIds.length === 0) return { ok: false, error: "Pick at least one item" };

  const owned = await prisma.wardrobeItem.count({
    where: { id: { in: itemIds }, userId: user.id },
  });
  if (owned !== itemIds.length) {
    return { ok: false, error: "One or more items don't belong to you." };
  }

  const created = await prisma.outfit.create({
    data: {
      userId: user.id,
      name: trimmed,
      itemIds: encode(itemIds),
    },
  });
  revalidatePath("/closet/try-on");
  return { ok: true, id: created.id };
}

export type DeleteOutfitResponse = { ok: true } | { ok: false; error: string };

export async function deleteOutfit(id: string): Promise<DeleteOutfitResponse> {
  const user = await requireUser();
  const outfit = await prisma.outfit.findUnique({ where: { id } });
  if (!outfit || outfit.userId !== user.id) {
    return { ok: false, error: "Outfit not found" };
  }
  await prisma.outfit.delete({ where: { id } });
  revalidatePath("/closet/try-on");
  return { ok: true };
}
