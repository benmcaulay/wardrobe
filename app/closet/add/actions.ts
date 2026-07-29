"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { saveUpload, saveImageBuffer, deleteUpload, UploadError } from "@/lib/uploads";
import { encode, parseStylePrefs } from "@/lib/json";
import { getPrimaryOwnerId, resolveItemOwnerIds } from "@/lib/owners";
import { NONE_CATEGORY } from "@/lib/categories";
import { productMatchToFormPatch, productMatchToPrefill, resolveProductMetadata } from "@/lib/product-match";
import { runPrefill, type PrefillBundle } from "@/lib/prefill";
import type { ProductMatch } from "@/lib/services/reverseImageSearch";
import { searchWebProducts } from "@/lib/services/webProductSearch";
import type { ItemFormValue } from "@/lib/types";

export type AnalyzeUploadResponse =
  | { ok: false; error: string }
  | {
      ok: true;
      originalImagePath: string;
      thumbnailImagePath: string;
      bundle: PrefillBundle;
    };

export type SearchWebProductsResponse =
  | { ok: true; matches: ProductMatch[] }
  | { ok: false; error: string };

export async function searchWebProductsAction(query: string): Promise<SearchWebProductsResponse> {
  await requireUser();
  const q = query.trim();
  if (!q) return { ok: false, error: "Enter a search term" };
  try {
    const matches = await searchWebProducts(q);
    return { ok: true, matches };
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? "Search failed" };
  }
}

export type ApplyProductMatchResponse =
  | { ok: true; patch: Partial<ItemFormValue> }
  | { ok: false; error: string };

/** Enrich listing via SerpAPI Immersive Product (or merchant scrape) and return form fields. */
export async function applyProductMatchAction(
  match: ProductMatch,
): Promise<ApplyProductMatchResponse> {
  await requireUser();
  try {
    const enriched = await resolveProductMetadata(match);
    const patch = productMatchToFormPatch(match, enriched);
    const { retailer: _r, productUrl: _u, ...formPatch } = patch;
    return { ok: true, patch: formPatch };
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? "Could not load product" };
  }
}

export type BeginFromWebProductResponse =
  | {
      ok: true;
      originalImagePath: string;
      thumbnailImagePath: string;
      bundle: PrefillBundle;
      patch: Partial<ItemFormValue>;
    }
  | { ok: false; error: string };

/**
 * Import a web listing's thumbnail as the garment photo and pre-fill the form.
 * Lets users start from search instead of requiring their own photo first.
 */
export async function beginFromWebProduct(match: ProductMatch): Promise<BeginFromWebProductResponse> {
  const user = await requireUser();
  const thumb = match.thumbnailUrl?.trim();
  if (!thumb) {
    return { ok: false, error: "This listing has no product photo to import." };
  }

  try {
    const res = await fetch(thumb, {
      headers: { "User-Agent": "Wardrobe/1.0 (+https://github.com/benmcaulay/wardrobe)" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      return { ok: false, error: "Could not download the product photo." };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const saved = await saveImageBuffer(buf, user.id);

    let enriched = null;
    try {
      enriched = await resolveProductMetadata(match);
    } catch {
      /* enrichment is best-effort; shopping title + parsed brand still apply */
    }

    const prefill = { ...productMatchToPrefill(match, enriched), category: NONE_CATEGORY };
    const patch = productMatchToFormPatch(match, enriched);
    const { retailer: _r, productUrl: _u, ...formPatch } = patch;

    return {
      ok: true,
      originalImagePath: saved.originalImagePath,
      thumbnailImagePath: saved.thumbnailImagePath,
      bundle: {
        prefill,
        matches: [match],
        sourceData: { matches: [match], scraped: enriched },
      },
      patch: formPatch,
    };
  } catch (err) {
    if (err instanceof UploadError) return { ok: false, error: err.message };
    return { ok: false, error: (err as Error).message ?? "Could not import listing" };
  }
}

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

export type GhostViewInput = {
  label: string;
  imagePath: string;
  creditsUsed: number;
  mirror?: boolean;
  thumbZoom?: number;
};

export type CreateItemInput = ItemFormValue & {
  originalImagePath: string;
  ghostImagePath?: string | null;
  /** All generated ghost views (first one matches ghostImagePath). */
  ghostViews?: GhostViewInput[];
  /** Already-uploaded extra context-image paths. */
  extraImagePaths?: string[];
  sourceData?: unknown;
};

export type CreateItemResponse =
  | { ok: true; itemId: string }
  | { ok: false; error: string };

/**
 * Persist the user-confirmed item, including any pre-generated ghost
 * mannequin views and extra context images. Credits for the ghosts were
 * already decremented by previewGhostMannequin; this just logs the
 * TryOnGeneration rows so history is complete.
 */
export async function createItem(input: CreateItemInput): Promise<CreateItemResponse> {
  const user = await requireUser();
  if (!input.originalImagePath.startsWith(`${user.id}/`)) {
    return { ok: false, error: "Image does not belong to this user" };
  }
  if (input.ghostImagePath && !input.ghostImagePath.startsWith(`${user.id}/`)) {
    return { ok: false, error: "Ghost does not belong to this user" };
  }
  for (const view of input.ghostViews ?? []) {
    if (!view.imagePath.startsWith(`${user.id}/`)) {
      return { ok: false, error: "Ghost view does not belong to this user" };
    }
  }
  for (const extra of input.extraImagePaths ?? []) {
    if (!extra.startsWith(`${user.id}/`)) {
      return { ok: false, error: "Extra image does not belong to this user" };
    }
  }
  if (!input.name.trim()) return { ok: false, error: "Name is required" };

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { stylePrefs: true },
  });
  const primaryOwnerId = getPrimaryOwnerId(parseStylePrefs(dbUser?.stylePrefs));
  const owners = resolveItemOwnerIds(input.owners ?? [], primaryOwnerId);

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
      owners: encode(owners),
      originalImagePath: input.originalImagePath,
      ghostImagePath: input.ghostImagePath ?? null,
      ghostViews: input.ghostViews?.length
        ? encode(
            input.ghostViews.map(({ label, imagePath, mirror, thumbZoom }) => ({
              label,
              imagePath,
              mirror: !!mirror,
              thumbZoom: typeof thumbZoom === "number" ? thumbZoom : 1,
            })),
          )
        : null,
      extraImagePaths: input.extraImagePaths?.length ? encode(input.extraImagePaths) : null,
      isWishlist: input.isWishlist,
      notes: input.notes.trim() || null,
      sourceData: input.sourceData ? JSON.stringify(input.sourceData) : null,
    },
  });

  if (input.ghostViews?.length) {
    await prisma.tryOnGeneration.createMany({
      data: input.ghostViews.map((v) => ({
        userId: user.id,
        itemId: item.id,
        resultImagePath: v.imagePath,
        creditsUsed: v.creditsUsed,
      })),
    });
  } else if (input.ghostImagePath) {
    await prisma.tryOnGeneration.create({
      data: {
        userId: user.id,
        itemId: item.id,
        resultImagePath: input.ghostImagePath,
        creditsUsed: 1,
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
