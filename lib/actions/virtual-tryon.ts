"use server";

import { revalidatePath } from "next/cache";
import { checkAiQuota } from "@/lib/ai-guardrails";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { encode } from "@/lib/json";
import { saveUpload, deleteUpload, UploadError } from "@/lib/uploads";
import { virtualTryOnUsesAppCredits } from "@/lib/services/virtualTryOn";
import { enqueueJob, getJobForUser, type VirtualTryOnJobResult } from "@/lib/jobs/queue";

const REAL_VTON = process.env.USE_REAL_VIRTUAL_TRYON === "true";
const MAX_PERSON_PHOTOS = 5;

export type UploadPersonPhotoResponse =
  | { ok: true; id: string; imagePath: string }
  | { ok: false; error: string };

/**
 * Save a person reference photo. The caller is responsible for limiting how
 * many they upload, but we hard-cap at MAX_PERSON_PHOTOS so a user can't keep
 * appending past a sensible cap.
 */
export async function uploadPersonPhoto(
  formData: FormData,
): Promise<UploadPersonPhotoResponse> {
  const user = await requireUser();
  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "No file provided" };
  }

  const existingCount = await prisma.personPhoto.count({ where: { userId: user.id } });
  if (existingCount >= MAX_PERSON_PHOTOS) {
    return {
      ok: false,
      error: `You can keep up to ${MAX_PERSON_PHOTOS} photos. Delete one first.`,
    };
  }

  let saved;
  try {
    saved = await saveUpload(file, user.id);
  } catch (err) {
    if (err instanceof UploadError) return { ok: false, error: err.message };
    throw err;
  }

  const label = (formData.get("label") as string | null)?.trim() || null;
  const created = await prisma.personPhoto.create({
    data: {
      userId: user.id,
      imagePath: saved.originalImagePath,
      label,
    },
  });

  revalidatePath("/closet/try-on");
  return { ok: true, id: created.id, imagePath: created.imagePath };
}

export type DeletePersonPhotoResponse =
  | { ok: true }
  | { ok: false; error: string };

export async function deletePersonPhoto(
  photoId: string,
): Promise<DeletePersonPhotoResponse> {
  const user = await requireUser();
  const photo = await prisma.personPhoto.findUnique({ where: { id: photoId } });
  if (!photo || photo.userId !== user.id) {
    return { ok: false, error: "Photo not found" };
  }
  await prisma.personPhoto.delete({ where: { id: photoId } });
  await deleteUpload(photo.imagePath);
  revalidatePath("/closet/try-on");
  return { ok: true };
}

export type GenerateTryOnInput = {
  personPhotoId: string;
  itemIds: string[];
  outfitId?: string | null;
  prompt?: string;
};

export type EnqueueTryOnResponse =
  | { ok: true; jobId: string }
  | { ok: false; error: string };

/**
 * Validate the request fast (ownership, credits, quota) and enqueue a
 * background job — generation itself (esp. multi-garment chains) is too slow to
 * run inside the request on serverless. The client polls getTryOnJobStatus.
 * A worker (scripts/worker.ts) runs the job and decrements credits atomically
 * with the VirtualTryOn row insert; failures don't charge.
 */
export async function enqueueVirtualTryOn(
  input: GenerateTryOnInput,
): Promise<EnqueueTryOnResponse> {
  const user = await requireUser();

  if (input.itemIds.length === 0) {
    return { ok: false, error: "Select at least one garment or a saved outfit." };
  }

  const [person, itemCount, dbUser] = await Promise.all([
    prisma.personPhoto.findUnique({ where: { id: input.personPhotoId } }),
    prisma.wardrobeItem.count({ where: { id: { in: input.itemIds }, userId: user.id } }),
    prisma.user.findUnique({ where: { id: user.id }, select: { credits: true } }),
  ]);

  if (!person || person.userId !== user.id) {
    return { ok: false, error: "Person photo not found" };
  }
  if (itemCount !== new Set(input.itemIds).size) {
    return { ok: false, error: "One or more selected items could not be found." };
  }
  if (REAL_VTON && virtualTryOnUsesAppCredits() && (dbUser?.credits ?? 0) < 1) {
    return { ok: false, error: "Out of credits" };
  }
  const quota = await checkAiQuota(user.id);
  if (!quota.ok) return quota;

  if (input.outfitId) {
    const outfit = await prisma.outfit.findUnique({ where: { id: input.outfitId } });
    if (!outfit || outfit.userId !== user.id) {
      return { ok: false, error: "Outfit not found" };
    }
  }

  const jobId = await enqueueJob(user.id, "virtual_tryon", {
    personPhotoId: input.personPhotoId,
    itemIds: input.itemIds,
    outfitId: input.outfitId ?? null,
    prompt: input.prompt,
  });
  return { ok: true, jobId };
}

export type TryOnJobStatusResponse =
  | { ok: true; status: "queued" | "running" }
  | {
      ok: true;
      status: "succeeded";
      tryOnId: string;
      resultImagePath: string;
      creditsRemaining: number;
      creditsUsed: number;
    }
  | { ok: false; error: string };

/** Poll a try-on job. On success revalidates the page so history refreshes. */
export async function getTryOnJobStatus(jobId: string): Promise<TryOnJobStatusResponse> {
  const user = await requireUser();
  const job = await getJobForUser<VirtualTryOnJobResult>(jobId, user.id);
  if (!job) return { ok: false, error: "Job not found" };

  if (job.status === "failed") {
    return { ok: false, error: job.error ?? "Generation failed" };
  }
  if (job.status === "succeeded" && job.result) {
    revalidatePath("/closet/try-on");
    return {
      ok: true,
      status: "succeeded",
      tryOnId: job.result.tryOnId,
      resultImagePath: job.result.resultImagePath,
      creditsRemaining: job.result.creditsRemaining,
      creditsUsed: job.result.creditsUsed,
    };
  }
  return { ok: true, status: job.status === "running" ? "running" : "queued" };
}

export type SaveOutfitResponse =
  | { ok: true; id: string }
  | { ok: false; error: string };

export async function saveOutfit(
  name: string,
  itemIds: string[],
): Promise<SaveOutfitResponse> {
  const user = await requireUser();
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Outfit name is required" };
  if (itemIds.length === 0) return { ok: false, error: "Pick at least one item" };

  const owned = await prisma.wardrobeItem.count({
    where: { id: { in: itemIds }, userId: user.id },
  });
  if (owned !== itemIds.length) {
    return { ok: false, error: "One or more items don't belong to you." };
  }

  const created = await prisma.outfit.create({
    data: {
      userId: user.id,
      name: trimmed,
      itemIds: encode(itemIds),
    },
  });
  revalidatePath("/closet/try-on");
  return { ok: true, id: created.id };
}

export type DeleteTryOnResponse = { ok: true } | { ok: false; error: string };

/**
 * Remove a generated try-on and its image files.
 *
 * The credit it cost is not refunded — the generation really happened. This
 * only clears the result from the "Recent try-ons" strip.
 */
export async function deleteVirtualTryOn(id: string): Promise<DeleteTryOnResponse> {
  const user = await requireUser();
  const tryOn = await prisma.virtualTryOn.findUnique({ where: { id } });
  if (!tryOn || tryOn.userId !== user.id) {
    return { ok: false, error: "Try-on not found" };
  }
  await prisma.virtualTryOn.delete({ where: { id } });
  // Best-effort: a missing file shouldn't leave an undeletable row behind.
  await deleteUpload(tryOn.resultImagePath).catch(() => {});
  revalidatePath("/closet/try-on");
  return { ok: true };
}

export type DeleteOutfitResponse = { ok: true } | { ok: false; error: string };

export async function deleteOutfit(id: string): Promise<DeleteOutfitResponse> {
  const user = await requireUser();
  const outfit = await prisma.outfit.findUnique({ where: { id } });
  if (!outfit || outfit.userId !== user.id) {
    return { ok: false, error: "Outfit not found" };
  }
  await prisma.outfit.delete({ where: { id } });
  revalidatePath("/closet/try-on");
  return { ok: true };
}
