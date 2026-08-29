/**
 * One in, one out.
 *
 * Adding something to the wishlist asks what it replaces. Not as a rule — the
 * app never blocks a purchase and never has to be answered — but as the one
 * moment when the question is cheap to ask and expensive to skip: you are
 * looking at a thing you want, and the four you already own in that shape are
 * out of sight in a grid somewhere.
 *
 * Deliberately *not* a stored pairing. An earlier shape of this had the user
 * nominate a piece and remembered the promise, which turned out to be the worst
 * of both: a migration for a field, and a list of intentions nobody kept. What
 * ships instead is candidates plus a real action — every one of these links to
 * the piece and to the make-space pile, so the "one out" is a decision you make
 * now or don't make at all.
 *
 * Pure, so the ordering is testable and the same on both sides of hydration.
 */

import { normalizeCategoryName } from "@/lib/categories";

export type ReplaceCandidate = {
  id: string;
  name: string;
  imagePath: string;
  /** Null means no wear has ever been logged. */
  lastWornAtMs: number | null;
};

/** What the caller has: every owned piece, with the category it's filed under. */
export type OwnedPiece = ReplaceCandidate & { category: string };

/** Most candidates worth showing at once. Beyond this it's a second grid. */
export const REPLACE_CANDIDATE_LIMIT = 6;

/**
 * Pieces already in the closet filed under the same category, longest-unworn
 * first.
 *
 * Never-worn pieces come first because "never" is the longest gap there is —
 * the same axis decision the rail makes (lib/space/rail.ts). The ordering is
 * stated in the UI rather than left implicit: it is answering the question the
 * user just asked ("what could go instead"), which is different from ranking
 * the closet unprompted, and the surfaces that must never rank are careful to
 * say so (see lenses-client.tsx).
 *
 * Matched on the *filed* category, not on garment kind: the user asked for a
 * jacket, so showing them a hoodie because both classify as outerwear answers a
 * question they didn't ask.
 */
export function replaceCandidates(
  owned: readonly OwnedPiece[],
  category: string,
  limit: number = REPLACE_CANDIDATE_LIMIT,
): ReplaceCandidate[] {
  const key = normalizeCategoryName(category);
  if (!key) return [];

  return owned
    .filter((piece) => normalizeCategoryName(piece.category) === key)
    .slice()
    .sort(compareByLongestUnworn)
    .slice(0, Math.max(0, limit))
    .map(({ id, name, imagePath, lastWornAtMs }) => ({ id, name, imagePath, lastWornAtMs }));
}

/** How many are filed under this category in total, so the UI can say "of 9". */
export function countInCategory(owned: readonly OwnedPiece[], category: string): number {
  const key = normalizeCategoryName(category);
  if (!key) return 0;
  let count = 0;
  for (const piece of owned) {
    if (normalizeCategoryName(piece.category) === key) count += 1;
  }
  return count;
}

function compareByLongestUnworn(a: OwnedPiece, b: OwnedPiece): number {
  if (a.lastWornAtMs == null && b.lastWornAtMs == null) return a.id.localeCompare(b.id);
  if (a.lastWornAtMs == null) return -1;
  if (b.lastWornAtMs == null) return 1;
  // Older timestamp = longer unworn = earlier in the list.
  return a.lastWornAtMs - b.lastWornAtMs || a.id.localeCompare(b.id);
}
