"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { saveUpload, deleteUpload, UploadError } from "@/lib/uploads";
import { encode } from "@/lib/json";
import { runPrefill, type PrefillBundle } from "@/lib/prefill";
import type { ItemFormValue } from "@/lib/types";

export type AnalyzeUploadResponse =
  | { ok: false; error: string }
  | {
      ok: true;
      originalImagePath: string;
      thumbnailImagePath: string;
      bundle: PrefillBundle;
    };

export async function analyzeUpload(formData: FormData): Promise<AnalyzeUploadResponse> {
  const user = await requireUser();
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

  const bundle = await runPrefill(saved.originalImagePath);
  return {
    ok: true,
    originalImagePath: saved.originalImagePath,
    thumbnailImagePath: saved.thumbnailImagePath,
    bundle,
  };
}

export type SaveExtraImageResponse =
  | { ok: true; imagePath: string }
  | { ok: false; error: string };

/**
 * Save an extra context image — uploaded raw (no cropping) so the model has
 * varied views (full-body, close-up, label) for accuracy.
 */
export async function saveExtraImage(formData: FormData): Promise<SaveExtraImageResponse> {
  const user = await requireUser();
  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "No file provided" };
  }
  try {
    const saved = await saveUpload(file, user.id);
    return { ok: true, imagePath: saved.originalImagePath };
  } catch (err) {
    if (err instanceof UploadError) return { ok: false, error: err.message };
    throw err;
  }
}

export type CreateItemInput = ItemFormValue & {
  originalImagePath: string;
  ghostImagePath?: string | null;
  /** Already-uploaded extra context-image paths. */
  extraImagePaths?: string[];
  /** Credits already debited by the preview action; logged on the item. */
  ghostCreditsUsed?: number;
  sourceData?: unknown;
};

export type CreateItemResponse =
  | { ok: true; itemId: string }
  | { ok: false; error: string };

/**
 * Persist the user-confirmed item, including any pre-generated ghost
 * mannequin and extra context images. Credits for the ghost were already
 * decremented by previewGhostMannequin; this just logs the TryOnGeneration
 * row so history is complete.
 */
export async function createItem(input: CreateItemInput): Promise<CreateItemResponse> {
  const user = await requireUser();
  if (!input.originalImagePath.startsWith(`${user.id}/`)) {
    return { ok: false, error: "Image does not belong to this user" };
  }
  if (input.ghostImagePath && !input.ghostImagePath.startsWith(`${user.id}/`)) {
    return { ok: false, error: "Ghost does not belong to this user" };
  }
  for (const extra of input.extraImagePaths ?? []) {
    if (!extra.startsWith(`${user.id}/`)) {
      return { ok: false, error: "Extra image does not belong to this user" };
    }
  }
  if (!input.name.trim()) return { ok: false, error: "Name is required" };

  const item = await prisma.wardrobeItem.create({
    data: {
      userId: user.id,
      name: input.name.trim(),
      brand: input.brand.trim() || null,
      category: input.category,
      subcategory: input.subcategory.trim() || null,
      colors: encode(input.colors),
      priceCents: input.priceCents,
      currency: input.currency || "USD",
      material: input.material.trim() || null,
      pattern: input.pattern.trim() || null,
      styleTags: encode(input.styleTags),
      season: encode(input.season),
      originalImagePath: input.originalImagePath,
      ghostImagePath: input.ghostImagePath ?? null,
      extraImagePaths: input.extraImagePaths?.length ? encode(input.extraImagePaths) : null,
      isWishlist: input.isWishlist,
      notes: input.notes.trim() || null,
      sourceData: input.sourceData ? JSON.stringify(input.sourceData) : null,
    },
  });

  if (input.ghostImagePath) {
    await prisma.tryOnGeneration.create({
      data: {
        userId: user.id,
        itemId: item.id,
        resultImagePath: input.ghostImagePath,
        creditsUsed: input.ghostCreditsUsed ?? 1,
      },
    });
  }

  revalidatePath("/closet");
  return { ok: true, itemId: item.id };
}

export async function discardUpload(originalImagePath: string): Promise<void> {
  const user = await requireUser();
  if (!originalImagePath.startsWith(`${user.id}/`)) return;
  await deleteUpload(originalImagePath);
}

export async function discardExtraImage(imagePath: string): Promise<void> {
  const user = await requireUser();
  if (!imagePath.startsWith(`${user.id}/`)) return;
  await deleteUpload(imagePath);
}
