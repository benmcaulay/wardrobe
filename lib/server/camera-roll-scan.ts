import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { encode } from "@/lib/json";
import { NONE_CATEGORY } from "@/lib/categories";
import { checkAiQuota } from "@/lib/ai-guardrails";
import { log } from "@/lib/log";
import {
  detectGarmentBounds,
  detectGarmentsInPhoto,
  type DetectedGarment,
} from "@/lib/services/garmentClassifier";
import { cropGarmentRegion } from "@/lib/services/garment-crop";
import { createGhostMannequin, mapCategoryToGhost } from "@/lib/services/ghostMannequin";
import { deleteUpload } from "@/lib/uploads";
import type {
  CameraRollScanItemResult,
  CameraRollScanProgress,
} from "@/lib/jobs/queue";

const REAL_GHOST = process.env.USE_REAL_GHOST_MANNEQUIN === "true";

type GarmentWorkItem = {
  garment: DetectedGarment;
  garmentImagePath: string;
  /** Temp crop stored separately from the source photo. */
  isDerivedCrop: boolean;
};

async function resolveGarmentWorkItems(
  userId: string,
  originalImagePath: string,
  garments: DetectedGarment[],
): Promise<GarmentWorkItem[]> {
  if (garments.length <= 1) {
    const garment = garments[0];
    if (!garment) return [];
    return [{ garment, garmentImagePath: originalImagePath, isDerivedCrop: false }];
  }

  const items: GarmentWorkItem[] = [];
  for (const garment of garments) {
    const bbox = await detectGarmentBounds(originalImagePath, garment);
    if (!bbox) continue;
    const croppedPath = await cropGarmentRegion(userId, originalImagePath, bbox);
    if (!croppedPath) continue;
    items.push({ garment, garmentImagePath: croppedPath, isDerivedCrop: true });
  }

  if (items.length === 0) {
    return [{ garment: garments[0]!, garmentImagePath: originalImagePath, isDerivedCrop: false }];
  }
  return items;
}

async function ghostOneGarment(
  userId: string,
  work: GarmentWorkItem,
  sourcePhotoPath: string,
  splitGroupId?: string,
): Promise<CameraRollScanItemResult> {
  const reviewId = crypto.randomUUID();
  const category = work.garment.category || NONE_CATEGORY;
  const name = work.garment.name.trim() || "Imported piece";

  const quota = await checkAiQuota(userId);
  if (!quota.ok) {
    return {
      reviewId,
      originalImagePath: work.garmentImagePath,
      sourcePhotoPath,
      splitGroupId,
      status: "failed",
      name,
      category,
      error: quota.error,
    };
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { credits: true },
  });
  if (REAL_GHOST && (dbUser?.credits ?? 0) < 1) {
    return {
      reviewId,
      originalImagePath: work.garmentImagePath,
      sourcePhotoPath,
      splitGroupId,
      status: "failed",
      name,
      category,
      error: "Out of credits",
    };
  }

  try {
    const ghost = await createGhostMannequin({
      userId,
      garmentImagePath: work.garmentImagePath,
      category: mapCategoryToGhost(category),
      compositionHint: "default",
      instructions:
        work.isDerivedCrop || sourcePhotoPath !== work.garmentImagePath
          ? "This is a cropped photo of ONE garment from a multi-item scene. Ghost ONLY this piece — ignore any other clothing that may appear at the edges."
          : undefined,
    });

    if (REAL_GHOST && ghost.credits > 0) {
      await prisma.user.update({
        where: { id: userId },
        data: { credits: { decrement: ghost.credits } },
      });
    }

    return {
      reviewId,
      originalImagePath: work.garmentImagePath,
      sourcePhotoPath,
      splitGroupId,
      status: "ready",
      ghostImagePath: ghost.resultImagePath,
      name,
      category,
      creditsUsed: ghost.credits,
    };
  } catch (err) {
    log.error("camera-roll.ghost.failed", err, {
      userId,
      originalImagePath: work.garmentImagePath,
      sourcePhotoPath,
    });
    return {
      reviewId,
      originalImagePath: work.garmentImagePath,
      sourcePhotoPath,
      splitGroupId,
      status: "failed",
      name,
      category,
      error: (err as Error).message ?? "Ghost generation failed",
    };
  }
}

/**
 * Classify + ghost one camera-roll photo. May return multiple review items when
 * the photo contains several distinct garments.
 */
export async function processScanPhotoForReview(
  userId: string,
  originalImagePath: string,
): Promise<CameraRollScanItemResult[]> {
  const reviewId = crypto.randomUUID();

  if (!originalImagePath.startsWith(`${userId}/`)) {
    return [
      {
        reviewId,
        originalImagePath,
        status: "failed",
        error: "Image does not belong to this user",
      },
    ];
  }

  const detection = await detectGarmentsInPhoto(originalImagePath);
  if (!detection.isGarment || detection.garments.length === 0) {
    await deleteUpload(originalImagePath).catch(() => undefined);
    return [{ reviewId, originalImagePath, status: "skipped" }];
  }

  const splitGroupId = detection.garments.length > 1 ? crypto.randomUUID() : undefined;
  const workItems = await resolveGarmentWorkItems(userId, originalImagePath, detection.garments);
  const results: CameraRollScanItemResult[] = [];

  for (const work of workItems) {
    const result = await ghostOneGarment(userId, work, originalImagePath, splitGroupId);
    results.push(result);
    if (result.status === "failed" && result.error === "Out of credits") break;
  }

  return results;
}

export type CommitScanReviewSelection = {
  reviewId: string;
  name: string;
  category: string;
  include: boolean;
};

export type CommitScanReviewResult = {
  imported: number;
  discarded: number;
  itemIds: string[];
  updatedItems: CameraRollScanItemResult[];
};

/** Persist approved review items; discard the rest (and their uploads). */
export async function commitScanReview(
  userId: string,
  jobResult: CameraRollScanProgress,
  selections: CommitScanReviewSelection[],
): Promise<CommitScanReviewResult> {
  const byId = new Map(selections.map((s) => [s.reviewId, s]));
  let imported = 0;
  let discarded = 0;
  const itemIds: string[] = [];
  const updatedItems: CameraRollScanItemResult[] = [];

  for (const item of jobResult.items) {
    if (item.status !== "ready") {
      updatedItems.push(item);
      continue;
    }
    const sel = byId.get(item.reviewId);
    const include = sel?.include ?? false;
    const name = sel?.name.trim() || item.name?.trim() || "Imported piece";
    const category = sel?.category?.trim() || item.category || NONE_CATEGORY;

    if (!include) {
      await discardReviewItem(userId, item);
      updatedItems.push({ ...item, status: "discarded" });
      discarded += 1;
      continue;
    }

    if (!item.ghostImagePath?.startsWith(`${userId}/`)) {
      updatedItems.push({ ...item, status: "failed", error: "Missing ghost image" });
      continue;
    }

    const ghostViews = [
      { label: "Ghost", imagePath: item.ghostImagePath, mirror: false, thumbZoom: 1 },
    ];
    const created = await prisma.wardrobeItem.create({
      data: {
        userId,
        name,
        category,
        colors: encode([]),
        styleTags: encode([]),
        season: encode([]),
        originalImagePath: item.originalImagePath,
        ghostImagePath: item.ghostImagePath,
        ghostViews: encode(ghostViews),
      },
    });
    await prisma.tryOnGeneration.create({
      data: {
        userId,
        itemId: created.id,
        resultImagePath: item.ghostImagePath,
        creditsUsed: item.creditsUsed ?? 1,
      },
    });
    updatedItems.push({ ...item, status: "imported", name, category, itemId: created.id });
    itemIds.push(created.id);
    imported += 1;
  }

  const bySource = new Map<string, CameraRollScanItemResult[]>();
  for (const item of updatedItems) {
    if (!item.sourcePhotoPath?.startsWith(`${userId}/`)) continue;
    const list = bySource.get(item.sourcePhotoPath) ?? [];
    list.push(item);
    bySource.set(item.sourcePhotoPath, list);
  }
  for (const [sourcePath, related] of bySource) {
    const allTerminal = related.every(
      (r) => r.status === "discarded" || r.status === "imported" || r.status === "failed",
    );
    if (!allTerminal) continue;
    const keptAsOriginal = related.some(
      (r) => r.status === "imported" && r.originalImagePath === sourcePath,
    );
    if (!keptAsOriginal) {
      await deleteUpload(sourcePath).catch(() => undefined);
    }
  }

  return { imported, discarded, itemIds, updatedItems };
}

async function discardReviewItem(
  userId: string,
  item: Pick<
    CameraRollScanItemResult,
    "originalImagePath" | "ghostImagePath" | "sourcePhotoPath"
  >,
): Promise<void> {
  if (
    item.originalImagePath.startsWith(`${userId}/`) &&
    item.originalImagePath !== item.sourcePhotoPath
  ) {
    await deleteUpload(item.originalImagePath).catch(() => undefined);
  }
  if (item.ghostImagePath?.startsWith(`${userId}/`)) {
    await deleteUpload(item.ghostImagePath).catch(() => undefined);
  }
}

export function tallyScanProgress(
  items: CameraRollScanItemResult[],
): Omit<CameraRollScanProgress, "total" | "items" | "committed" | "creditsRemaining" | "processed"> {
  let ready = 0;
  let skipped = 0;
  let failed = 0;
  for (const item of items) {
    if (item.status === "ready") ready += 1;
    else if (item.status === "skipped") skipped += 1;
    else if (item.status === "failed") failed += 1;
  }
  return { ready, skipped, failed };
}

/** @deprecated Use processScanPhotoForReview */
export const ingestScanPhoto = processScanPhotoForReview;
