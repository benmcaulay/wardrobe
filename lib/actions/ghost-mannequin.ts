"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { cutoutPathFor } from "@/lib/image-paths";
import { encode } from "@/lib/json";
import { deleteUpload, saveUpload, UploadError } from "@/lib/uploads";
import { deleteObject } from "@/lib/storage";
import { checkAiQuota } from "@/lib/ai-guardrails";
import { log } from "@/lib/log";
import {
  createGhostMannequin,
  mapCategoryToGhost,
  type GhostMannequinResult,
} from "@/lib/services/ghostMannequin";
import {
  enqueueJob,
  findPendingGhostViewJobForItem,
  getJobForUser,
  parsePayload,
  type GhostPreviewJobPayload,
  type GhostPreviewJobResult,
  type GhostViewJobPayload,
  type GhostViewJobResult,
} from "@/lib/jobs/queue";
import { kickJobDrain } from "@/lib/jobs/kick-drain";
import {
  runPreviewGhostMannequin,
  runGenerateGhostViewFor,
  type PreviewGhostInput,
  type PreviewGhostResponse,
  type GenerateGhostViewResponse,
  type CompositionHint,
} from "@/lib/server/ghost-mannequin-runs";

export type {
  PreviewGhostInput,
  PreviewGhostResponse,
  GenerateGhostViewResponse,
  CompositionHint,
} from "@/lib/server/ghost-mannequin-runs";

const REAL_GHOST = process.env.USE_REAL_GHOST_MANNEQUIN === "true";

export type GenerateGhostResponse =
  | { ok: true; ghostImagePath: string; creditsRemaining: number }
  | { ok: false; error: string };

/**
 * Generate (or regenerate) the ghost mannequin for an item that's already
 * persisted. Updates item.ghostImagePath, logs a TryOnGeneration row, and (in
 * real mode) decrements User.credits — all in one transaction. Errors from
 * the provider are caught and returned as { ok: false } so the UI can show
 * them without a 500.
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
  const quota = await checkAiQuota(user.id);
  if (!quota.ok) return quota;

  const sourcePath = item.originalImagePath;
  let extras: string[] = [];
  try {
    if (item.extraImagePaths) extras = JSON.parse(item.extraImagePaths) as string[];
  } catch {
    // ignore — bad JSON shouldn't block generation
  }

  let result: GhostMannequinResult;
  try {
    result = await createGhostMannequin({
      userId: user.id,
      garmentImagePath: sourcePath,
      extraImagePaths: extras,
      category: mapCategoryToGhost(item.category),
    });
  } catch (err) {
    log.error("ghost.generate.failed", err, { userId: user.id, itemId });
    return { ok: false, error: (err as Error).message ?? "Generation failed" };
  }

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

/**
 * Generate an additional ghost-mannequin view for an existing saved item,
 * using a caller-specified subset of the item's images. The new view is
 * appended to item.ghostViews; item.ghostImagePath is set only when this is
 * the very first ghost for the item.
 */
export async function generateGhostViewFor(
  itemId: string,
  selectedExtraPaths: string[],
  label: string,
  instructions?: string,
  primaryGarmentPath?: string | null,
  compositionHint?: CompositionHint,
): Promise<GenerateGhostViewResponse> {
  const user = await requireUser();
  const out = await runGenerateGhostViewFor(
    user,
    itemId,
    selectedExtraPaths,
    label,
    instructions,
    primaryGarmentPath,
    compositionHint,
  );
  if (out.ok) {
    revalidatePath("/closet");
    revalidatePath(`/closet/${itemId}`);
  }
  return out;
}

export type GhostViewStyle = { mirror?: boolean; thumbZoom?: number };

export async function setPrimaryThumbnailFor(
  itemId: string,
  imagePath: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  const item = await prisma.wardrobeItem.findUnique({ where: { id: itemId } });
  if (!item || item.userId !== user.id) return { ok: false, error: "Item not found" };

  if (imagePath === null) {
    await prisma.wardrobeItem.update({
      where: { id: itemId },
      data: { ghostImagePath: null },
    });
    revalidatePath("/closet");
    revalidatePath(`/closet/${itemId}`);
    return { ok: true };
  }

  let views: Array<{ label: string; imagePath: string; mirror?: boolean; thumbZoom?: number }> = [];
  try {
    if (item.ghostViews) views = JSON.parse(item.ghostViews) as typeof views;
  } catch {
    return { ok: false, error: "Corrupt ghost views data" };
  }
  if (!views.some((v) => v.imagePath === imagePath)) {
    return { ok: false, error: "View not found" };
  }
  await prisma.wardrobeItem.update({
    where: { id: itemId },
    data: { ghostImagePath: imagePath },
  });
  revalidatePath("/closet");
  revalidatePath(`/closet/${itemId}`);
  return { ok: true };
}

/** @deprecated Use setPrimaryThumbnailFor — kept as alias for ghost-only callers */
export async function setPrimaryGhostViewFor(
  itemId: string,
  imagePath: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return setPrimaryThumbnailFor(itemId, imagePath);
}

export async function updateGhostViewStyleFor(
  itemId: string,
  imagePath: string,
  style: GhostViewStyle,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  const item = await prisma.wardrobeItem.findUnique({ where: { id: itemId } });
  if (!item || item.userId !== user.id) return { ok: false, error: "Item not found" };
  let views: Array<{ label: string; imagePath: string; mirror?: boolean; thumbZoom?: number }> = [];
  try {
    if (item.ghostViews) views = JSON.parse(item.ghostViews) as typeof views;
  } catch {
    return { ok: false, error: "Corrupt ghost views data" };
  }
  const idx = views.findIndex((v) => v.imagePath === imagePath);
  if (idx < 0) return { ok: false, error: "View not found" };
  const prev = views[idx]!;
  views[idx] = {
    ...prev,
    mirror: style.mirror !== undefined ? !!style.mirror : !!prev.mirror,
    thumbZoom:
      style.thumbZoom !== undefined
        ? typeof style.thumbZoom === "number"
          ? style.thumbZoom
          : 1
        : typeof prev.thumbZoom === "number"
          ? prev.thumbZoom
          : 1,
  };
  await prisma.wardrobeItem.update({
    where: { id: itemId },
    data: { ghostViews: encode(views) },
  });
  revalidatePath("/closet");
  revalidatePath(`/closet/${itemId}`);
  return { ok: true };
}

/** Persist zoom/mirror framing for the item's original photo (no ghost involved). */
export async function updateOriginalStyleFor(
  itemId: string,
  style: GhostViewStyle,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  const item = await prisma.wardrobeItem.findUnique({ where: { id: itemId } });
  if (!item || item.userId !== user.id) return { ok: false, error: "Item not found" };
  const data: { originalMirror?: boolean; originalThumbZoom?: number } = {};
  if (style.mirror !== undefined) data.originalMirror = !!style.mirror;
  if (style.thumbZoom !== undefined) {
    data.originalThumbZoom = typeof style.thumbZoom === "number" ? style.thumbZoom : 1;
  }
  if (Object.keys(data).length > 0) {
    await prisma.wardrobeItem.update({ where: { id: itemId }, data });
    revalidatePath("/closet");
    revalidatePath(`/closet/${itemId}`);
  }
  return { ok: true };
}

export type ReplaceOriginalImageResponse =
  | { ok: true; imagePath: string }
  | { ok: false; error: string };

/**
 * Replace an item's original photo with a client-edited version (e.g. after
 * the paint-bucket "whiten background" tool). Saves the new upload, repoints
 * `originalImagePath`, and best-effort deletes the previous original + thumb.
 */
export async function replaceOriginalImageWithEdit(
  itemId: string,
  formData: FormData,
): Promise<ReplaceOriginalImageResponse> {
  const user = await requireUser();
  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "No file provided" };
  }

  const item = await prisma.wardrobeItem.findUnique({ where: { id: itemId } });
  if (!item || item.userId !== user.id) return { ok: false, error: "Item not found" };

  const previousPath = item.originalImagePath;

  let saved;
  try {
    saved = await saveUpload(file, user.id);
  } catch (err) {
    if (err instanceof UploadError) return { ok: false, error: err.message };
    throw err;
  }

  await prisma.wardrobeItem.update({
    where: { id: itemId },
    data: { originalImagePath: saved.originalImagePath },
  });

  if (previousPath && previousPath !== saved.originalImagePath) {
    await deleteUpload(previousPath).catch(() => undefined);
  }

  revalidatePath("/closet");
  revalidatePath(`/closet/${itemId}`);
  return { ok: true, imagePath: saved.originalImagePath };
}

export type ReplaceGhostViewCropResponse =
  | { ok: true; imagePath: string }
  | { ok: false; error: string };

/**
 * Replace one ghost-view JPEG with a user-cropped image (same UX as add-flow
 * ImageCropper). Deletes the previous file, its thumbnail, and a sibling
 * cutout PNG when present.
 */
export async function replaceGhostViewImageWithCrop(
  itemId: string,
  previousImagePath: string,
  formData: FormData,
): Promise<ReplaceGhostViewCropResponse> {
  const user = await requireUser();
  if (!previousImagePath.startsWith(`${user.id}/`)) {
    return { ok: false, error: "Image does not belong to this user" };
  }
  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "No file provided" };
  }

  const item = await prisma.wardrobeItem.findUnique({ where: { id: itemId } });
  if (!item || item.userId !== user.id) return { ok: false, error: "Item not found" };

  let views: Array<{ label: string; imagePath: string; mirror?: boolean; thumbZoom?: number }> = [];
  try {
    if (item.ghostViews) views = JSON.parse(item.ghostViews) as typeof views;
  } catch {
    return { ok: false, error: "Corrupt ghost views data" };
  }
  const idx = views.findIndex((v) => v.imagePath === previousImagePath);
  if (idx < 0) return { ok: false, error: "View not found" };

  let saved;
  try {
    saved = await saveUpload(file, user.id);
  } catch (err) {
    if (err instanceof UploadError) return { ok: false, error: err.message };
    throw err;
  }

  const prev = views[idx]!;
  views[idx] = {
    label: prev.label,
    imagePath: saved.originalImagePath,
    mirror: !!prev.mirror,
    thumbZoom: typeof prev.thumbZoom === "number" ? prev.thumbZoom : 1,
  };

  const nextPrimary =
    item.ghostImagePath === previousImagePath ? saved.originalImagePath : item.ghostImagePath;

  await prisma.wardrobeItem.update({
    where: { id: itemId },
    data: {
      ghostViews: encode(views),
      ghostImagePath: nextPrimary,
    },
  });

  await deleteUpload(previousImagePath).catch(() => undefined);
  await deleteObject(cutoutPathFor(previousImagePath)).catch(() => undefined);

  revalidatePath("/closet");
  revalidatePath(`/closet/${itemId}`);
  return { ok: true, imagePath: saved.originalImagePath };
}

export async function deleteGhostViewFor(
  itemId: string,
  imagePath: string,
): Promise<{ ok: true; nextPrimary: string | null } | { ok: false; error: string }> {
  const user = await requireUser();
  const item = await prisma.wardrobeItem.findUnique({ where: { id: itemId } });
  if (!item || item.userId !== user.id) return { ok: false, error: "Item not found" };
  let views: Array<{ label: string; imagePath: string; mirror?: boolean; thumbZoom?: number }> = [];
  try {
    if (item.ghostViews) views = JSON.parse(item.ghostViews) as typeof views;
  } catch {
    return { ok: false, error: "Corrupt ghost views data" };
  }
  const remaining = views.filter((v) => v.imagePath !== imagePath);
  if (remaining.length === views.length) return { ok: false, error: "View not found" };
  const nextPrimary = item.ghostImagePath === imagePath ? (remaining[0]?.imagePath ?? null) : item.ghostImagePath;

  await prisma.wardrobeItem.update({
    where: { id: itemId },
    data: {
      ghostViews: remaining.length ? encode(remaining) : null,
      ghostImagePath: nextPrimary,
    },
  });
  await deleteUpload(imagePath).catch(() => undefined);
  revalidatePath("/closet");
  revalidatePath(`/closet/${itemId}`);
  return { ok: true, nextPrimary };
}

export type AddExtraSourceImageResponse =
  | { ok: true; imagePath: string }
  | { ok: false; error: string };

export async function addExtraSourceImageFor(
  itemId: string,
  formData: FormData,
): Promise<AddExtraSourceImageResponse> {
  const user = await requireUser();
  const item = await prisma.wardrobeItem.findUnique({ where: { id: itemId } });
  if (!item || item.userId !== user.id) return { ok: false, error: "Item not found" };

  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "No file provided" };
  }

  let saved;
  try {
    saved = await saveUpload(file, user.id);
  } catch (err) {
    if (err instanceof UploadError) return { ok: false, error: err.message };
    throw err;
  }

  let extras: string[] = [];
  try {
    if (item.extraImagePaths) extras = JSON.parse(item.extraImagePaths) as string[];
  } catch {
    // ignore corrupt JSON and rebuild from the new upload
  }
  if (!extras.includes(saved.originalImagePath)) extras.push(saved.originalImagePath);

  await prisma.wardrobeItem.update({
    where: { id: itemId },
    data: { extraImagePaths: encode(extras) },
  });

  revalidatePath(`/closet/${itemId}`);
  return { ok: true, imagePath: saved.originalImagePath };
}

/**
 * Generate a ghost-mannequin preview during the /closet/add flow — before any
 * WardrobeItem exists. Decrements credits in real mode (the API call already
 * cost real money) but does NOT log a TryOnGeneration row; that happens at
 * createItem time when we know the item id.
 */
export async function previewGhostMannequin(
  input: PreviewGhostInput,
): Promise<PreviewGhostResponse> {
  const user = await requireUser();
  return runPreviewGhostMannequin(user, input);
}

export type EnqueueGhostJobResponse = { ok: true; jobId: string } | { ok: false; error: string };

export type GhostJobStatusResponse =
  | { ok: true; status: "queued" | "running" }
  | {
      ok: true;
      status: "succeeded";
      ghostImagePath: string;
      creditsRemaining: number;
      creditsUsed?: number;
      viewLabel?: string;
    }
  | { ok: false; error: string };

export type PendingGhostViewJobResponse =
  | { ok: true; jobId: string | null }
  | { ok: false; error: string };

/**
 * Enqueue ghost generation for a saved item. Returns immediately; a worker (or
 * inline drain) runs the fal call so navigation doesn't abort the job.
 */
export async function enqueueGhostViewFor(
  itemId: string,
  selectedExtraPaths: string[],
  label: string,
  instructions?: string,
  primaryGarmentPath?: string | null,
  compositionHint?: CompositionHint,
): Promise<EnqueueGhostJobResponse> {
  const user = await requireUser();
  const item = await prisma.wardrobeItem.findUnique({ where: { id: itemId } });
  if (!item || item.userId !== user.id) return { ok: false, error: "Item not found" };

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { credits: true },
  });
  if (REAL_GHOST && (dbUser?.credits ?? 0) < 1) {
    return { ok: false, error: "Out of credits" };
  }
  const quota = await checkAiQuota(user.id);
  if (!quota.ok) return quota;

  const payload: GhostViewJobPayload = {
    itemId,
    selectedExtraPaths,
    label,
    instructions,
    primaryGarmentPath,
    compositionHint,
  };
  const jobId = await enqueueJob(user.id, "ghost_view", payload);
  kickJobDrain();
  return { ok: true, jobId };
}

/** Enqueue a pre-save ghost preview (add flow). */
export async function enqueueGhostPreview(
  input: PreviewGhostInput,
): Promise<EnqueueGhostJobResponse> {
  const user = await requireUser();
  if (!input.garmentImagePath.startsWith(`${user.id}/`)) {
    return { ok: false, error: "Image does not belong to this user" };
  }
  for (const extra of input.extraImagePaths ?? []) {
    if (!extra.startsWith(`${user.id}/`)) {
      return { ok: false, error: "Extra image does not belong to this user" };
    }
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { credits: true },
  });
  if (REAL_GHOST && (dbUser?.credits ?? 0) < 1) {
    return { ok: false, error: "Out of credits" };
  }
  const quota = await checkAiQuota(user.id);
  if (!quota.ok) return quota;

  const payload: GhostPreviewJobPayload = {
    garmentImagePath: input.garmentImagePath,
    extraImagePaths: input.extraImagePaths,
    primaryGarmentPathOverride: input.primaryGarmentPathOverride,
    category: input.category,
    instructions: input.instructions,
    compositionHint: input.compositionHint,
  };
  const jobId = await enqueueJob(user.id, "ghost_preview", payload);
  kickJobDrain();
  return { ok: true, jobId };
}

/** Poll a ghost job (view or preview). */
export async function getGhostJobStatus(jobId: string): Promise<GhostJobStatusResponse> {
  const user = await requireUser();
  const job = await getJobForUser<GhostViewJobResult | GhostPreviewJobResult>(jobId, user.id);
  if (!job) return { ok: false, error: "Job not found" };

  if (job.status === "failed") {
    return { ok: false, error: job.error ?? "Generation failed" };
  }
  if (job.status === "succeeded" && job.result) {
    if (job.type === "ghost_view") {
      const view = job.result as GhostViewJobResult;
      const full = await prisma.generationJob.findUnique({ where: { id: jobId } });
      if (full) {
        const { itemId } = parsePayload<GhostViewJobPayload>(full);
        revalidatePath("/closet");
        revalidatePath(`/closet/${itemId}`);
      }
      return {
        ok: true,
        status: "succeeded",
        ghostImagePath: view.ghostImagePath,
        creditsRemaining: view.creditsRemaining,
        viewLabel: view.viewLabel,
      };
    }
    const preview = job.result as GhostPreviewJobResult;
    return {
      ok: true,
      status: "succeeded",
      ghostImagePath: preview.ghostImagePath,
      creditsRemaining: preview.creditsRemaining,
      creditsUsed: preview.creditsUsed,
    };
  }
  return { ok: true, status: job.status === "running" ? "running" : "queued" };
}

/** Resume polling after navigating back to an item detail page. */
export async function getPendingGhostViewJobForItem(
  itemId: string,
): Promise<PendingGhostViewJobResponse> {
  const user = await requireUser();
  const jobId = await findPendingGhostViewJobForItem(user.id, itemId);
  return { ok: true, jobId };
}
