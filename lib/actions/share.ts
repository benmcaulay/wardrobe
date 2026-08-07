"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { generateShareToken } from "@/lib/share/token";
import { isShareKind, normalizeShareTarget, type ShareKind } from "@/lib/share/kinds";

export type ShareActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { value?: never } : { value: T }))
  | { ok: false; error: string };

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

const MAX_NOTE = 140;

/**
 * Mint an unlisted link. Re-uses an existing live link for the same target
 * rather than minting a second one — otherwise every visit to the share tab
 * would litter the list with duplicates pointing at the same thing.
 */
export async function createShareLink(input: {
  kind: string;
  targetId?: string | null;
  note?: string;
}): Promise<ShareActionResult<{ token: string }>> {
  const user = await requireUser();

  if (!isShareKind(input.kind)) return fail("Unknown share type.");
  const kind: ShareKind = input.kind;

  const target = normalizeShareTarget(kind, input.targetId);
  if (!target.ok) return fail(target.error);

  // Confirm the thing exists and is actually theirs before minting a token.
  if (kind === "item") {
    const owned = await prisma.wardrobeItem.count({
      where: { id: target.targetId!, userId: user.id },
    });
    if (!owned) return fail("Item not found.");
  } else if (kind === "outfit") {
    const owned = await prisma.outfit.count({
      where: { id: target.targetId!, userId: user.id },
    });
    if (!owned) return fail("Outfit not found.");
  }

  const existing = await prisma.shareLink.findFirst({
    where: { userId: user.id, kind, targetId: target.targetId, revokedAt: null },
    select: { token: true },
  });
  if (existing) return { ok: true, value: { token: existing.token } };

  const link = await prisma.shareLink.create({
    data: {
      userId: user.id,
      token: generateShareToken(),
      kind,
      targetId: target.targetId,
      note: input.note?.trim().slice(0, MAX_NOTE) || null,
    },
    select: { token: true },
  });

  revalidatePath("/closet/share");
  return { ok: true, value: { token: link.token } };
}

/**
 * Turn a link off. The row is kept so the URL renders an explicit
 * "this link was turned off" page rather than a 404 that reads as breakage.
 */
export async function revokeShareLink(id: string): Promise<ShareActionResult> {
  const user = await requireUser();
  const link = await prisma.shareLink.findFirst({
    where: { id, userId: user.id },
    select: { id: true, revokedAt: true },
  });
  if (!link) return fail("Link not found.");
  if (link.revokedAt) return { ok: true };

  await prisma.shareLink.update({ where: { id: link.id }, data: { revokedAt: new Date() } });
  revalidatePath("/closet/share");
  return { ok: true };
}

/** Bring a revoked link back on the same URL. */
export async function restoreShareLink(id: string): Promise<ShareActionResult> {
  const user = await requireUser();
  const link = await prisma.shareLink.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!link) return fail("Link not found.");

  await prisma.shareLink.update({ where: { id: link.id }, data: { revokedAt: null } });
  revalidatePath("/closet/share");
  return { ok: true };
}

/** Delete a link outright — the URL then 404s. */
export async function deleteShareLink(id: string): Promise<ShareActionResult> {
  const user = await requireUser();
  const link = await prisma.shareLink.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!link) return fail("Link not found.");

  await prisma.shareLink.delete({ where: { id: link.id } });
  revalidatePath("/closet/share");
  return { ok: true };
}

export async function updateShareNote(id: string, note: string): Promise<ShareActionResult> {
  const user = await requireUser();
  const link = await prisma.shareLink.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!link) return fail("Link not found.");

  await prisma.shareLink.update({
    where: { id: link.id },
    data: { note: note.trim().slice(0, MAX_NOTE) || null },
  });
  revalidatePath("/closet/share");
  return { ok: true };
}
