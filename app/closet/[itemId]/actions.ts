"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { encode } from "@/lib/json";
import { deleteUpload } from "@/lib/uploads";
import type { ItemFormValue } from "@/lib/types";

export type UpdateItemInput = ItemFormValue & { itemId: string };
export type ActionResponse = { ok: true } | { ok: false; error: string };

async function assertOwned(itemId: string, userId: string) {
  const item = await prisma.wardrobeItem.findUnique({ where: { id: itemId } });
  if (!item || item.userId !== userId) throw new Error("Not found");
  return item;
}

export async function updateItem(input: UpdateItemInput): Promise<ActionResponse> {
  const user = await requireUser();
  await assertOwned(input.itemId, user.id);
  if (!input.name.trim()) return { ok: false, error: "Name is required" };

  await prisma.wardrobeItem.update({
    where: { id: input.itemId },
    data: {
      name: input.name.trim(),
      brand: input.brand.trim() || null,
      category: input.category,
      subcategory: input.subcategory.trim() || null,
      colors: encode(input.colors),
      priceCents: input.priceCents,
      currency: input.currency || "USD",
      material: input.material.trim() || null,
      pattern: input.pattern.trim() || null,
      styleTags: encode(input.styleTags),
      season: encode(input.season),
      notes: input.notes.trim() || null,
      isWishlist: input.isWishlist,
    },
  });

  revalidatePath("/closet");
  revalidatePath(`/closet/${input.itemId}`);
  return { ok: true };
}

export async function wearToday(itemId: string): Promise<ActionResponse> {
  const user = await requireUser();
  await assertOwned(itemId, user.id);
  await prisma.wardrobeItem.update({
    where: { id: itemId },
    data: {
      timesWorn: { increment: 1 },
      lastWornAt: new Date(),
    },
  });
  revalidatePath(`/closet/${itemId}`);
  return { ok: true };
}

export async function deleteItem(itemId: string): Promise<void> {
  const user = await requireUser();
  const item = await assertOwned(itemId, user.id);
  // best-effort unlink of the image files first; a failed unlink should not
  // block the DB delete since the row references files that may already be gone.
  try {
    await deleteUpload(item.originalImagePath);
    if (item.ghostImagePath) await deleteUpload(item.ghostImagePath);
    if (item.extraImagePaths) {
      try {
        const extras = JSON.parse(item.extraImagePaths) as string[];
        for (const p of extras) await deleteUpload(p);
      } catch {
        // ignore bad JSON
      }
    }
  } catch {
    // ignore
  }
  // TryOnGeneration rows cascade-delete via FK on the WardrobeItem.
  await prisma.wardrobeItem.delete({ where: { id: itemId } });
  revalidatePath("/closet");
  redirect("/closet");
}
