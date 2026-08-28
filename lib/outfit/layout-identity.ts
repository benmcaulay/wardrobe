/**
 * What a slot's saved size and position are remembered *as*.
 *
 * The outfit canvas stores a position and size per "combination": a piece,
 * plus the exact set of pieces sharing its visual layer. This module decides
 * which category name goes into that key — which sounds like a detail and is
 * the difference between sizing every coat you own and sizing one kind of coat.
 *
 * Nested categories are why it needs a module. A rule for "outerwear" is filled
 * by a jacket, so there are two defensible answers, and the right one differs
 * between reading and writing:
 *
 *   write → the piece's own category. Sizing a jacket sizes jackets.
 *   read  → the piece's category, or the nearest ancestor that has something
 *           saved. A jacket you have never touched still uses the size you set
 *           for outerwear.
 *
 * Without the inheritance, nesting a category would silently discard the
 * position and size already tuned for its parent. Without the specificity,
 * every subcategory would keep sharing one size, which is the complaint this
 * answers.
 *
 * The identity also matches how the packing carousel keys the same look —
 * lib/packing/look.ts builds its keys from the item's own category — and two
 * surfaces reading different keys for one outfit would compose it two ways.
 */

import { isNoneCategoryStored } from "@/lib/categories";
import {
  combinationKey,
  layerIndexForCategories,
  type ComboLayout,
} from "@/lib/outfit-slot-defaults";

/** Resolves a category to itself plus its ancestors, most specific first. */
export type AncestryOf = (category: string) => string[];

/** The bit of a slot this module reads. */
export type IdentifiableSlot = {
  id?: string;
  /** What the rule asked for. */
  categories: string[];
  itemId?: string;
};

/**
 * What a slot's size and position are remembered *as*.
 *
 * The category the piece is actually filed under, when the slot holds one —
 * not the category the rule asked for. With nested categories those differ:
 * a rule for "outerwear" is filled by a jacket, and sizing that jacket should
 * size jackets, not every coat and hoodie in the closet.
 *
 * Falls back to the rule's categories for an empty slot, which is the only
 * thing there is to key on before a piece lands in it.
 */
export function slotIdentityCategories(
  slot: { categories: string[]; itemId?: string },
  itemCategoryOf: (itemId: string) => string | undefined,
): string[] {
  const own = slot.itemId ? itemCategoryOf(slot.itemId)?.trim() : undefined;
  return own && !isNoneCategoryStored(own) ? [own] : slot.categories;
}

/**
 * The combination keys a slot could use, most specific first.
 *
 * The first is what a change *writes* to; the first one that already has a
 * saved layout is what the slot *reads*. That asymmetry is the feature: sizing
 * a hoodie writes "hoodie", so it stops there and leaves jackets alone, while a
 * hoodie you have never touched still inherits whatever you set for outerwear.
 * Without the inheritance, nesting a category would silently drop the size and
 * position already tuned for its parent.
 *
 * Identity comes from the piece in the slot (`slotIdentityCategories`), which is
 * also how the packing carousel keys the same look — lib/packing/look.ts builds
 * its keys from the item's own category, and two surfaces reading different keys
 * for one outfit would compose it two different ways.
 *
 * Band *membership* stays resolved from the rule's categories: visual layers are
 * arranged by hand out of the category list, so a band holding "outerwear" has
 * to keep catching the slot that asked for outerwear whatever ends up in it.
 */
export function comboKeyCandidates(
  slot: { id?: string; categories: string[]; itemId?: string },
  allSlots: readonly { id?: string; categories: string[]; itemId?: string }[],
  layers: string[][],
  itemCategoryOf: (itemId: string) => string | undefined,
  ancestryOf: AncestryOf,
): string[] {
  const identity = slotIdentityCategories(slot, itemCategoryOf)[0] ?? "";
  const idx = layerIndexForCategories(slot.categories, layers);
  const others =
    idx < 0
      ? []
      : allSlots
          .filter(
            (s) =>
              s.id !== slot.id && layerIndexForCategories(s.categories, layers) === idx,
          )
          .map((s) => slotIdentityCategories(s, itemCategoryOf)[0] ?? "");
  const chain = ancestryOf(identity);
  const levels = chain.length > 0 ? chain : [identity];
  // Each level substitutes itself for the slot's own entry in the present set,
  // so the ancestor's key is the same combination expressed one level up.
  return levels.map((level) => combinationKey([level], [level, ...others]));
}

/** Where a change to this slot is saved. */
export function comboKeyForSlot(
  slot: { id?: string; categories: string[]; itemId?: string },
  allSlots: readonly { id?: string; categories: string[]; itemId?: string }[],
  layers: string[][],
  itemCategoryOf: (itemId: string) => string | undefined,
  ancestryOf: AncestryOf,
): string {
  return comboKeyCandidates(slot, allSlots, layers, itemCategoryOf, ancestryOf)[0] ?? "";
}

/** The saved layout this slot should use, inherited from an ancestor if needed. */
export function comboLayoutForSlot(
  slot: { id?: string; categories: string[]; itemId?: string },
  allSlots: readonly { id?: string; categories: string[]; itemId?: string }[],
  layers: string[][],
  itemCategoryOf: (itemId: string) => string | undefined,
  ancestryOf: AncestryOf,
  comboLayouts: Record<string, ComboLayout>,
): ComboLayout | undefined {
  for (const key of comboKeyCandidates(slot, allSlots, layers, itemCategoryOf, ancestryOf)) {
    const hit = comboLayouts[key];
    if (hit) return hit;
  }
  return undefined;
}
