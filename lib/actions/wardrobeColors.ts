"use server";

import { revalidatePath } from "next/cache";
import {
  getColorsListFromPrefs,
  normalizeColorName,
  normalizeHex,
  sanitizeColorList,
  sanitizeFavoriteColorNames,
  toggleFavoriteColor,
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
    data: {
      stylePrefs: encode({
        ...prefs,
        colorsList: sanitizeColorList(nextList),
        // A favourite pointing at a colour that no longer exists would come
        // back as a heart on nothing if the name were ever re-added.
        favoriteColors: sanitizeFavoriteColorNames(prefs.favoriteColors).filter((n) => n !== key),
      }),
    },
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

/**
 * Heart or un-heart a palette colour.
 *
 * Its own action rather than part of "Save preferences" because the heart lives
 * in the palette list, where every other control (add, remove, reorder) saves on
 * the spot — a mark that needed a separate save button to stick would be the odd
 * one out, and silently lost by anyone who navigated away.
 *
 * Consequently `updateStylePrefs` no longer writes `favoriteColors` at all; see
 * the note there.
 */
export async function setFavoriteColor(rawName: string, favorite: boolean): Promise<Result> {
  const user = await requireUser();
  const key = normalizeColorName(rawName);
  if (!key) return { ok: false, error: "Invalid color" };

  const prefs = await loadPrefs(user.id);
  if (!getColorsListFromPrefs(prefs).some((c) => normalizeColorName(c.name) === key)) {
    return { ok: false, error: "That color is not in your palette" };
  }

  const current = sanitizeFavoriteColorNames(prefs.favoriteColors);
  const isOn = current.includes(key);
  // Idempotent: the client already drew the new state, and a double-fire from a
  // double-click must not toggle it back.
  const next = isOn === favorite ? current : toggleFavoriteColor(current, key);
  await prisma.user.update({
    where: { id: user.id },
    data: { stylePrefs: encode({ ...prefs, favoriteColors: next }) },
  });
  revalidatePath("/settings");
  return { ok: true };
}
