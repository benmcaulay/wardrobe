"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { encode } from "@/lib/json";
import {
  createGhostMannequin,
  mapCategoryToGhost,
  type GhostMannequinCategory,
  type GhostMannequinResult,
} from "@/lib/services/ghostMannequin";

const REAL_GHOST = process.env.USE_REAL_GHOST_MANNEQUIN === "true";

export type GenerateGhostResponse =
  | { ok: true; ghostImagePath: string; creditsRemaining: number }
  | { ok: false; error: string };

/**
 * Generate (or regenerate) the ghost mannequin for an item that's already
 * persisted. Updates item.ghostImagePath, logs a TryOnGeneration row, and (in
 * real mode) decrements User.credits — all in one transaction. Errors from
 * the provider are caught and returned as { ok: false } so the UI can show
 * them without a 500.
 */
export async function generateGhostFor(itemId: string): Promise<GenerateGhostResponse> {
  const user = await requireUser();
  const [item, dbUser] = await Promise.all([
    prisma.wardrobeItem.findUnique({ where: { id: itemId } }),
    prisma.user.findUnique({ where: { id: user.id }, select: { credits: true } }),
  ]);
  if (!item || item.userId !== user.id) return { ok: false, error: "Item not found" };
  if (REAL_GHOST && (dbUser?.credits ?? 0) < 1) {
    return { ok: false, error: "Out of credits" };
  }

  const sourcePath = item.originalImagePath;
  let extras: string[] = [];
  try {
    if (item.extraImagePaths) extras = JSON.parse(item.extraImagePaths) as string[];
  } catch {
    // ignore — bad JSON shouldn't block generation
  }

  let result: GhostMannequinResult;
  try {
    result = await createGhostMannequin({
      userId: user.id,
      garmentImagePath: sourcePath,
      extraImagePaths: extras,
      category: mapCategoryToGhost(item.category),
    });
  } catch (err) {
    console.error("[generateGhostFor] failed:", (err as Error).message);
    return { ok: false, error: (err as Error).message ?? "Generation failed" };
  }

  const remaining = await prisma.$transaction(async (tx) => {
    await tx.wardrobeItem.update({
      where: { id: itemId },
      data: { ghostImagePath: result.resultImagePath },
    });
    await tx.tryOnGeneration.create({
      data: {
        userId: user.id,
        itemId,
        resultImagePath: result.resultImagePath,
        creditsUsed: result.credits,
      },
    });
    if (REAL_GHOST) {
      const updated = await tx.user.update({
        where: { id: user.id },
        data: { credits: { decrement: result.credits } },
        select: { credits: true },
      });
      return updated.credits;
    }
    return dbUser?.credits ?? 0;
  });

  revalidatePath("/closet");
  revalidatePath(`/closet/${itemId}`);
  return { ok: true, ghostImagePath: result.resultImagePath, creditsRemaining: remaining };
}

export type GenerateGhostViewResponse =
  | { ok: true; ghostImagePath: string; creditsRemaining: number }
  | { ok: false; error: string };

/**
 * Generate an additional ghost-mannequin view for an existing saved item,
 * using a caller-specified subset of the item's images. The new view is
 * appended to item.ghostViews; item.ghostImagePath is set only when this is
 * the very first ghost for the item.
 */
export async function generateGhostViewFor(
  itemId: string,
  selectedExtraPaths: string[],
  label: string,
): Promise<GenerateGhostViewResponse> {
  const user = await requireUser();
  const [item, dbUser] = await Promise.all([
    prisma.wardrobeItem.findUnique({ where: { id: itemId } }),
    prisma.user.findUnique({ where: { id: user.id }, select: { credits: true } }),
  ]);
  if (!item || item.userId !== user.id) return { ok: false, error: "Item not found" };
  if (REAL_GHOST && (dbUser?.credits ?? 0) < 1) {
    return { ok: false, error: "Out of credits" };
  }

  // Validate all selected extras belong to this item's user
  for (const p of selectedExtraPaths) {
    if (!p.startsWith(`${user.id}/`)) {
      return { ok: false, error: "Image does not belong to this user" };
    }
  }

  let result: GhostMannequinResult;
  try {
    result = await createGhostMannequin({
      userId: user.id,
      garmentImagePath: item.originalImagePath,
      extraImagePaths: selectedExtraPaths,
      category: mapCategoryToGhost(item.category),
    });
  } catch (err) {
    console.error("[generateGhostViewFor] failed:", (err as Error).message);
    return { ok: false, error: (err as Error).message ?? "Generation failed" };
  }

  // Parse existing ghost views
  let existingViews: { label: string; imagePath: string }[] = [];
  try {
    if (item.ghostViews) existingViews = JSON.parse(item.ghostViews) as typeof existingViews;
  } catch {
    // ignore
  }

  const viewLabel = label.trim() || (existingViews.length === 0 ? "Ghost" : `View ${existingViews.length + 1}`);
  const newView = { label: viewLabel, imagePath: result.resultImagePath };
  const updatedViews = [...existingViews, newView];

  const remaining = await prisma.$transaction(async (tx) => {
    await tx.wardrobeItem.update({
      where: { id: itemId },
      data: {
        ghostViews: encode(updatedViews),
        // Set primary ghost only if none existed before
        ghostImagePath: item.ghostImagePath ?? result.resultImagePath,
      },
    });
    await tx.tryOnGeneration.create({
      data: {
        userId: user.id,
        itemId,
        resultImagePath: result.resultImagePath,
        creditsUsed: result.credits,
      },
    });
    if (REAL_GHOST) {
      const updated = await tx.user.update({
        where: { id: user.id },
        data: { credits: { decrement: result.credits } },
        select: { credits: true },
      });
      return updated.credits;
    }
    return dbUser?.credits ?? 0;
  });

  revalidatePath("/closet");
  revalidatePath(`/closet/${itemId}`);
  return { ok: true, ghostImagePath: result.resultImagePath, creditsRemaining: remaining };
}

export type PreviewGhostInput = {
  garmentImagePath: string;
  extraImagePaths?: string[];
  category: GhostMannequinCategory;
};

export type PreviewGhostResponse =
  | { ok: true; ghostImagePath: string; creditsRemaining: number; creditsUsed: number }
  | { ok: false; error: string };

/**
 * Generate a ghost-mannequin preview during the /closet/add flow — before any
 * WardrobeItem exists. Decrements credits in real mode (the API call already
 * cost real money) but does NOT log a TryOnGeneration row; that happens at
 * createItem time when we know the item id.
 */
export async function previewGhostMannequin(
  input: PreviewGhostInput,
): Promise<PreviewGhostResponse> {
  const user = await requireUser();
  if (!input.garmentImagePath.startsWith(`${user.id}/`)) {
    return { ok: false, error: "Image does not belong to this user" };
  }
  for (const extra of input.extraImagePaths ?? []) {
    if (!extra.startsWith(`${user.id}/`)) {
      return { ok: false, error: "Extra image does not belong to this user" };
    }
  }
  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { credits: true },
  });
  if (REAL_GHOST && (dbUser?.credits ?? 0) < 1) {
    return { ok: false, error: "Out of credits" };
  }

  let result: GhostMannequinResult;
  try {
    result = await createGhostMannequin({
      userId: user.id,
      garmentImagePath: input.garmentImagePath,
      extraImagePaths: input.extraImagePaths,
      category: input.category,
    });
  } catch (err) {
    console.error("[previewGhostMannequin] failed:", (err as Error).message);
    return { ok: false, error: (err as Error).message ?? "Generation failed" };
  }

  let creditsRemaining = dbUser?.credits ?? 0;
  if (REAL_GHOST) {
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { credits: { decrement: result.credits } },
      select: { credits: true },
    });
    creditsRemaining = updated.credits;
  }

  return {
    ok: true,
    ghostImagePath: result.resultImagePath,
    creditsRemaining,
    creditsUsed: result.credits,
  };
}
