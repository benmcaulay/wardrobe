/**
 * Loading a ready-made look — a trip day's outfit — onto the Smart Generator's
 * canvas.
 *
 * The generator's canvas is not a free-form frame: it is a set of *slots*
 * derived from category rules, and every position, size and stacking decision
 * the user has ever saved is keyed off those slots (see
 * lib/outfit-slot-defaults.ts). So handing it a look means handing it rules
 * first and filling the slots those rules produce — not placing pieces by hand.
 *
 * That indirection is the whole point. Seeding a look by placing garments
 * directly, as the manual composer did, produces a canvas that shares no
 * layout, no scale and no layering with the packing carousel the look came
 * from: the same four garments, all at scale 1, stacked near the frame's
 * middle. Going through the rules means the look arrives placed by the user's
 * own defaults, which is what makes it recognisably the same look.
 *
 * Pure, and separate from the component, because both halves are quietly easy
 * to get wrong: the rules must preserve duplicate categories (two shirts is two
 * slots, not one) and the fill must not hand the same garment to two slots.
 */

import { normalizeCategoryName, isNoneCategoryStored } from "@/lib/categories";
import { categoryListSignature, type CategoryRule } from "@/lib/outfit-random";

/** The bit of a closet item that seeding needs. */
export type SeedPiece = {
  id: string;
  category: string;
};

/**
 * One single-category rule per distinct category, counted.
 *
 * Order follows first appearance in the look rather than any canonical category
 * order, so the rules row reads in the order the look was built.
 *
 * Uncategorised pieces are dropped: a rule with no category produces no slot,
 * and `itemMatchesCategories` refuses them anyway.
 */
export function seedRulesForPieces(pieces: readonly SeedPiece[]): CategoryRule[] {
  const order: string[] = [];
  const byKey = new Map<string, { category: string; count: number }>();
  for (const piece of pieces) {
    const category = (piece.category ?? "").trim();
    if (!category || isNoneCategoryStored(category)) continue;
    const key = normalizeCategoryName(category);
    if (!key) continue;
    const existing = byKey.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    byKey.set(key, { category, count: 1 });
    order.push(key);
  }
  return order.map((key) => {
    const entry = byKey.get(key)!;
    return { categories: [entry.category], count: entry.count };
  });
}

/** A slot, as far as seeding is concerned. */
export type SeedSlot = {
  id: string;
  categories: string[];
  itemId?: string;
};

/**
 * Which garment goes in which slot: `slotId → itemId`.
 *
 * Matched by category signature so a piece can only land in a slot that accepts
 * it, and each garment is used at most once — otherwise a look with two pairs of
 * jeans would put the first pair in both slots and silently lose the second.
 * Slots that already hold something are left alone, and a piece with no free
 * slot is skipped rather than forced somewhere it doesn't belong.
 */
export function assignSeedPieces(
  slots: readonly SeedSlot[],
  pieces: readonly SeedPiece[],
): Map<string, string> {
  const out = new Map<string, string>();
  const remaining = pieces.filter((p) => p.category && !isNoneCategoryStored(p.category));
  for (const slot of slots) {
    if (slot.itemId) continue;
    const signature = categoryListSignature(slot.categories);
    if (!signature) continue;
    const index = remaining.findIndex(
      (piece) => categoryListSignature([piece.category]) === signature,
    );
    if (index < 0) continue;
    out.set(slot.id, remaining[index]!.id);
    remaining.splice(index, 1);
  }
  return out;
}
