"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { closetGroupKey } from "@/lib/closet-group-order";
import { prisma } from "@/lib/db";
import { decode, encode, type StylePrefs } from "@/lib/json";

export async function reorderClosetGroupItems(
  groupKey: string,
  orderedIds: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  const key = groupKey.trim();
  if (!key) return { ok: false, error: "Invalid group" };
  if (!orderedIds.length) return { ok: false, error: "Nothing to reorder" };

  const unique = new Set(orderedIds);
  if (unique.size !== orderedIds.length) return { ok: false, error: "Duplicate items" };

  const items = await prisma.wardrobeItem.findMany({
    where: { userId: user.id, id: { in: orderedIds } },
    select: { id: true, category: true, colors: true },
  });
  if (items.length !== orderedIds.length) return { ok: false, error: "Invalid items" };

  for (const item of items) {
    if (closetGroupKey(item.category, item.colors) !== key) {
      return { ok: false, error: "Items must share category and primary color" };
    }
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { stylePrefs: true },
  });
  const prefs = decode<StylePrefs>(dbUser?.stylePrefs, {});
  const nextOrders = { ...(prefs.closetGroupOrders ?? {}), [key]: orderedIds };
  await prisma.user.update({
    where: { id: user.id },
    data: { stylePrefs: encode({ ...prefs, closetGroupOrders: nextOrders }) },
  });
  revalidatePath("/closet");
  return { ok: true };
}
