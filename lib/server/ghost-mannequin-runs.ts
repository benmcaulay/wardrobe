import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { encode } from "@/lib/json";
import {
  createGhostMannequin,
  mapCategoryToGhost,
  type GhostMannequinCategory,
  type GhostMannequinResult,
} from "@/lib/services/ghostMannequin";

const REAL_GHOST = process.env.USE_REAL_GHOST_MANNEQUIN === "true";

export type CompositionHint = "default" | "rear";

export type PreviewGhostInput = {
  garmentImagePath: string;
  extraImagePaths?: string[];
  /** When set, this image becomes the model's first (primary) input; the listing photo is passed as context. */
  primaryGarmentPathOverride?: string | null;
  category: GhostMannequinCategory;
  instructions?: string;
  compositionHint?: CompositionHint;
};

/** Build fal stack: primary garment first, then other references (listing included when primary is an extra). */
export function resolveGhostModelInput(
  listingPath: string,
  extraImagePaths: string[] | undefined,
  primaryOverride: string | null | undefined,
): { garmentImagePath: string; extraImagePaths: string[] } {
  const extrasList = [...(extraImagePaths ?? [])];
  const primary =
    primaryOverride?.trim() && primaryOverride.trim() !== listingPath
      ? primaryOverride.trim()
      : listingPath;

  const allowed = new Set([listingPath, ...extrasList]);
  if (!allowed.has(primary)) {
    throw new Error(
      "Primary source must be the listing garment photo or one of the selected context images",
    );
  }

  const outExtras: string[] = [];
  for (const p of extrasList) {
    if (p !== primary) outExtras.push(p);
  }
  if (primary !== listingPath) outExtras.push(listingPath);

  return { garmentImagePath: primary, extraImagePaths: outExtras };
}

export type PreviewGhostResponse =
  | { ok: true; ghostImagePath: string; creditsRemaining: number; creditsUsed: number }
  | { ok: false; error: string };

export type GenerateGhostViewResponse =
  | { ok: true; ghostImagePath: string; creditsRemaining: number }
  | { ok: false; error: string };

export async function runPreviewGhostMannequin(
  user: Pick<User, "id">,
  input: PreviewGhostInput,
): Promise<PreviewGhostResponse> {
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

  let stack: { garmentImagePath: string; extraImagePaths: string[] };
  try {
    stack = resolveGhostModelInput(
      input.garmentImagePath,
      input.extraImagePaths,
      input.primaryGarmentPathOverride,
    );
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  let result: GhostMannequinResult;
  try {
    result = await createGhostMannequin({
      userId: user.id,
      garmentImagePath: stack.garmentImagePath,
      extraImagePaths: stack.extraImagePaths,
      category: input.category,
      instructions: input.instructions,
      compositionHint: input.compositionHint ?? "default",
    });
  } catch (err) {
    console.error("[runPreviewGhostMannequin] failed:", (err as Error).message);
    return { ok: false, error: (err as Error).message ?? "Generation failed" };
  }

  let creditsRemaining = dbUser?.credits ?? 0;
  if (REAL_GHOST) {
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { credits: { decrement: result.credits } },
      select: { credits: true },
    });
    creditsRemaining = updated.credits;
  }

  return {
    ok: true,
    ghostImagePath: result.resultImagePath,
    creditsRemaining,
    creditsUsed: result.credits,
  };
}

export async function runGenerateGhostViewFor(
  user: Pick<User, "id">,
  itemId: string,
  selectedExtraPaths: string[],
  label: string,
  instructions?: string,
  primaryGarmentPath?: string | null,
  compositionHint?: CompositionHint,
): Promise<GenerateGhostViewResponse> {
  const [item, dbUser] = await Promise.all([
    prisma.wardrobeItem.findUnique({ where: { id: itemId } }),
    prisma.user.findUnique({ where: { id: user.id }, select: { credits: true } }),
  ]);
  if (!item || item.userId !== user.id) return { ok: false, error: "Item not found" };
  if (REAL_GHOST && (dbUser?.credits ?? 0) < 1) {
    return { ok: false, error: "Out of credits" };
  }

  let allowedExtras: string[] = [];
  try {
    if (item.extraImagePaths) allowedExtras = JSON.parse(item.extraImagePaths) as string[];
  } catch {
    allowedExtras = [];
  }

  for (const p of selectedExtraPaths) {
    if (!p.startsWith(`${user.id}/`)) {
      return { ok: false, error: "Image does not belong to this user" };
    }
    if (!allowedExtras.includes(p)) {
      return { ok: false, error: "Invalid extra image selection" };
    }
  }

  const listing = item.originalImagePath;
  const primary =
    primaryGarmentPath?.trim() && primaryGarmentPath.trim() !== listing
      ? primaryGarmentPath.trim()
      : listing;
  if (!primary.startsWith(`${user.id}/`)) {
    return { ok: false, error: "Image does not belong to this user" };
  }
  if (primary !== listing && !selectedExtraPaths.includes(primary)) {
    return {
      ok: false,
      error: "Primary source must be the listing photo or a selected context image",
    };
  }

  let stack: { garmentImagePath: string; extraImagePaths: string[] };
  try {
    stack = resolveGhostModelInput(listing, selectedExtraPaths, primary !== listing ? primary : null);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  let result: GhostMannequinResult;
  try {
    result = await createGhostMannequin({
      userId: user.id,
      garmentImagePath: stack.garmentImagePath,
      extraImagePaths: stack.extraImagePaths,
      category: mapCategoryToGhost(item.category),
      instructions,
      compositionHint: compositionHint ?? "default",
    });
  } catch (err) {
    console.error("[runGenerateGhostViewFor] failed:", (err as Error).message);
    return { ok: false, error: (err as Error).message ?? "Generation failed" };
  }

  let existingViews: { label: string; imagePath: string; mirror?: boolean; thumbZoom?: number }[] = [];
  try {
    if (item.ghostViews) existingViews = JSON.parse(item.ghostViews) as typeof existingViews;
  } catch {
    // ignore
  }

  const viewLabel = label.trim() || (existingViews.length === 0 ? "Ghost" : `View ${existingViews.length + 1}`);
  const newView = { label: viewLabel, imagePath: result.resultImagePath, mirror: false, thumbZoom: 1 };
  const updatedViews = [...existingViews, newView];

  const remaining = await prisma.$transaction(async (tx) => {
    await tx.wardrobeItem.update({
      where: { id: itemId },
      data: {
        ghostViews: encode(updatedViews),
        ghostImagePath: item.ghostImagePath ?? result.resultImagePath,
      },
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

  return { ok: true, ghostImagePath: result.resultImagePath, creditsRemaining: remaining };
}
