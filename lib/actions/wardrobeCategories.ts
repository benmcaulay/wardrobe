"use server";

import { revalidatePath } from "next/cache";
import {
  getCategoriesListFromPrefs,
  NONE_CATEGORY,
  normalizeCategoryName,
  sanitizeCategoryList,
} from "@/lib/categories";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { decode, encode, type StylePrefs } from "@/lib/json";

function stripLegacyCategoryFields(prefs: StylePrefs): StylePrefs {
  const next = { ...prefs };
  delete next.customCategories;
  delete next.categoryOrder;
  delete next.hiddenCategories;
  return next;
}

export async function addWardrobeCategory(
  raw: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  const name = normalizeCategoryName(raw);
  if (!name) return { ok: false, error: "Enter a category name" };

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { stylePrefs: true },
  });
  const prefs = decode<StylePrefs>(dbUser?.stylePrefs, {});
  const current = [...getCategoriesListFromPrefs(prefs)];
  if (current.some((c) => normalizeCategoryName(c) === name)) {
    return { ok: false, error: "That category already exists" };
  }
  current.push(name);
  const clean = stripLegacyCategoryFields(prefs);
  clean.categoriesList = sanitizeCategoryList(current);
  await prisma.user.update({
    where: { id: user.id },
    data: { stylePrefs: encode(clean) },
  });
  revalidatePath("/settings");
  revalidatePath("/closet");
  revalidatePath("/closet/add");
  return { ok: true };
}

export async function removeWardrobeCategory(
  raw: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  const removedKey = normalizeCategoryName(raw);
  if (!removedKey) return { ok: false, error: "Invalid category" };

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { stylePrefs: true },
  });
  const prefs = decode<StylePrefs>(dbUser?.stylePrefs, {});
  const nextList = getCategoriesListFromPrefs(prefs).filter(
    (c) => normalizeCategoryName(c) !== removedKey,
  );

  const clean = stripLegacyCategoryFields(prefs);
  clean.categoriesList = sanitizeCategoryList(nextList);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { stylePrefs: encode(clean) },
    });

    const items = await tx.wardrobeItem.findMany({
      where: { userId: user.id },
      select: { id: true, category: true },
    });
    for (const row of items) {
      if (normalizeCategoryName(row.category) === removedKey) {
        await tx.wardrobeItem.update({
          where: { id: row.id },
          data: { category: NONE_CATEGORY },
        });
      }
    }
  });

  revalidatePath("/settings");
  revalidatePath("/closet");
  revalidatePath("/closet/add");
  revalidatePath("/closet", "layout");
  return { ok: true };
}

export async function reorderWardrobeCategories(
  ordered: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!ordered.length) return { ok: false, error: "Nothing to reorder" };

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { stylePrefs: true },
  });
  const prefs = decode<StylePrefs>(dbUser?.stylePrefs, {});
  const clean = stripLegacyCategoryFields(prefs);
  clean.categoriesList = sanitizeCategoryList(ordered);
  await prisma.user.update({
    where: { id: user.id },
    data: { stylePrefs: encode(clean) },
  });

  revalidatePath("/settings");
  revalidatePath("/closet");
  revalidatePath("/closet/add");
  return { ok: true };
}
