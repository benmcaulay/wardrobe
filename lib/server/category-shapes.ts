import { prisma } from "@/lib/db";
import { decode, type StylePrefs } from "@/lib/json";
import type { GarmentKind } from "@/lib/categories";

/**
 * A user's explicit category→shape overrides.
 *
 * Loaded per call rather than cached: it is one indexed row on a path that is
 * already about to spend an AI credit, and a stale map would silently send an
 * item down the wrong prompt.
 */
export async function loadCategoryShapes(
  userId: string,
): Promise<Record<string, GarmentKind>> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { stylePrefs: true },
  });
  const prefs = decode<StylePrefs>(row?.stylePrefs, {});
  return (prefs.categoryShapes ?? {}) as Record<string, GarmentKind>;
}
