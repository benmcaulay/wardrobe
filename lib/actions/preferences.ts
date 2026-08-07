"use server";

import { revalidatePath } from "next/cache";
import { sanitizeCategoryList } from "@/lib/categories";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { decode, encode, type StylePrefs } from "@/lib/json";
import { sanitizeStyleTagsList } from "@/lib/preferences";
import { sanitizeHiddenFilters } from "@/lib/closet-filter-visibility";
import { readClosetSort } from "@/lib/closet-sort";

function sanitizeStylePrefsPayload(prefs: StylePrefs): StylePrefs {
  const {
    customCategories: _cc,
    categoryOrder: _co,
    hiddenCategories: _hc,
    ...rest
  } = prefs;
  if (rest.categoriesList?.length) {
    rest.categoriesList = sanitizeCategoryList(rest.categoriesList);
  }
  if (rest.styleTagsList?.length) {
    rest.styleTagsList = sanitizeStyleTagsList(rest.styleTagsList);
  }
  return rest;
}

export async function updateStylePrefs(prefs: StylePrefs): Promise<void> {
  const user = await requireUser();
  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { stylePrefs: true },
  });
  const existing = decode<StylePrefs>(row?.stylePrefs, {});
  // Category/tag/color lists are edited via dedicated wardrobe actions; the style
  // editor state often omits these keys, so we drop them here (keeping the existing
  // saved lists) to avoid wiping them on "Save preferences".
  const {
    categoriesList: _drop,
    styleTagsList: _dropTags,
    colorsList: _dropColors,
    ...fromClient
  } = prefs;
  const merged: StylePrefs = { ...existing, ...fromClient };
  await prisma.user.update({
    where: { id: user.id },
    data: { stylePrefs: encode(sanitizeStylePrefsPayload(merged)) },
  });
  revalidatePath("/settings");
}

/**
 * Save which closet filter controls to hide. Revalidates /closet as well as
 * /settings so the filter bar reflects the change immediately.
 */
export async function setHiddenClosetFilters(keys: string[]): Promise<void> {
  const user = await requireUser();
  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { stylePrefs: true },
  });
  const existing = decode<StylePrefs>(row?.stylePrefs, {});
  const merged: StylePrefs = {
    ...existing,
    hiddenClosetFilters: sanitizeHiddenFilters(keys),
  };
  await prisma.user.update({
    where: { id: user.id },
    data: { stylePrefs: encode(sanitizeStylePrefsPayload(merged)) },
  });
  revalidatePath("/settings");
  revalidatePath("/closet");
}

/**
 * Remember the closet sort so the next visit opens the same way.
 *
 * Fire-and-forget from the filter bar: the sort is already applied client-side,
 * so this only records the preference and must never revalidate /closet (that
 * would yank the grid out from under the interaction that triggered it).
 */
export async function setDefaultClosetSort(sort: string): Promise<void> {
  const user = await requireUser();
  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { stylePrefs: true },
  });
  const existing = decode<StylePrefs>(row?.stylePrefs, {});
  const merged: StylePrefs = { ...existing, defaultClosetSort: readClosetSort(sort) };
  await prisma.user.update({
    where: { id: user.id },
    data: { stylePrefs: encode(sanitizeStylePrefsPayload(merged)) },
  });
}

export async function setAutoGenerateGhost(enabled: boolean): Promise<void> {
  const user = await requireUser();
  await prisma.user.update({
    where: { id: user.id },
    data: { autoGenerateGhost: enabled },
  });
  revalidatePath("/settings");
}
