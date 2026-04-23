"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { encode } from "@/lib/json";

export type OutfitFormInput = {
  name: string;
  itemIds: string[];
};

export type OutfitMutationResponse =
  | { ok: true; outfitId: string }
  | { ok: false; error: string };

async function assertOutfitOwned(outfitId: string, userId: string) {
  const outfit = await prisma.outfit.findUnique({ where: { id: outfitId } });
  if (!outfit || outfit.userId !== userId) throw new Error("Not found");
  return outfit;
}

async function assertAllItemsOwned(itemIds: string[], userId: string): Promise<boolean> {
  if (itemIds.length === 0) return false;
  const count = await prisma.wardrobeItem.count({
    where: { id: { in: itemIds }, userId },
  });
  return count === itemIds.length;
}

export async function createOutfit(input: OutfitFormInput): Promise<OutfitMutationResponse> {
  const user = await requireUser();
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Name is required" };
  if (!(await assertAllItemsOwned(input.itemIds, user.id))) {
    return { ok: false, error: "Outfit needs at least one valid item" };
  }

  const outfit = await prisma.outfit.create({
    data: { userId: user.id, name, itemIds: encode(input.itemIds) },
  });

  revalidatePath("/outfits");
  return { ok: true, outfitId: outfit.id };
}

export async function updateOutfit(
  input: OutfitFormInput & { outfitId: string },
): Promise<OutfitMutationResponse> {
  const user = await requireUser();
  await assertOutfitOwned(input.outfitId, user.id);
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Name is required" };
  if (!(await assertAllItemsOwned(input.itemIds, user.id))) {
    return { ok: false, error: "Outfit needs at least one valid item" };
  }

  await prisma.outfit.update({
    where: { id: input.outfitId },
    data: { name, itemIds: encode(input.itemIds) },
  });

  revalidatePath("/outfits");
  revalidatePath(`/outfits/${input.outfitId}/edit`);
  return { ok: true, outfitId: input.outfitId };
}

export async function deleteOutfit(outfitId: string): Promise<void> {
  const user = await requireUser();
  await assertOutfitOwned(outfitId, user.id);
  await prisma.outfit.delete({ where: { id: outfitId } });
  revalidatePath("/outfits");
}
