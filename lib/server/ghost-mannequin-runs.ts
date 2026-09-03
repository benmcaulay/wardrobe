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


/**
 * The image a new render should be built from.
 *
 * Always the photograph, never a previous render — see the note at the call
 * site. Exported and pure so the rule is stated in one place and pinned by a
 * test, because the failure it prevents is silent: renders that quietly
 * converge on copies of each other.
 */
export function resolveListingSource(item: {
  originalImagePath: string;
  ghostImagePath?: string | null;
}): string {
  return item.originalImagePath;
}

/** Image paths that are AI output, for telling a render source from a photo. */
export function existingViewPaths(ghostViews: string | null): string[] {
  if (!ghostViews) return [];
  try {
    const parsed = JSON.parse(ghostViews) as Array<{ imagePath?: string }>;
    return parsed.map((v) => v.imagePath).filter((p): p is string => !!p);
  } catch {
    return [];
  }
}

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
  | {
      ok: true;
      ghostImagePath: string;
      creditsRemaining: number;
      creditsUsed: number;
      model: string | null;
      costTenthCents: number;
    }
  | { ok: false; error: string };

export type GenerateGhostViewResponse =
  | {
      ok: true;
      ghostImagePath: string;
      creditsRemaining: number;
      creditsUsed: number;
      model: string | null;
      costTenthCents: number;
    }
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
    model: result.model,
    costTenthCents: result.costTenthCents,
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

  /*
   * Render from the photograph, never from a previous render.
   *
   * This used to read `ghostImagePath ?? originalImagePath` — the thumbnail —
   * on the reasoning that a second render should build on the cleanest image
   * rather than "the messy phone snap". The effect was that once one ghost
   * existed, every later generation was handed that ghost as its reference and
   * reproduced it almost exactly: new views were copies, a bad pose could never
   * be corrected by regenerating, and a prompt improvement did nothing until
   * the old image was deleted. AI output was feeding AI input.
   *
   * Both cases the old comment cited are already covered by
   * `originalImagePath` itself, which is why dropping the ghost costs nothing:
   *
   *   - Whitening or cropping calls `replaceOriginalImageWithEdit`, which
   *     repoints `originalImagePath` at the edited file. The improved photo IS
   *     the original; there is no messy snap to fall back to.
   *   - Deleting the original calls `deleteOriginalPhotoFor`, which promotes a
   *     surviving view into `originalImagePath` (see lib/ghost-view-promote.ts),
   *     so the pointer is always valid.
   *
   * After that promotion the "photograph" can itself be a render, but only
   * because the user deleted the real one — an explicit choice, and by then
   * there is nothing else left to draw from.
   *
   * An explicit `primaryGarmentPath` still wins, so deliberately generating
   * from a particular view remains possible; it just is not the default.
   */
  const listing = resolveListingSource(item);
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

  /*
   * Which image the render actually started from.
   *
   * Worth a line of its own: `stack` can reorder the source when a primary
   * override is passed, and a render that came out wrong is nearly impossible
   * to diagnose without knowing which of an item's four images went in.
   *
   * `fromRender` is the one to watch. It should be false almost always; true
   * means this generation was seeded by earlier AI output, which is how renders
   * used to converge on copies of each other.
   */
  const knownRenders = new Set(
    [item.ghostImagePath, ...existingViewPaths(item.ghostViews)].filter(Boolean) as string[],
  );
  log.info("ghost.view.source", {
    itemId,
    garmentImagePath: stack.garmentImagePath,
    fromRender: knownRenders.has(stack.garmentImagePath),
    extras: stack.extraImagePaths.length,
  });

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
          model: result.model,
          costTenthCents: result.costTenthCents,
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
    model: result.model,
    costTenthCents: result.costTenthCents,
  };
}
