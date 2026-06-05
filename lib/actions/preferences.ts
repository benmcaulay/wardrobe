"use server";

import { revalidatePath } from "next/cache";
import { sanitizeCategoryList } from "@/lib/categories";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { decode, encode, type StylePrefs } from "@/lib/json";
import { sanitizeStyleTagsList } from "@/lib/preferences";

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
  // Category list is edited via wardrobe category actions; the style editor state
  // often omits this key, so merging avoids wiping custom categories on "Save preferences".
  const { categoriesList: _drop, styleTagsList: _dropTags, ...fromClient } = prefs;
  const merged: StylePrefs = { ...existing, ...fromClient };
  await prisma.user.update({
    where: { id: user.id },
    data: { stylePrefs: encode(sanitizeStylePrefsPayload(merged)) },
  });
  revalidatePath("/settings");
}

export async function setAutoGenerateGhost(enabled: boolean): Promise<void> {
  const user = await requireUser();
  await prisma.user.update({
    where: { id: user.id },
    data: { autoGenerateGhost: enabled },
  });
  revalidatePath("/settings");
}
