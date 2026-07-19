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
import { migrateClosetGroupOrderCategory } from "@/lib/closet-group-order";

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

function revalidateCategorySurfaces() {
  revalidatePath("/settings");
  revalidatePath("/closet");
  revalidatePath("/closet/add");
  revalidatePath("/closet/outfits");
}

export async function renameWardrobeCategory(
  fromRaw: string,
  toRaw: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  const oldKey = normalizeCategoryName(fromRaw);
  const newName = normalizeCategoryName(toRaw);
  if (!oldKey) return { ok: false, error: "Invalid category" };
  if (!newName) return { ok: false, error: "Enter a category name" };
  if (oldKey === newName) return { ok: true };

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { stylePrefs: true },
  });
  const prefs = decode<StylePrefs>(dbUser?.stylePrefs, {});
  const current = [...getCategoriesListFromPrefs(prefs)];
  const fromIndex = current.findIndex((c) => normalizeCategoryName(c) === oldKey);
  if (fromIndex === -1) return { ok: false, error: "Category not found" };
  if (current.some((c) => normalizeCategoryName(c) === newName)) {
    return { ok: false, error: "That category name already exists" };
  }

  const nextList = current.map((c, i) => (i === fromIndex ? newName : c));
  const clean = stripLegacyCategoryFields(prefs);
  clean.categoriesList = sanitizeCategoryList(nextList);
  clean.closetGroupOrders = migrateClosetGroupOrderCategory(
    prefs.closetGroupOrders,
    oldKey,
    newName,
  );

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
      if (normalizeCategoryName(row.category) === oldKey) {
        await tx.wardrobeItem.update({
          where: { id: row.id },
          data: { category: newName },
        });
      }
    }
  });

  revalidateCategorySurfaces();
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
