"use server";

import { revalidatePath } from "next/cache";
import {
  getCategoriesListFromPrefs,
  NONE_CATEGORY,
  normalizeCategoryName,
  resolveReassignTarget,
  sanitizeCategoryList,
} from "@/lib/categories";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { decode, encode, type GarmentKindChoice, type StylePrefs } from "@/lib/json";
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

export type ReassignItem = {
  id: string;
  name: string;
  /** Verbatim stored category — may be "None" or a label no longer in the list. */
  category: string;
  /** Primary image (ghost view when present, else the original photo). */
  imagePath: string;
};

/**
 * Every item, with just enough to render a picker.
 *
 * Returned whole rather than per-category so the reassign UI can switch source
 * categories, search, and show counts without a round trip per keystroke. A
 * closet is a couple hundred rows of four short fields — cheaper than the
 * chatter of filtering server-side.
 */
export async function listItemsForReassign(): Promise<
  { ok: true; items: ReassignItem[] } | { ok: false; error: string }
> {
  const user = await requireUser();
  const rows = await prisma.wardrobeItem.findMany({
    where: { userId: user.id },
    select: {
      id: true,
      name: true,
      category: true,
      originalImagePath: true,
      ghostImagePath: true,
    },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
  return {
    ok: true,
    items: rows.map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      imagePath: r.ghostImagePath ?? r.originalImagePath,
    })),
  };
}

/**
 * Move a chosen set of items into `target`.
 *
 * This is the other half of adding a category: splitting "shirt" into "shirt"
 * and "t shirt" is not a rename — some rows move and some stay — and there was
 * no way to express that. Renaming hits every item, and editing one at a time
 * does not scale past a handful.
 */
export async function reassignItemsToCategory(
  itemIds: string[],
  target: string,
): Promise<{ ok: true; moved: number } | { ok: false; error: string }> {
  const user = await requireUser();
  const ids = [...new Set(itemIds.filter((id) => typeof id === "string" && id.length > 0))];
  if (ids.length === 0) return { ok: false, error: "Select at least one piece to move" };

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { stylePrefs: true },
  });
  const prefs = decode<StylePrefs>(dbUser?.stylePrefs, {});
  const options = getCategoriesListFromPrefs(prefs);

  // Resolve to the user's own label so casing matches the picker and the closet
  // groups by the same string. "None" is always allowed as a destination.
  const resolved = resolveReassignTarget(target, options);
  if (!resolved) {
    return { ok: false, error: `"${target}" is not one of your categories` };
  }

  // userId in the filter is what stops an id from another account being moved.
  const res = await prisma.wardrobeItem.updateMany({
    where: { id: { in: ids }, userId: user.id },
    data: { category: resolved },
  });

  revalidatePath("/settings");
  revalidatePath("/closet");
  return { ok: true, moved: res.count };
}

/**
 * Record what shape a category is, for labels the classifier can't read.
 *
 * "workwear" and "favorites" contain no garment noun, so no amount of regex
 * will place them — this is the user answering directly, and
 * `classifyGarmentKind` checks it before any inference.
 */
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
