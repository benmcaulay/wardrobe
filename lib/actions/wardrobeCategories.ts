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
import { decode, encode, type GarmentKindChoice, type StylePrefs } from "@/lib/json";
import { migrateClosetGroupOrderCategory } from "@/lib/closet-group-order";
import {
  moveCategory,
  parentsAfterRemoval,
  parentsAfterRename,
  sanitizeCategoryParents,
  type CategoryDropMode,
} from "@/lib/category-tree";

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
  // Order matters: the map is rewritten against the list the removed category
  // was still in, so its children can be promoted to *its* parent. Sanitizing
  // against the shorter list first would root them instead.
  const promoted = parentsAfterRemoval(
    prefs.categoryParents,
    getCategoriesListFromPrefs(prefs),
    removedKey,
  );
  clean.categoriesList = sanitizeCategoryList(nextList);
  clean.categoryParents = sanitizeCategoryParents(promoted, clean.categoriesList);

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
  clean.categoryParents = sanitizeCategoryParents(
    parentsAfterRename(prefs.categoryParents, current, oldKey, newName),
    clean.categoriesList,
  );
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

/**
 * Move a category within the tree: beside another one, or inside it.
 *
 * Takes the two category names and the intent rather than a finished list,
 * because the rule that makes a move legal — you cannot nest a category inside
 * its own descendant — has to hold on the server too. A client that sent a
 * flat list could describe a detached tree, and there would be nothing here
 * able to tell.
 */
export async function moveWardrobeCategory(
  draggedRaw: string,
  targetRaw: string,
  mode: CategoryDropMode,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { stylePrefs: true },
  });
  const prefs = decode<StylePrefs>(dbUser?.stylePrefs, {});
  const list = getCategoriesListFromPrefs(prefs);
  const move = moveCategory(list, prefs.categoryParents, draggedRaw, targetRaw, mode);
  if (!move.moved) {
    return { ok: false, error: "That move would put a category inside itself" };
  }

  const clean = stripLegacyCategoryFields(prefs);
  clean.categoriesList = sanitizeCategoryList(move.list);
  clean.categoryParents = sanitizeCategoryParents(move.parents, clean.categoriesList);
  await prisma.user.update({
    where: { id: user.id },
    data: { stylePrefs: encode(clean) },
  });

  revalidateCategorySurfaces();
  return { ok: true };
}

export async function setCategoryShape(
  category: string,
  shape: GarmentKindChoice | "",
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  const key = normalizeCategoryName(category);
  if (!key) return { ok: false, error: "Invalid category" };

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { stylePrefs: true },
  });
  const prefs = decode<StylePrefs>(dbUser?.stylePrefs, {});
  const options = getCategoriesListFromPrefs(prefs);
  if (!options.some((o) => normalizeCategoryName(o) === key)) {
    return { ok: false, error: "That category no longer exists" };
  }

  const next = { ...(prefs.categoryShapes ?? {}) };
  // Empty string clears the override and hands the label back to inference.
  if (shape === "") delete next[key];
  else next[key] = shape;

  const clean = { ...prefs, categoryShapes: next };
  await prisma.user.update({
    where: { id: user.id },
    data: { stylePrefs: encode(clean) },
  });
  revalidatePath("/settings");
  revalidatePath("/closet");
  revalidatePath("/closet/add");
  return { ok: true };
}
