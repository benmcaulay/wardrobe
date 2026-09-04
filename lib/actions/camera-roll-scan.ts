"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { MAX_SCAN_PHOTOS, MAX_UPLOAD_BATCH } from "@/lib/camera-roll-scan-limits";
import { prisma } from "@/lib/db";
import { encode, decode } from "@/lib/json";
import { kickJobDrain } from "@/lib/jobs/kick-drain";
import {
  enqueueJob,
  getJobForUser,
  type CameraRollScanResult,
} from "@/lib/jobs/queue";
import { getOwnersFromPrefs, getPrimaryOwnerId, sanitizeOwnerIds } from "@/lib/owners";
import { parseScanSceneType } from "@/lib/scan-scene";
import { checkScanQuota } from "@/lib/ai-guardrails";
import { commitScanReview } from "@/lib/server/camera-roll-scan";
import { assignDuplicateGroups } from "@/lib/server/scan-duplicate-groups";
import { saveUpload, UploadError } from "@/lib/uploads";
import { parseStylePrefs } from "@/lib/json";
import type {
  ActiveScanJobResponse,
  CameraRollScanStatusResponse,
  CommitScanReviewItemInput,
  CommitScanReviewResponse,
  StartScanOptions,
  StartCameraRollScanResponse,
  UploadScanBatchResponse,
} from "@/lib/camera-roll-scan-types";

/** Save a batch of camera-roll photos before starting the scan job. */
export async function uploadScanBatch(formData: FormData): Promise<UploadScanBatchResponse> {
  const user = await requireUser();
  const entries = formData.getAll("images");
  if (entries.length === 0) {
    return { ok: false, error: "No photos selected" };
  }
  if (entries.length > MAX_UPLOAD_BATCH) {
    return { ok: false, error: `Upload at most ${MAX_UPLOAD_BATCH} photos per batch` };
  }

  const paths: string[] = [];
  const rejected: string[] = [];
  for (const entry of entries) {
    if (!(entry instanceof File) || entry.size === 0) {
      rejected.push("empty file");
      continue;
    }
    try {
      const saved = await saveUpload(entry, user.id);
      paths.push(saved.originalImagePath);
    } catch (err) {
      rejected.push(err instanceof UploadError ? err.message : "Upload failed");
    }
  }

  if (paths.length === 0) {
    return { ok: false, error: rejected[0] ?? "Could not upload photos" };
  }
  return { ok: true, paths, rejected };
}

/** Enqueue background scan → classify → ghost (review before import). */
export async function startCameraRollScan(
  photoPaths: string[],
  options?: Partial<StartScanOptions>,
): Promise<StartCameraRollScanResponse> {
  const user = await requireUser();
  const unique = [...new Set(photoPaths.map((p) => p.trim()).filter(Boolean))];
  if (unique.length === 0) {
    return { ok: false, error: "No photos to scan" };
  }
  if (unique.length > MAX_SCAN_PHOTOS) {
    return { ok: false, error: `Scans are limited to ${MAX_SCAN_PHOTOS} photos at a time` };
  }
  for (const path of unique) {
    if (!path.startsWith(`${user.id}/`)) {
      return { ok: false, error: "One or more photos do not belong to you" };
    }
  }

  // Classification has no ledger row, so the generation quota cannot see it.
  // Cap scans per day instead — each is bounded by MAX_SCAN_PHOTOS.
  const scanQuota = await checkScanQuota(user.id);
  if (!scanQuota.ok) return { ok: false, error: scanQuota.error };

  // Resolve the declared owners against the live roster here rather than
  // trusting the client: the job payload outlives the tab that created it, and
  // a roster entry can be deleted in Settings while a scan is queued.
  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { stylePrefs: true },
  });
  const prefs = parseStylePrefs(dbUser?.stylePrefs);
  const ownerIds = sanitizeOwnerIds(
    options?.ownerIds ?? [],
    getOwnersFromPrefs(prefs).map((o) => o.id),
    [getPrimaryOwnerId(prefs)],
  );

  // Reference photos are validated the same way as scan photos: they were
  // uploaded through uploadScanBatch, so they must live under this user's
  // prefix. Owners are resolved against the live roster for the same reason.
  const rosterIds = getOwnersFromPrefs(prefs).map((o) => o.id);
  const references = (options?.references ?? [])
    .map((ref) => ({
      ownerId: ref.ownerId,
      paths: [...new Set(ref.paths.map((p) => p.trim()).filter(Boolean))].filter((p) =>
        p.startsWith(`${user.id}/`),
      ),
    }))
    .filter((ref) => rosterIds.includes(ref.ownerId) && ref.paths.length > 0);

  const jobId = await enqueueJob(user.id, "camera_roll_scan", {
    photoPaths: unique,
    sceneType: parseScanSceneType(options?.sceneType),
    ownerIds,
    references: references.length > 0 ? references : undefined,
  });
  kickJobDrain(unique.length);
  return { ok: true, jobId };
}

function scanResultNeedsReview(result: CameraRollScanResult | null): boolean {
  if (!result || result.committed) return false;
  return result.items.some((i) => i.status === "ready");
}

async function ensureDuplicateGroups(
  jobId: string,
  result: CameraRollScanResult,
): Promise<CameraRollScanResult> {
  const ready = result.items.filter((i) => i.status === "ready");
  if (ready.length < 2 || ready.some((i) => i.duplicateGroupId)) return result;

  const items = await assignDuplicateGroups(result.items);
  const next = { ...result, items };
  await prisma.generationJob.update({
    where: { id: jobId },
    data: { result: encode(next) },
  });
  return next;
}

async function loadScanJobResult(jobId: string, userId: string) {
  const job = await getJobForUser<CameraRollScanResult>(jobId, userId);
  if (!job) return null;
  return job;
}

export async function getCameraRollScanStatus(
  jobId: string,
): Promise<CameraRollScanStatusResponse> {
  const user = await requireUser();
  const job = await loadScanJobResult(jobId, user.id);
  if (!job) return { ok: false, error: "Job not found" };

  if (job.status === "failed") {
    return { ok: false, error: job.error ?? "Scan failed" };
  }

  const credits = await prisma.user.findUnique({
    where: { id: user.id },
    select: { credits: true },
  });
  const withCredits = (result: CameraRollScanResult): CameraRollScanResult => ({
    ...result,
    creditsRemaining: credits?.credits ?? result.creditsRemaining,
  });

  if (job.status === "succeeded" && job.result) {
    let result = withCredits(job.result);
    if (scanResultNeedsReview(result)) {
      result = await ensureDuplicateGroups(jobId, result);
      return { ok: true, status: "review", result, jobId };
    }
    if (result.committed) {
      return { ok: true, status: "committed", result, jobId };
    }
    return { ok: true, status: "review", result, jobId };
  }

  return {
    ok: true,
    status: job.status === "running" ? "running" : "queued",
    progress: job.result ? withCredits(job.result) : null,
  };
}

/** Resume an in-flight scan or a finished scan awaiting review. */
export async function getActiveCameraRollScanJob(): Promise<ActiveScanJobResponse> {
  const user = await requireUser();

  const running = await prisma.generationJob.findFirst({
    where: {
      userId: user.id,
      type: "camera_roll_scan",
      status: { in: ["queued", "running"] },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (running) return { ok: true, jobId: running.id, mode: "scanning" };

  const recent = await prisma.generationJob.findMany({
    where: {
      userId: user.id,
      type: "camera_roll_scan",
      status: "succeeded",
    },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { id: true, result: true },
  });
  for (const job of recent) {
    const result = job.result
      ? decode<CameraRollScanResult>(job.result, null as unknown as CameraRollScanResult)
      : null;
    if (scanResultNeedsReview(result)) {
      return { ok: true, jobId: job.id, mode: "review" };
    }
  }

  return { ok: true, jobId: null, mode: null };
}

/** Import selected review items into the closet; discard the rest. */
export async function commitScanReviewItems(
  jobId: string,
  selections: CommitScanReviewItemInput[],
): Promise<CommitScanReviewResponse> {
  const user = await requireUser();
  const job = await prisma.generationJob.findUnique({ where: { id: jobId } });
  if (!job || job.userId !== user.id) return { ok: false, error: "Job not found" };
  if (job.status !== "succeeded") return { ok: false, error: "Scan is not finished yet" };
  if (!job.result) return { ok: false, error: "Nothing to import" };

  const result = decode<CameraRollScanResult>(job.result, {
    total: 0,
    processed: 0,
    ready: 0,
    skipped: 0,
    failed: 0,
    items: [],
  });
  if (result.committed) return { ok: false, error: "This scan was already imported" };

  const { imported, discarded, itemIds, updatedItems } = await commitScanReview(
    user.id,
    result,
    selections,
  );

  const nextResult: CameraRollScanResult = {
    ...result,
    items: updatedItems,
    committed: true,
    ready: 0,
  };

  await prisma.generationJob.update({
    where: { id: jobId },
    data: { result: encode(nextResult) },
  });

  // Kick the worker to process the background ghost jobs enqueued for each
  // imported piece (ghosting is deferred so we only ghost kept items).
  if (itemIds.length > 0) kickJobDrain(itemIds.length);

  revalidatePath("/closet");
  revalidatePath("/closet/scan");
  return { ok: true, imported, discarded };
}
