"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  createGhostMannequin,
  mapCategoryToGhost,
} from "@/lib/services/ghostMannequin";

const REAL_GHOST = process.env.USE_REAL_GHOST_MANNEQUIN === "true";

export type GenerateGhostResponse =
  | { ok: true; ghostImagePath: string; creditsRemaining: number }
  | { ok: false; error: string };

/**
 * Generate (or regenerate) the ghost-mannequin image for an item.
 *
 * - In stub mode (USE_REAL_GHOST_MANNEQUIN != "true"), we still log a
 *   TryOnGeneration row for tracking but skip the User.credits decrement,
 *   so the demo never runs out.
 * - In real mode the credit is deducted atomically with the row insert.
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

  const sourcePath = item.cutoutImagePath ?? item.originalImagePath;
  const result = await createGhostMannequin({
    userId: user.id,
    garmentImagePath: sourcePath,
    category: mapCategoryToGhost(item.category),
  });

  // Update item, log generation, and (in real mode) decrement credits — all
  // in one transaction so the row insert and the credit deduction can't drift.
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
