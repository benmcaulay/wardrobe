"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { encode } from "@/lib/json";
import { generateTryOn } from "@/lib/services/virtualTryOn";

export type GenerateInput = {
  referencePhotoId: string;
  itemIds: string[];
};

export type GenerateResponse =
  | { ok: true; tryOnId: string; resultImagePath: string }
  | { ok: false; error: string };

export async function generateTryOnForSelection(input: GenerateInput): Promise<GenerateResponse> {
  const user = await requireUser();
  if (!Array.isArray(input.itemIds) || input.itemIds.length === 0) {
    return { ok: false, error: "Pick at least one item" };
  }

  const photo = await prisma.referencePhoto.findUnique({ where: { id: input.referencePhotoId } });
  if (!photo || photo.userId !== user.id) {
    return { ok: false, error: "Reference photo not found" };
  }

  const items = await prisma.wardrobeItem.findMany({
    where: { id: { in: input.itemIds }, userId: user.id },
    select: { id: true, originalImagePath: true },
  });
  if (items.length !== input.itemIds.length) {
    return { ok: false, error: "One or more items could not be found" };
  }

  // Preserve the user's selection order for layout.
  const orderIndex = new Map(input.itemIds.map((id, i) => [id, i]));
  const ordered = [...items].sort(
    (a, b) => (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0),
  );

  try {
    const { resultImagePath } = await generateTryOn({
      userId: user.id,
      personImagePath: photo.imagePath,
      garmentImagePaths: ordered.map((i) => i.originalImagePath),
    });

    const row = await prisma.tryOnGeneration.create({
      data: {
        userId: user.id,
        itemIds: encode(input.itemIds),
        referencePhotoId: photo.id,
        resultImagePath,
      },
    });

    revalidatePath("/try-on");
    revalidatePath("/closet");
    input.itemIds.forEach((id) => revalidatePath(`/closet/${id}`));

    return { ok: true, tryOnId: row.id, resultImagePath };
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? "Generation failed" };
  }
}

export type SaveOutfitResponse = { ok: true; outfitId: string } | { ok: false; error: string };

export async function saveOutfit(input: { name: string; itemIds: string[] }): Promise<SaveOutfitResponse> {
  const user = await requireUser();
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Name is required" };
  if (!Array.isArray(input.itemIds) || input.itemIds.length === 0) {
    return { ok: false, error: "Outfit needs at least one item" };
  }
  const count = await prisma.wardrobeItem.count({
    where: { id: { in: input.itemIds }, userId: user.id },
  });
  if (count !== input.itemIds.length) {
    return { ok: false, error: "One or more items could not be found" };
  }

  const outfit = await prisma.outfit.create({
    data: { userId: user.id, name, itemIds: encode(input.itemIds) },
  });

  revalidatePath("/outfits");
  return { ok: true, outfitId: outfit.id };
}
