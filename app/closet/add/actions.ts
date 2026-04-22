"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
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

/**
 * Save the uploaded file and run the stub services against it. Does NOT
 * create a WardrobeItem yet — the user confirms the pre-filled values and
 * then calls createItem().
 */
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

export type CreateItemInput = ItemFormValue & {
  originalImagePath: string;
  sourceData?: unknown;
};

export type CreateItemResponse = { ok: true; itemId: string } | { ok: false; error: string };

/**
 * Persist the user-confirmed item. Called after analyzeUpload.
 */
export async function createItem(input: CreateItemInput): Promise<CreateItemResponse> {
  const user = await requireUser();
  if (!input.originalImagePath.startsWith(`${user.id}/`)) {
    return { ok: false, error: "Image does not belong to this user" };
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
      isWishlist: input.isWishlist,
      notes: input.notes.trim() || null,
      sourceData: input.sourceData ? JSON.stringify(input.sourceData) : null,
    },
  });

  revalidatePath("/closet");
  return { ok: true, itemId: item.id };
}

/**
 * Called if the user abandons the flow after upload — frees the orphan file.
 */
export async function discardUpload(originalImagePath: string): Promise<void> {
  const user = await requireUser();
  if (!originalImagePath.startsWith(`${user.id}/`)) return;
  await deleteUpload(originalImagePath);
}
