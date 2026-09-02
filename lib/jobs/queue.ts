/**
 * DB-backed generation job queue. Postgres is the broker — no Redis/SQS needed
 * at this scale. Jobs are claimed with SELECT ... FOR UPDATE SKIP LOCKED so
 * multiple workers (or worker + serverless drain) never double-run a job.
 */
import type { GenerationJob } from "@prisma/client";
import { prisma } from "../db";
import { encode, decode } from "../json";
import { log } from "../log";
import type { ObservedScene, ScanSceneType } from "../scan-scene";

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
  /** Model that produced it, so the ledger row can attribute the spend. */
  model?: string | null;
  /** List-price cost in tenths of a cent; 0 for a cache hit or stub. */
  costTenthCents?: number;
};

export type CameraRollScanPayload = {
  photoPaths: string[];
  /** What the user said this batch is (Mode A). Absent on pre-Mode-A jobs. */
  sceneType?: ScanSceneType;
  /** Owner roster ids the batch was declared for; the review default. */
  ownerIds?: string[];
  /**
   * Mode B: hand-picked reference photos per owner. Used to build an in-memory
   * face centroid for the length of the job and then discarded — no template is
   * ever persisted. Absent means Mode A (the user already filtered by hand).
   */
  references?: { ownerId: string; paths: string[] }[];
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
  /** Owner roster ids this piece will be filed under; editable in review. */
  ownerIds?: string[];
  /** What the classifier reported seeing, for the skip reason and telemetry. */
  scene?: ObservedScene;
  /** Mode B: cosine against the matched owner's reference centroid. */
  faceSimilarity?: number;
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
 * How long a claimed job may go without progress before another worker may
 * take it.
 *
 * A worker that dies mid-job leaves the row in "running" forever. Nothing else
 * ever moved it: the claim below only looked at "queued", so the job was not
 * retried, not failed, and not visible as broken — the item just said
 * "Generating…" indefinitely with its controls disabled and no way to recover
 * from the UI. That happened three times during development, once by killing
 * the dev server mid-generation.
 *
 * The lease is a heartbeat, not a timeout: `updateJobProgress` bumps
 * `updatedAt`, so a legitimately slow job (a camera-roll scan working through
 * 50 photos) keeps renewing it and is never stolen. It only has to exceed the
 * longest gap between two progress writes — a single ghost generation, whose
 * own request timeout is 120s. Ten minutes is generous against that.
 */
export const JOB_LEASE_MINUTES = 10;

/** Pure: may a claimed job be reclaimed, given how long it has been silent? */
export function leaseExpired(updatedAt: Date, now: Date, leaseMinutes = JOB_LEASE_MINUTES): boolean {
  return now.getTime() - updatedAt.getTime() >= leaseMinutes * 60_000;
}

/**
 * Atomically claim the oldest runnable job, marking it running. SKIP LOCKED
 * makes this safe under concurrent workers.
 *
 * Runnable is "queued", or "running" whose lease has expired — see
 * JOB_LEASE_MINUTES. Reclaiming still increments `attempts`, so a job that
 * reliably kills its worker exhausts `maxAttempts` and fails properly rather
 * than looping forever.
 *
 * Returns null when nothing is runnable.
 */
export async function claimNextJob(): Promise<GenerationJob | null> {
  /*
   * Cutoff computed here rather than with MAKE_INTERVAL: Prisma binds a JS
   * number as bigint, and make_interval(mins => bigint) does not resolve.
   *
   * The AT TIME ZONE 'UTC' below is load-bearing, not decoration. These
   * columns are `timestamp without time zone`, and the two writers have to
   * agree on what naive means: Prisma's own @updatedAt writes naive UTC, while
   * a bare NOW() assigned to that column writes naive *local*. Mixing them put
   * a freshly-claimed job seven hours in the past on read, which would make
   * this lease steal live jobs on the very next poll.
   */
  const leaseCutoff = new Date(Date.now() - JOB_LEASE_MINUTES * 60_000);
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "GenerationJob"
    SET status = 'running',
        "startedAt" = (NOW() AT TIME ZONE 'UTC'),
        attempts = attempts + 1,
        "updatedAt" = (NOW() AT TIME ZONE 'UTC')
    WHERE id = (
      SELECT id FROM "GenerationJob"
      WHERE (
        status = 'queued'
        OR (
          status = 'running'
          AND "updatedAt" < ${leaseCutoff}
          AND attempts < "maxAttempts"
        )
      )
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

/**
 * Terminally fail jobs whose lease expired with no attempts left.
 *
 * The claim above deliberately only reclaims jobs that still have a retry in
 * them, which would otherwise leave an exhausted job stuck in "running"
 * forever — the exact state this whole mechanism exists to prevent, reached by
 * a longer route. Sweeping them into "failed" means every job ends somewhere.
 */
export async function failExpiredJobs(leaseMinutes = JOB_LEASE_MINUTES): Promise<number> {
  // Raw, because this has to compare two columns (attempts vs maxAttempts) and
  // must be the exact complement of the claim's reclaim condition — anything
  // the claim would retry must not be failed here.
  const cutoff = new Date(Date.now() - leaseMinutes * 60_000);
  const count = await prisma.$executeRaw`
    UPDATE "GenerationJob"
    SET status = 'failed',
        error = 'Worker stopped before this finished and it ran out of retries.',
        "finishedAt" = (NOW() AT TIME ZONE 'UTC'),
        "updatedAt" = (NOW() AT TIME ZONE 'UTC')
    WHERE status = 'running'
      AND "updatedAt" < ${cutoff}
      AND attempts >= "maxAttempts"
  `;
  if (count > 0) log.info("jobs.lease-expired.failed", { count });
  return count;
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
