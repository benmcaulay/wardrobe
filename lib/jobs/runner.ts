/**
 * Job executor. Dispatches a claimed job to its generator and persists the
 * outcome. This is the single place try-on generation actually happens (worker
 * and any inline caller share it), so credit accounting lives here exactly once.
 */
import type { GenerationJob } from "@prisma/client";
import { prisma } from "../db";
import { encode } from "../json";
import { log } from "../log";
import {
  createVirtualTryOn,
  virtualTryOnUsesAppCredits,
  type VirtualTryOnResult,
} from "../services/virtualTryOn";
import {
  markJobSucceeded,
  markJobFailed,
  parsePayload,
  type VirtualTryOnJobPayload,
  type VirtualTryOnJobResult,
} from "./queue";

const REAL_VTON = process.env.USE_REAL_VIRTUAL_TRYON === "true";

/** A failure the caller should NOT retry (bad input, gone resource, no credits). */
class PermanentJobError extends Error {}

async function runVirtualTryOn(
  userId: string,
  payload: VirtualTryOnJobPayload,
): Promise<VirtualTryOnJobResult> {
  const [person, items, dbUser] = await Promise.all([
    prisma.personPhoto.findUnique({ where: { id: payload.personPhotoId } }),
    prisma.wardrobeItem.findMany({ where: { id: { in: payload.itemIds }, userId } }),
    prisma.user.findUnique({ where: { id: userId }, select: { credits: true } }),
  ]);

  if (!person || person.userId !== userId) throw new PermanentJobError("Person photo not found");
  if (items.length !== payload.itemIds.length) {
    throw new PermanentJobError("One or more selected items could not be found.");
  }
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const orderedItems = payload.itemIds
    .map((id) => itemsById.get(id))
    .filter((item): item is NonNullable<typeof item> => item != null);

  if (REAL_VTON && virtualTryOnUsesAppCredits() && (dbUser?.credits ?? 0) < 1) {
    throw new PermanentJobError("Out of credits");
  }
  if (payload.outfitId) {
    const outfit = await prisma.outfit.findUnique({ where: { id: payload.outfitId } });
    if (!outfit || outfit.userId !== userId) throw new PermanentJobError("Outfit not found");
  }

  const garmentPaths = orderedItems.map((item) => item.ghostImagePath ?? item.originalImagePath);
  const garmentCategories = orderedItems.map((item) =>
    [item.category, item.subcategory].filter(Boolean).join(" ").trim(),
  );
  const garmentDescriptions = orderedItems.map((item) =>
    [item.name, item.subcategory, item.category].filter(Boolean).join(" ").trim(),
  );

  let result: VirtualTryOnResult;
  try {
    result = await createVirtualTryOn({
      userId,
      personImagePath: person.imagePath,
      garmentImagePaths: garmentPaths,
      garmentCategories,
      garmentDescriptions,
      prompt: payload.prompt,
    });
  } catch (err) {
    // Provider/transient failures are retryable (not Permanent).
    throw err instanceof Error ? err : new Error(String(err));
  }

  const { tryOnId, creditsRemaining } = await prisma.$transaction(async (tx) => {
    const created = await tx.virtualTryOn.create({
      data: {
        userId,
        personPhotoId: person.id,
        outfitId: payload.outfitId ?? null,
        itemIds: encode(payload.itemIds),
        prompt: payload.prompt?.trim() || null,
        resultImagePath: result.resultImagePath,
        creditsUsed: result.credits,
      },
    });
    let remaining = dbUser?.credits ?? 0;
    if (REAL_VTON && result.credits > 0) {
      const updated = await tx.user.update({
        where: { id: userId },
        data: { credits: { decrement: result.credits } },
        select: { credits: true },
      });
      remaining = updated.credits;
    }
    return { tryOnId: created.id, creditsRemaining: remaining };
  });

  return {
    tryOnId,
    resultImagePath: result.resultImagePath,
    creditsRemaining,
    creditsUsed: result.credits,
  };
}

/**
 * Execute a claimed job. On success marks it succeeded; on failure either
 * re-queues for retry (transient) or marks it terminally failed (permanent or
 * out of attempts). Never throws — the worker loop keeps going.
 */
export async function runJob(job: GenerationJob): Promise<void> {
  try {
    if (job.type === "virtual_tryon") {
      const result = await runVirtualTryOn(job.userId, parsePayload(job));
      await markJobSucceeded(job.id, result);
      log.info("job.succeeded", { jobId: job.id, type: job.type, userId: job.userId });
      return;
    }
    throw new PermanentJobError(`Unknown job type: ${job.type}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const permanent = err instanceof PermanentJobError;
    // Permanent errors skip retry by exhausting attempts immediately.
    const effective = permanent ? { ...job, attempts: job.maxAttempts } : job;
    const willRetry = await markJobFailed(effective, message);
    log.error("job.failed", err, {
      jobId: job.id,
      type: job.type,
      userId: job.userId,
      attempt: job.attempts,
      willRetry,
      permanent,
    });
  }
}
