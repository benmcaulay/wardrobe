"use server";

import { revalidatePath } from "next/cache";
import {
  getColorsListFromPrefs,
  normalizeColorName,
  normalizeHex,
  sanitizeColorList,
} from "@/lib/colors";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { decode, encode, type Color, type StylePrefs } from "@/lib/json";

type Result = { ok: true } | { ok: false; error: string };

function revalidateColorSurfaces() {
  revalidatePath("/settings");
  revalidatePath("/closet");
  revalidatePath("/closet/add");
}

async function loadPrefs(userId: string): Promise<StylePrefs> {
  const dbUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { stylePrefs: true },
  });
  return decode<StylePrefs>(dbUser?.stylePrefs, {});
}

export async function addWardrobeColor(rawHex: string, rawName: string): Promise<Result> {
  const user = await requireUser();
  const name = normalizeColorName(rawName);
  if (!name) return { ok: false, error: "Enter a color name" };
  const hex = normalizeHex(rawHex);
  if (!hex) return { ok: false, error: "Pick a valid color" };

  const prefs = await loadPrefs(user.id);
  const current = getColorsListFromPrefs(prefs);
  if (current.some((c) => normalizeColorName(c.name) === name)) {
    return { ok: false, error: "That color name already exists" };
  }
  current.push({ hex, name });
  await prisma.user.update({
    where: { id: user.id },
    data: { stylePrefs: encode({ ...prefs, colorsList: sanitizeColorList(current) }) },
  });
  revalidateColorSurfaces();
  return { ok: true };
}

export async function removeWardrobeColor(rawName: string): Promise<Result> {
  const user = await requireUser();
  const key = normalizeColorName(rawName);
  if (!key) return { ok: false, error: "Invalid color" };

  const prefs = await loadPrefs(user.id);
  const nextList = getColorsListFromPrefs(prefs).filter(
    (c) => normalizeColorName(c.name) !== key,
  );
  if (nextList.length === 0) {
    return { ok: false, error: "Keep at least one color in the palette" };
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { stylePrefs: encode({ ...prefs, colorsList: sanitizeColorList(nextList) }) },
  });
  revalidateColorSurfaces();
  return { ok: true };
}

export async function reorderWardrobeColors(ordered: Color[]): Promise<Result> {
  const user = await requireUser();
  if (!ordered.length) return { ok: false, error: "Nothing to reorder" };

  const prefs = await loadPrefs(user.id);
  await prisma.user.update({
    where: { id: user.id },
    data: { stylePrefs: encode({ ...prefs, colorsList: sanitizeColorList(ordered) }) },
  });
  revalidateColorSurfaces();
  return { ok: true };
}
