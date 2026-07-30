import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { encode, parseStylePrefs } from "@/lib/json";
import { NONE_CATEGORY } from "@/lib/categories";
import { getPrimaryOwnerId } from "@/lib/owners";
import { checkAiQuota } from "@/lib/ai-guardrails";
import {
  detectGarmentBounds,
  detectGarmentsInPhoto,
  type DetectedGarment,
} from "@/lib/services/garmentClassifier";
import { cropGarmentRegion } from "@/lib/services/garment-crop";
import { computeDHash } from "@/lib/image-dhash";
import { findClosetMatch, type ClosetHashEntry } from "@/lib/server/scan-closet-index";
import { enqueueJob } from "@/lib/jobs/queue";
import { deleteUpload } from "@/lib/uploads";
import type {
  CameraRollScanItemResult,
  CameraRollScanProgress,
} from "@/lib/jobs/queue";

/** Ghost prompt used when a piece was isolated from a multi-item scene. */
const ISOLATED_CROP_GHOST_INSTRUCTION =
  "This is a cropped photo of ONE garment from a multi-item scene. Ghost ONLY this piece — ignore any other clothing that may appear at the edges.";

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

async function workItemToReview(
  work: GarmentWorkItem,
  sourcePhotoPath: string,
  closetIndex: ClosetHashEntry[],
  splitGroupId?: string,
): Promise<CameraRollScanItemResult> {
  // Hash the crop so commit can persist it and so we can flag pieces already
  // in the closet (e.g. a garment from a multi-item scene we've imported before).
  const hash = await computeDHash(work.garmentImagePath).catch(() => null);
  const match =
    hash && closetIndex.length > 0
      ? findClosetMatch(hash, work.garment.name, work.garment.category, closetIndex)
      : null;

  return {
    reviewId: crypto.randomUUID(),
    originalImagePath: work.garmentImagePath,
    sourcePhotoPath,
    splitGroupId,
    // The garment is isolated from a multi-item scene, so its ghost needs the
    // "ignore other pieces" instruction. Persisted so commit can pass it on.
    isolatedCrop: work.isDerivedCrop || undefined,
    dHash: hash ?? undefined,
    alreadyInCloset: match ? true : undefined,
    duplicateOfName: match?.name,
    status: "ready",
    name: work.garment.name.trim() || "Imported piece",
    category: work.garment.category || NONE_CATEGORY,
    colors: work.garment.colors.length > 0 ? work.garment.colors : undefined,
    pattern: work.garment.pattern,
    material: work.garment.material,
  };
}

/**
 * Classify + crop one camera-roll photo into review items. Ghosting is deferred
 * to commit so we only pay (time + credits) for pieces the user actually keeps.
 * May return multiple review items when the photo contains several garments.
 *
 * `closetIndex` holds perceptual hashes of the existing closet: an exact re-scan
 * of an already-imported photo is skipped before the paid classifier call, and
 * per-garment matches are flagged so review can pre-uncheck them.
 */
export async function processScanPhotoForReview(
  userId: string,
  originalImagePath: string,
  closetIndex: ClosetHashEntry[] = [],
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

  // Cheap gate before paying to classify: if this exact photo already matches a
  // closet item (common when re-scanning the same roll), skip it entirely.
  if (closetIndex.length > 0) {
    const photoHash = await computeDHash(originalImagePath).catch(() => null);
    if (photoHash && findClosetMatch(photoHash, undefined, undefined, closetIndex)) {
      await deleteUpload(originalImagePath).catch(() => undefined);
      return [{ reviewId, originalImagePath, status: "skipped", reason: "Already in your closet" }];
    }
  }

  const quota = await checkAiQuota(userId);
  if (!quota.ok) {
    return [{ reviewId, originalImagePath, status: "failed", error: quota.error }];
  }

  const detection = await detectGarmentsInPhoto(originalImagePath);
  if (!detection.isGarment || detection.garments.length === 0) {
    await deleteUpload(originalImagePath).catch(() => undefined);
    return [{ reviewId, originalImagePath, status: "skipped", reason: "Not clothing" }];
  }

  const splitGroupId = detection.garments.length > 1 ? crypto.randomUUID() : undefined;
  const workItems = await resolveGarmentWorkItems(userId, originalImagePath, detection.garments);
  return Promise.all(
    workItems.map((work) => workItemToReview(work, originalImagePath, closetIndex, splitGroupId)),
  );
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

/**
 * Persist approved review items; discard the rest (and their uploads).
 *
 * Items are created immediately from the classified crop (so they appear in the
 * closet right away) and a background ghost-mannequin job is enqueued for each —
 * ghosting only runs for pieces the user kept, not the whole scan.
 */
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

  const dbUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { stylePrefs: true },
  });
  const primaryOwnerId = getPrimaryOwnerId(parseStylePrefs(dbUser?.stylePrefs));

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

    if (!item.originalImagePath.startsWith(`${userId}/`)) {
      updatedItems.push({ ...item, status: "failed", error: "Missing garment image" });
      continue;
    }

    const created = await prisma.wardrobeItem.create({
      data: {
        userId,
        name,
        category,
        colors: encode(item.colors ?? []),
        pattern: item.pattern ?? null,
        material: item.material ?? null,
        styleTags: encode([]),
        season: encode([]),
        owners: encode([primaryOwnerId]),
        originalImagePath: item.originalImagePath,
        dHash: item.dHash ?? null,
      },
    });

    // Ghost in the background so import is instant and we only ghost kept pieces.
    await enqueueJob(userId, "ghost_view", {
      itemId: created.id,
      selectedExtraPaths: [],
      label: "Ghost",
      instructions: item.isolatedCrop ? ISOLATED_CROP_GHOST_INSTRUCTION : undefined,
      compositionHint: "default",
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
