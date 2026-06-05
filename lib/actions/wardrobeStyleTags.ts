"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { decode, encode, type StylePrefs } from "@/lib/json";
import {
  getStyleTagsListFromPrefs,
  normalizeStyleTagName,
  sanitizeStyleTagsList,
} from "@/lib/preferences";

function stripLegacyCategoryFields(prefs: StylePrefs): StylePrefs {
  const next = { ...prefs };
  delete next.customCategories;
  delete next.categoryOrder;
  delete next.hiddenCategories;
  return next;
}

export async function addWardrobeStyleTag(
  raw: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  const name = normalizeStyleTagName(raw);
  if (!name) return { ok: false, error: "Enter a tag name" };

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { stylePrefs: true },
  });
  const prefs = decode<StylePrefs>(dbUser?.stylePrefs, {});
  const current = [...getStyleTagsListFromPrefs(prefs)];
  if (current.some((t) => normalizeStyleTagName(t) === name)) {
    return { ok: false, error: "That tag already exists" };
  }
  current.push(raw.trim());
  const clean = stripLegacyCategoryFields(prefs);
  clean.styleTagsList = sanitizeStyleTagsList(current);
  await prisma.user.update({
    where: { id: user.id },
    data: { stylePrefs: encode(clean) },
  });
  revalidatePath("/settings");
  revalidatePath("/closet");
  revalidatePath("/closet/add");
  revalidatePath("/closet", "layout");
  return { ok: true };
}

export async function removeWardrobeStyleTag(
  raw: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  const removedKey = normalizeStyleTagName(raw);
  if (!removedKey) return { ok: false, error: "Invalid tag" };

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { stylePrefs: true },
  });
  const prefs = decode<StylePrefs>(dbUser?.stylePrefs, {});
  const current = [...getStyleTagsListFromPrefs(prefs)];
  const nextList = current.filter((t) => normalizeStyleTagName(t) !== removedKey);
  if (nextList.length === current.length) {
    return { ok: false, error: "Tag not in list" };
  }
  if (nextList.length === 0) {
    return { ok: false, error: "Keep at least one style tag" };
  }

  const clean = stripLegacyCategoryFields(prefs);
  clean.styleTagsList = sanitizeStyleTagsList(nextList);

  await prisma.user.update({
    where: { id: user.id },
    data: { stylePrefs: encode(clean) },
  });
  revalidatePath("/settings");
  revalidatePath("/closet");
  revalidatePath("/closet/add");
  revalidatePath("/closet", "layout");
  return { ok: true };
}

export async function reorderWardrobeStyleTags(
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
  clean.styleTagsList = sanitizeStyleTagsList(ordered);
  await prisma.user.update({
    where: { id: user.id },
    data: { stylePrefs: encode(clean) },
  });

  revalidatePath("/settings");
  revalidatePath("/closet");
  revalidatePath("/closet/add");
  revalidatePath("/closet", "layout");
  return { ok: true };
}
