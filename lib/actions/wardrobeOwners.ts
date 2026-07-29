"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { decode, encode, parseStringArray, type Owner, type StylePrefs } from "@/lib/json";
import {
  getOwnersFromPrefs,
  normalizeOwnerName,
  ownerIdFromName,
  sanitizeOwnersList,
  uniqueOwnerId,
} from "@/lib/owners";

type Result = { ok: true } | { ok: false; error: string };

/** Owner prefs live on `stylePrefs`; drop the deprecated category fields on save. */
function stripLegacyCategoryFields(prefs: StylePrefs): StylePrefs {
  const next = { ...prefs };
  delete next.customCategories;
  delete next.categoryOrder;
  delete next.hiddenCategories;
  return next;
}

async function loadRoster(userId: string): Promise<{ prefs: StylePrefs; owners: Owner[] }> {
  const dbUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { stylePrefs: true },
  });
  const prefs = decode<StylePrefs>(dbUser?.stylePrefs, {});
  return { prefs, owners: getOwnersFromPrefs(prefs) };
}

function revalidateOwnerSurfaces() {
  revalidatePath("/settings");
  revalidatePath("/closet");
  revalidatePath("/closet/add");
  revalidatePath("/closet", "layout");
}

export async function addWardrobeOwner(raw: string): Promise<Result> {
  const user = await requireUser();
  const name = raw.trim();
  if (!name) return { ok: false, error: "Enter an owner name" };

  const { prefs, owners } = await loadRoster(user.id);
  const nameKey = normalizeOwnerName(name);
  if (owners.some((o) => normalizeOwnerName(o.name) === nameKey)) {
    return { ok: false, error: "That owner already exists" };
  }

  const id = uniqueOwnerId(ownerIdFromName(name), new Set(owners.map((o) => o.id)));
  const next = sanitizeOwnersList([...owners, { id, name, linkedUserId: null }]);
  const clean = stripLegacyCategoryFields(prefs);
  clean.owners = next;
  await prisma.user.update({ where: { id: user.id }, data: { stylePrefs: encode(clean) } });

  revalidateOwnerSurfaces();
  return { ok: true };
}

export async function renameWardrobeOwner(fromName: string, toName: string): Promise<Result> {
  const user = await requireUser();
  const oldKey = normalizeOwnerName(fromName);
  const newName = toName.trim();
  if (!oldKey) return { ok: false, error: "Invalid owner" };
  if (!newName) return { ok: false, error: "Enter an owner name" };

  const { prefs, owners } = await loadRoster(user.id);
  const idx = owners.findIndex((o) => normalizeOwnerName(o.name) === oldKey);
  if (idx === -1) return { ok: false, error: "Owner not found" };
  const newKey = normalizeOwnerName(newName);
  if (newKey !== oldKey && owners.some((o) => normalizeOwnerName(o.name) === newKey)) {
    return { ok: false, error: "That owner name already exists" };
  }

  // Rename keeps the stable id, so items that reference this owner are untouched.
  const next = owners.map((o, i) => (i === idx ? { ...o, name: newName } : o));
  const clean = stripLegacyCategoryFields(prefs);
  clean.owners = sanitizeOwnersList(next);
  await prisma.user.update({ where: { id: user.id }, data: { stylePrefs: encode(clean) } });

  revalidateOwnerSurfaces();
  return { ok: true };
}

export async function removeWardrobeOwner(name: string): Promise<Result> {
  const user = await requireUser();
  const removedKey = normalizeOwnerName(name);
  if (!removedKey) return { ok: false, error: "Invalid owner" };

  const { prefs, owners } = await loadRoster(user.id);
  const removed = owners.find((o) => normalizeOwnerName(o.name) === removedKey);
  if (!removed) return { ok: false, error: "Owner not in list" };
  const nextRoster = owners.filter((o) => o.id !== removed.id);
  if (nextRoster.length === 0) return { ok: false, error: "Keep at least one owner" };

  const clean = stripLegacyCategoryFields(prefs);
  clean.owners = sanitizeOwnersList(nextRoster);
  const primaryId = nextRoster[0]!.id;

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { stylePrefs: encode(clean) } });

    // Strip the removed owner id from every item; items left with no owner
    // fall back to the primary owner so nothing becomes unfilterable.
    const items = await tx.wardrobeItem.findMany({
      where: { userId: user.id },
      select: { id: true, owners: true },
    });
    for (const row of items) {
      const ids = parseStringArray(row.owners);
      if (!ids.includes(removed.id)) continue;
      const kept = ids.filter((id) => id !== removed.id);
      const nextIds = kept.length > 0 ? kept : [primaryId];
      await tx.wardrobeItem.update({ where: { id: row.id }, data: { owners: encode(nextIds) } });
    }
  });

  revalidateOwnerSurfaces();
  return { ok: true };
}

export async function reorderWardrobeOwners(orderedNames: string[]): Promise<Result> {
  const user = await requireUser();
  if (!orderedNames.length) return { ok: false, error: "Nothing to reorder" };

  const { prefs, owners } = await loadRoster(user.id);
  const byName = new Map(owners.map((o) => [normalizeOwnerName(o.name), o]));
  const reordered: Owner[] = [];
  for (const n of orderedNames) {
    const hit = byName.get(normalizeOwnerName(n));
    if (hit) reordered.push(hit);
  }
  // Preserve any owners not present in the incoming order (defensive).
  for (const o of owners) {
    if (!reordered.some((r) => r.id === o.id)) reordered.push(o);
  }

  const clean = stripLegacyCategoryFields(prefs);
  clean.owners = sanitizeOwnersList(reordered);
  await prisma.user.update({ where: { id: user.id }, data: { stylePrefs: encode(clean) } });

  revalidateOwnerSurfaces();
  return { ok: true };
}
