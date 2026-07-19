"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export type OutfitLayoutPieceInput = {
  id: string;
  itemId: string;
  x: number;
  y: number;
  scale: number;
  z: number;
};

export async function saveOutfitLayout(input: {
  name: string;
  frameHeight: number;
  pieces: OutfitLayoutPieceInput[];
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const user = await requireUser();
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Outfit name is required" };
  if (input.pieces.length === 0) return { ok: false, error: "Add at least one piece" };

  const itemIds = [...new Set(input.pieces.map((p) => p.itemId))];
  const owned = await prisma.wardrobeItem.count({
    where: { userId: user.id, id: { in: itemIds } },
  });
  if (owned !== itemIds.length) {
    return { ok: false, error: "One or more pieces are invalid." };
  }

  const created = await prisma.outfitLayout.create({
    data: {
      userId: user.id,
      name,
      frameHeight: Math.max(520, Math.min(1200, Math.round(input.frameHeight))),
      pieces: JSON.stringify(input.pieces),
    },
    select: { id: true },
  });

  revalidatePath("/closet/outfits");
  return { ok: true, id: created.id };
}

export async function deleteOutfitLayout(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  const outfit = await prisma.outfitLayout.findUnique({ where: { id } });
  if (!outfit || outfit.userId !== user.id) {
    return { ok: false, error: "Outfit not found" };
  }
  await prisma.outfitLayout.delete({ where: { id } });
  revalidatePath("/closet/outfits");
  return { ok: true };
}
