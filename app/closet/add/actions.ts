"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { saveUpload, saveCutout, deleteUpload, UploadError } from "@/lib/uploads";
import { encode } from "@/lib/json";
import { runPrefill, type PrefillBundle } from "@/lib/prefill";
import { generateGhostFor } from "@/lib/actions/ghost-mannequin";
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

export type SaveCutoutResponse =
  | { ok: true; cutoutImagePath: string }
  | { ok: false; error: string };

/**
 * Persist a transparent-background cutout PNG produced client-side by
 * @imgly/background-removal. The user is identified by cookie; the resulting
 * file lands under uploads/{userId}/.
 */
export async function saveCutoutFromClient(formData: FormData): Promise<SaveCutoutResponse> {
  const user = await requireUser();
  const file = formData.get("cutout");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "No cutout provided" };
  }
  try {
    const saved = await saveCutout(file, user.id);
    return { ok: true, cutoutImagePath: saved.originalImagePath };
  } catch (err) {
    if (err instanceof UploadError) return { ok: false, error: err.message };
    throw err;
  }
}

export type CreateItemInput = ItemFormValue & {
  originalImagePath: string;
  cutoutImagePath?: string | null;
  generateGhost?: boolean;
  sourceData?: unknown;
};

export type CreateItemResponse =
  | { ok: true; itemId: string; ghostGenerated: boolean; ghostError?: string }
  | { ok: false; error: string };

/**
 * Persist the user-confirmed item. Optionally fires off the ghost-mannequin
 * generation as well — failures there don't block the save (the item still
 * exists and the user can retry from the detail page).
 */
export async function createItem(input: CreateItemInput): Promise<CreateItemResponse> {
  const user = await requireUser();
  if (!input.originalImagePath.startsWith(`${user.id}/`)) {
    return { ok: false, error: "Image does not belong to this user" };
  }
  if (input.cutoutImagePath && !input.cutoutImagePath.startsWith(`${user.id}/`)) {
    return { ok: false, error: "Cutout does not belong to this user" };
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
      retailer: input.retailer.trim() || null,
      productUrl: input.productUrl.trim() || null,
      material: input.material.trim() || null,
      pattern: input.pattern.trim() || null,
      styleTags: encode(input.styleTags),
      season: encode(input.season),
      originalImagePath: input.originalImagePath,
      cutoutImagePath: input.cutoutImagePath ?? null,
      isWishlist: input.isWishlist,
      notes: input.notes.trim() || null,
      sourceData: input.sourceData ? JSON.stringify(input.sourceData) : null,
    },
  });

  let ghostGenerated = false;
  let ghostError: string | undefined;
  if (input.generateGhost) {
    const res = await generateGhostFor(item.id);
    if (res.ok) ghostGenerated = true;
    else ghostError = res.error;
  }

  revalidatePath("/closet");
  return { ok: true, itemId: item.id, ghostGenerated, ghostError };
}

export async function discardUpload(originalImagePath: string): Promise<void> {
  const user = await requireUser();
  if (!originalImagePath.startsWith(`${user.id}/`)) return;
  await deleteUpload(originalImagePath);
}
