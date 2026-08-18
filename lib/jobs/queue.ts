/**
 * DB-backed generation job queue. Postgres is the broker — no Redis/SQS needed
 * at this scale. Jobs are claimed with SELECT ... FOR UPDATE SKIP LOCKED so
 * multiple workers (or worker + serverless drain) never double-run a job.
 */
import type { GenerationJob } from "@prisma/client";
import { prisma } from "../db";
import { encode, decode } from "../json";

export type GenerationJobType =
  | "virtual_tryon"
  | "ghost_view"
  | "ghost_preview"
  | "camera_roll_scan";
export type GenerationJobStatus = "queued" | "running" | "succeeded" | "failed";

/** Payload stored on a job, keyed by type. */
export type VirtualTryOnJobPayload = {
  personPhotoId: string;
  itemIds: string[];
  outfitId: string | null;
  prompt?: string;
};

export type GhostViewJobPayload = {
  itemId: string;
  selectedExtraPaths: string[];
  label: string;
  instructions?: string;
  primaryGarmentPath?: string | null;
  compositionHint?: "default" | "rear";
};

export type GhostPreviewJobPayload = {
  garmentImagePath: string;
  extraImagePaths?: string[];
  primaryGarmentPathOverride?: string | null;
  category: string;
  instructions?: string;
  compositionHint?: "default" | "rear";
};

/** Result stored on a succeeded job. */
export type VirtualTryOnJobResult = {
  tryOnId: string;
  resultImagePath: string;
  creditsRemaining: number;
  creditsUsed: number;
};

export type GhostViewJobResult = {
  ghostImagePath: string;
  creditsRemaining: number;
  /** 0 when the render was served from cache. */
  creditsUsed?: number;
  viewLabel: string;
};

export type GhostPreviewJobResult = {
  ghostImagePath: string;
  creditsRemaining: number;
  creditsUsed: number;
  viewLabel?: string;
};

export type CameraRollScanPayload = {
  photoPaths: string[];
};

export type CameraRollScanItemResult = {
  reviewId: string;
  originalImagePath: string;
  status: "ready" | "skipped" | "failed" | "imported" | "discarded";
  ghostImagePath?: string;
  name?: string;
  category?: string;
  /** Attributes inferred by the classifier, applied to the item at commit. */
  colors?: { hex: string; name: string }[];
  pattern?: string;
  material?: string;
  creditsUsed?: number;
  itemId?: string;
  /** Shared when multiple photos likely show the same garment. */
  duplicateGroupId?: string;
  /** When a scan photo was split into multiple garments. */
  splitGroupId?: string;
  /** True when this piece was cropped out of a multi-item scene (affects ghost prompt). */
  isolatedCrop?: boolean;
  /** Perceptual hash of the garment image, carried so commit persists it without recompute. */
  dHash?: string;
  /** Set when this piece already appears to exist in the closet (pre-unchecked in review). */
  alreadyInCloset?: boolean;
  /** Name of the existing closet item this one duplicates. */
  duplicateOfName?: string;
  /** Original camera-roll upload before per-garment crop. */
  sourcePhotoPath?: string;
  reason?: string;
  error?: string;
};

export type CameraRollScanProgress = {
  total: number;
  processed: number;
  ready: number;
  skipped: number;
  failed: number;
  items: CameraRollScanItemResult[];
  creditsRemaining?: number;
  /** Set after the user imports or discards all review items. */
  committed?: boolean;
};

export type CameraRollScanResult = CameraRollScanProgress;

const DEFAULT_MAX_ATTEMPTS = 3;

export async function enqueueJob(
  userId: string,
  type: GenerationJobType,
  payload: unknown,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
): Promise<string> {
  const job = await prisma.generationJob.create({
    data: { userId, type, payload: encode(payload), maxAttempts },
    select: { id: true },
  });
  return job.id;
}

/**
 * Atomically claim the oldest queued job (or a failed job due for retry),
 * marking it running. SKIP LOCKED makes this safe under concurrent workers.
 * Returns null when nothing is runnable.
 */
export async function claimNextJob(): Promise<GenerationJob | null> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "GenerationJob"
    SET status = 'running', "startedAt" = NOW(), attempts = attempts + 1, "updatedAt" = NOW()
    WHERE id = (
      SELECT id FROM "GenerationJob"
      WHERE status = 'queued'
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id
  `;
  const id = rows[0]?.id;
  if (!id) return null;
  return prisma.generationJob.findUnique({ where: { id } });
}

/** Pure retry decision: a job retries while it has attempts left. */
export function willRetry(attempts: number, maxAttempts: number): boolean {
  return attempts < maxAttempts;
}

export async function markJobSucceeded(id: string, result: unknown): Promise<void> {
  await prisma.generationJob.update({
    where: { id },
    data: { status: "succeeded", result: encode(result), error: null, finishedAt: new Date() },
  });
}

/** Persist partial progress while a long-running job is still executing. */
export async function updateJobProgress(id: string, result: unknown): Promise<void> {
  await prisma.generationJob.update({
    where: { id },
    data: { result: encode(result), status: "running" },
  });
}

/**
 * Mark a job failed. If it still has attempts left, it goes back to "queued"
 * for retry; otherwise it's terminally "failed". Returns whether it will retry.
 */
export async function markJobFailed(job: GenerationJob, error: string): Promise<boolean> {
  const retry = willRetry(job.attempts, job.maxAttempts);
  await prisma.generationJob.update({
    where: { id: job.id },
    data: {
      status: retry ? "queued" : "failed",
      error,
      finishedAt: retry ? null : new Date(),
    },
  });
  return retry;
}

export type JobView<T = unknown> = {
  id: string;
  type: string;
  status: GenerationJobStatus;
  result: T | null;
  error: string | null;
};

/** Read a job for the owning user (status polling). Returns null if not theirs. */
export async function getJobForUser<T = VirtualTryOnJobResult>(
  id: string,
  userId: string,
): Promise<JobView<T> | null> {
  const job = await prisma.generationJob.findUnique({ where: { id } });
  if (!job || job.userId !== userId) return null;
  return {
    id: job.id,
    type: job.type,
    status: job.status as GenerationJobStatus,
    result: job.result ? decode<T>(job.result, null as T) : null,
    error: job.error,
  };
}

export function parsePayload<T = VirtualTryOnJobPayload>(job: GenerationJob): T {
  return decode<T>(job.payload, {} as T);
}

/** Oldest in-flight ghost_view job for an item (for resuming UI polling after navigation). */
export async function findPendingGhostViewJobForItem(
  userId: string,
  itemId: string,
): Promise<string | null> {
  const jobs = await prisma.generationJob.findMany({
    where: {
      userId,
      type: "ghost_view",
      status: { in: ["queued", "running"] },
    },
    orderBy: { createdAt: "asc" },
    take: 20,
    select: { id: true, payload: true },
  });
  for (const job of jobs) {
    const payload = decode<GhostViewJobPayload>(job.payload, {} as GhostViewJobPayload);
    if (payload.itemId === itemId) return job.id;
  }
  return null;
}
