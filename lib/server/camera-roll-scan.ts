import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { encode, parseStylePrefs } from "@/lib/json";
import { NONE_CATEGORY } from "@/lib/categories";
import { getOwnersFromPrefs, getPrimaryOwnerId, sanitizeOwnerIds } from "@/lib/owners";
import { DEFAULT_SCAN_SCENE, type ScanSceneType } from "@/lib/scan-scene";
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
  /**
   * The image holds other garments too, so the ghost prompt needs the
   * "ignore any other clothing" instruction. Several work items can share one
   * hand-framed photo; `discardReviewItem` leaves that file alone because it
   * only deletes a path that differs from `sourcePhotoPath`.
   */
  sharesFrame: boolean;
};

async function resolveGarmentWorkItems(
  userId: string,
  originalImagePath: string,
  garments: DetectedGarment[],
  manualCrop = false,
): Promise<GarmentWorkItem[]> {
  // A hand-framed photo is already the crop. Even with several garments in it,
  // re-detecting boxes would spend a call per garment to re-derive what the
  // user just drew — and the ghost prompt's "ignore other pieces" instruction
  // covers the multi-garment case.
  if (manualCrop || garments.length <= 1) {
    if (garments.length === 0) return [];
    // Every garment points at the same image. A hand-framed photo showing a
    // shirt and jeans is two catalogue items, not one — dropping the rest
    // would silently lose half the outfit.
    return garments.map((garment) => ({
      garment,
      garmentImagePath: originalImagePath,
      sharesFrame: garments.length > 1,
    }));
  }

  const items: GarmentWorkItem[] = [];
  for (const garment of garments) {
    const bbox = await detectGarmentBounds(originalImagePath, garment);
    if (!bbox) continue;
    const croppedPath = await cropGarmentRegion(userId, originalImagePath, bbox);
    if (!croppedPath) continue;
    items.push({
      garment,
      garmentImagePath: croppedPath,
      sharesFrame: true,
    });
  }

  if (items.length === 0) {
    return [
      {
        garment: garments[0]!,
        garmentImagePath: originalImagePath,
        sharesFrame: false,
      },
    ];
  }
  return items;
}

async function workItemToReview(
  work: GarmentWorkItem,
  sourcePhotoPath: string,
  closetIndex: ClosetHashEntry[],
  ownerIds: string[],
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
    ownerIds,
    // The garment is isolated from a multi-item scene, so its ghost needs the
    // "ignore other pieces" instruction. Persisted so commit can pass it on.
    isolatedCrop: work.sharesFrame || undefined,
    dHash: hash ?? undefined,
    alreadyInCloset: match ? true : undefined,
    duplicateOfName: match?.name,
    status: "ready",
    name: work.garment.name.trim() || "Imported piece",
    category: work.garment.category || NONE_CATEGORY,
    colors: work.garment.colors.length > 0 ? work.garment.colors : undefined,
    pattern: work.garment.pattern,
    material: work.garment.material,
    brand: work.garment.brand,
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
  options: {
    sceneType?: ScanSceneType;
    ownerIds?: string[];
    /** The user's own category labels, so the classifier answers in their taxonomy. */
    categoryOptions?: readonly string[];
    /**
     * The user already framed this photo in the picker, so its garment bounds
     * are decided. Skips detectGarmentBounds — a Gemini call per garment, for
     * a box worse than the one a human drew.
     */
    manualCrop?: boolean;
  } = {},
): Promise<CameraRollScanItemResult[]> {
  const sceneType = options.sceneType ?? DEFAULT_SCAN_SCENE;
  const ownerIds = options.ownerIds ?? [];
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

  const detection = await detectGarmentsInPhoto(
    originalImagePath,
    sceneType,
    options.categoryOptions ?? [],
  );
  if (!detection.isGarment || detection.garments.length === 0) {
    await deleteUpload(originalImagePath).catch(() => undefined);
    return [
      {
        reviewId,
        originalImagePath,
        status: "skipped",
        scene: detection.scene,
        reason: detection.skipReason || "Not clothing",
      },
    ];
  }

  const splitGroupId = detection.garments.length > 1 ? crypto.randomUUID() : undefined;
  const workItems = await resolveGarmentWorkItems(
    userId,
    originalImagePath,
    detection.garments,
    options.manualCrop,
  );
  return Promise.all(
    workItems.map((work) =>
      workItemToReview(work, originalImagePath, closetIndex, ownerIds, splitGroupId),
    ),
  );
}

export type CommitScanReviewSelection = {
  reviewId: string;
  name: string;
  category: string;
  include: boolean;
  /** Owner roster ids chosen in review; falls back to the batch declaration. */
  ownerIds?: string[];
  /** Brand as corrected in review. */
  brand?: string;
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
  const prefs = parseStylePrefs(dbUser?.stylePrefs);
  const primaryOwnerId = getPrimaryOwnerId(prefs);
  const validOwnerIds = getOwnersFromPrefs(prefs).map((o) => o.id);

  for (const item of jobResult.items) {
    if (item.status !== "ready") {
      updatedItems.push(item);
      continue;
    }
    const sel = byId.get(item.reviewId);
    const include = sel?.include ?? false;
    const name = sel?.name.trim() || item.name?.trim() || "Imported piece";
    const category = sel?.category?.trim() || item.category || NONE_CATEGORY;
    // Review wins, then whatever the batch was declared for, then the roster
    // default. Only the last of those is a guess.
    const owners = sanitizeOwnerIds(sel?.ownerIds ?? item.ownerIds ?? [], validOwnerIds, [
      primaryOwnerId,
    ]);
    const brand = (sel?.brand ?? item.brand)?.trim() || null;

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
        brand,
        colors: encode(item.colors ?? []),
        pattern: item.pattern ?? null,
        material: item.material ?? null,
        styleTags: encode([]),
        season: encode([]),
        owners: encode(owners),
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
