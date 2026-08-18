import type { User } from "@prisma/client";
import { checkAiQuota } from "@/lib/ai-guardrails";
import { prisma } from "@/lib/db";
import { loadCategoryShapes } from "@/lib/server/category-shapes";
import { encode } from "@/lib/json";
import { log } from "@/lib/log";
import {
  createGhostMannequin,
  mapItemToGhost,
  requireGhostCategory,
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
  | { ok: true; ghostImagePath: string; creditsRemaining: number; creditsUsed: number }
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
  if (input.category === "full") {
    return {
      ok: false,
      error:
        "Set a category before generating — without one the render has to guess the garment type, " +
        "which is what produces cropped or misshapen results.",
    };
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
    log.error("ghost.preview.failed", err, { userId: user.id });
    return { ok: false, error: (err as Error).message ?? "Generation failed" };
  }

  let creditsRemaining = dbUser?.credits ?? 0;
  if (REAL_GHOST && !result.cached) {
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
  // Before credits or quota: an unclassifiable item can only get the generic
  // "guess the type" prompt, so refuse rather than spend on a likely-bad render.
  const categoryShapes = await loadCategoryShapes(user.id);
  const categoryCheck = requireGhostCategory({ ...item, categoryShapes });
  if (!categoryCheck.ok) return { ok: false, error: categoryCheck.error };
  if (REAL_GHOST && (dbUser?.credits ?? 0) < 1) {
    return { ok: false, error: "Out of credits" };
  }
  const quota = await checkAiQuota(user.id);
  if (!quota.ok) return quota;

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
      category: categoryCheck.category,
      instructions,
      compositionHint: compositionHint ?? "default",
    });
  } catch (err) {
    log.error("ghost.view.failed", err, { userId: user.id, itemId });
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
  // A cache hit returns a path an existing view may already own. Appending a
  // second row for the same file is what made deleting either view break the
  // other, so keep the existing row and don't duplicate it.
  const alreadyPresent = existingViews.some((v) => v.imagePath === result.resultImagePath);
  const updatedViews = alreadyPresent ? existingViews : [...existingViews, newView];

  const remaining = await prisma.$transaction(async (tx) => {
    await tx.wardrobeItem.update({
      where: { id: itemId },
      data: {
        ghostViews: encode(updatedViews),
        ghostImagePath: item.ghostImagePath ?? result.resultImagePath,
      },
    });
    // A cache hit did not generate anything: no ledger row, no decrement, and
    // it therefore doesn't consume the AI quota either.
    if (!result.cached) {
      await tx.tryOnGeneration.create({
        data: {
          userId: user.id,
          itemId,
          resultImagePath: result.resultImagePath,
          creditsUsed: result.credits,
        },
      });
    }
    if (REAL_GHOST && !result.cached) {
      const updated = await tx.user.update({
        where: { id: user.id },
        data: { credits: { decrement: result.credits } },
        select: { credits: true },
      });
      return updated.credits;
    }
    return dbUser?.credits ?? 0;
  });

  return {
    ok: true,
    ghostImagePath: result.resultImagePath,
    creditsRemaining: remaining,
    creditsUsed: result.credits,
  };
}
