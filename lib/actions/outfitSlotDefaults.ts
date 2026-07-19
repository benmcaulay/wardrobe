"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { decode, encode, type StylePrefs } from "@/lib/json";
import {
  outfitSlotDefaultKey,
  sanitizeOutfitSlotDefaults,
  type OutfitSlotDefault,
} from "@/lib/outfit-slot-defaults";

export async function saveOutfitSlotDefault(
  categories: string[],
  layout: OutfitSlotDefault,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  const key = outfitSlotDefaultKey(categories);
  if (!key) return { ok: false, error: "Pick at least one category for this slot." };

  const clean = sanitizeOutfitSlotDefaults({ [key]: layout });
  const entry = clean[key];
  if (!entry) return { ok: false, error: "Invalid placement." };

  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { stylePrefs: true },
  });
  const prefs = decode<StylePrefs>(row?.stylePrefs, {});
  const existing = sanitizeOutfitSlotDefaults(prefs.outfitSlotDefaults);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      stylePrefs: encode({
        ...prefs,
        outfitSlotDefaults: { ...existing, [key]: entry },
      }),
    },
  });

  revalidatePath("/closet/outfits");
  return { ok: true };
}
