import type { Prisma } from "@prisma/client";

/** Case-insensitive substring match for free-text closet search. */
const contains = (q: string): Prisma.StringFilter => ({
  contains: q,
  mode: "insensitive",
});

/**
 * Prisma `where` clause matching wardrobe items whose name, brand, category,
 * colors, season, tags, or other catalogue text contains `q`.
 */
export function closetTextSearchWhere(q: string): Prisma.WardrobeItemWhereInput | null {
  const trimmed = q.trim();
  if (!trimmed) return null;

  return {
    OR: [
      { name: contains(trimmed) },
      { brand: contains(trimmed) },
      { category: contains(trimmed) },
      { subcategory: contains(trimmed) },
      { pattern: contains(trimmed) },
      { material: contains(trimmed) },
      { styleTags: contains(trimmed) },
      { notes: contains(trimmed) },
      /** JSON array, e.g. ["spring","summer"] */
      { season: contains(trimmed) },
      /** JSON array of { name, hex } color objects */
      { colors: contains(trimmed) },
    ],
  };
}
