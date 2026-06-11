/**
 * DB-backed generation job queue. Postgres is the broker — no Redis/SQS needed
 * at this scale. Jobs are claimed with SELECT ... FOR UPDATE SKIP LOCKED so
 * multiple workers (or worker + serverless drain) never double-run a job.
 */
import type { GenerationJob } from "@prisma/client";
import { prisma } from "../db";
import { encode, decode } from "../json";

export type GenerationJobType = "virtual_tryon";
export type GenerationJobStatus = "queued" | "running" | "succeeded" | "failed";

/** Payload stored on a job, keyed by type. */
export type VirtualTryOnJobPayload = {
  personPhotoId: string;
  itemIds: string[];
  outfitId: string | null;
  prompt?: string;
};

/** Result stored on a succeeded job. */
export type VirtualTryOnJobResult = {
  tryOnId: string;
  resultImagePath: string;
  creditsRemaining: number;
  creditsUsed: number;
};

const DEFAULT_MAX_ATTEMPTS = 3;

export async function enqueueJob(
  userId: string,
  type: GenerationJobType,
  payload: VirtualTryOnJobPayload,
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

export async function markJobSucceeded(
  id: string,
  result: VirtualTryOnJobResult,
): Promise<void> {
  await prisma.generationJob.update({
    where: { id },
    data: { status: "succeeded", result: encode(result), error: null, finishedAt: new Date() },
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
