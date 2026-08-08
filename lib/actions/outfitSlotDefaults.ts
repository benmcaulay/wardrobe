"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { decode, encode, type StylePrefs } from "@/lib/json";
import {
  outfitSlotDefaultKey,
  sanitizeComboLayouts,
  sanitizeLayerOrder,
  sanitizeOutfitSlotDefaults,
  sanitizeVisualLayers,
  type ComboLayout,
  type OutfitSlotDefault,
} from "@/lib/outfit-slot-defaults";

/**
 * Remember a piece's position and/or size for one placed-together combination.
 * The patch is merged into the existing entry so a drag (x/y) and a resize
 * (scale) accumulate instead of overwriting one another.
 */
export async function saveOutfitComboLayout(
  key: string,
  patch: ComboLayout,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  const k = key.trim();
  if (!k) return { ok: false, error: "Missing combination key." };

  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { stylePrefs: true },
  });
  const prefs = decode<StylePrefs>(row?.stylePrefs, {});
  const existing = sanitizeComboLayouts(prefs.outfitComboLayouts);
  const merged = sanitizeComboLayouts({ [k]: { ...existing[k], ...patch } });
  const entry = merged[k];
  if (!entry) return { ok: false, error: "Invalid layout." };

  await prisma.user.update({
    where: { id: user.id },
    data: {
      stylePrefs: encode({ ...prefs, outfitComboLayouts: { ...existing, [k]: entry } }),
    },
  });

  revalidatePath("/closet/outfits");
  return { ok: true };
}

/** Persist the outfit vertical layers (top→bottom bands of category names). */
export async function saveOutfitVisualLayers(
  layers: string[][],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  const clean = sanitizeVisualLayers(layers);

  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { stylePrefs: true },
  });
  const prefs = decode<StylePrefs>(row?.stylePrefs, {});

  await prisma.user.update({
    where: { id: user.id },
    data: { stylePrefs: encode({ ...prefs, outfitVisualLayers: clean }) },
  });

  revalidatePath("/closet/outfits");
  return { ok: true };
}

/** Persist the outfit stack order (category signatures, frontmost first). */
export async function saveOutfitLayerOrder(
  order: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  const clean = sanitizeLayerOrder(order);

  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { stylePrefs: true },
  });
  const prefs = decode<StylePrefs>(row?.stylePrefs, {});

  await prisma.user.update({
    where: { id: user.id },
    data: { stylePrefs: encode({ ...prefs, outfitLayerOrder: clean }) },
  });

  revalidatePath("/closet/outfits");
  return { ok: true };
}

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
