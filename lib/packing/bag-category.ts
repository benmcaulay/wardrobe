/**
 * Which closet category a piece of luggage belongs in.
 *
 * `suggestCategoryFromItem` is the general tool, and it is the wrong one here.
 * It classifies a bag as kind "accessory", then picks among every accessory
 * label the closet has — so a wardrobe full of hats filed a Cotopaxi backpack
 * under "hat", because nothing disambiguated and it fell back to the first
 * same-kind label. Measured on a real closet during the backfill dry run.
 *
 * Luggage has obvious names, so match on them directly and prefer the generic
 * "accessory" over a specific label that happens to be wrong. Being vague beats
 * being confidently incorrect: the user can re-file "accessory" in one click,
 * whereas a backpack sitting in "hat" looks like the app cannot tell them apart.
 */
import { normalizeCategoryName } from "@/lib/categories";

/** Labels that plainly name luggage. */
const BAG_LABEL = /\b(bag|bags|backpack|backpacks|luggage|suitcase|duffel|tote|purse|handbag)\b/;

/** The catch-all accessory label, however the closet spells it. */
const ACCESSORY_LABEL = /^accessor(y|ies)$/;

export const FALLBACK_BAG_CATEGORY = "accessory";

export function resolveBagCategory(options: readonly string[]): string {
  const normalized = options.map((o) => ({ raw: o, norm: normalizeCategoryName(o) }));

  const named = normalized.find((o) => BAG_LABEL.test(o.norm));
  if (named) return named.raw;

  const generic = normalized.find((o) => ACCESSORY_LABEL.test(o.norm));
  if (generic) return generic.raw;

  return FALLBACK_BAG_CATEGORY;
}
