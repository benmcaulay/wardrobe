import { prisma } from "@/lib/db";
import { canonicalBrand, isBrandRespelling, normalizeBrandInput } from "@/lib/brand-name";

/**
 * The spelling this user already uses for `raw`, or `raw` cleaned up if the
 * brand is new to them. Returns null for blank input so it can be handed
 * straight to a nullable column.
 *
 * Scoped per user: two people can spell a brand differently without one of
 * them overwriting the other.
 */
export async function canonicalBrandForUser(
  userId: string,
  raw: string | null | undefined,
): Promise<string | null> {
  const normalized = normalizeBrandInput(raw);
  if (!normalized) return null;

  // Narrowed to the one brand in question, so this stays a cheap lookup as a
  // closet grows. Oldest first, because the first spelling committed is the
  // one that wins.
  const matches = await prisma.wardrobeItem.findMany({
    where: { userId, brand: { equals: normalized, mode: "insensitive" } },
    orderBy: { createdAt: "asc" },
    take: 1,
    select: { brand: true },
  });

  return canonicalBrand(
    normalized,
    matches.map((m) => m.brand),
  );
}

/**
 * Brand for an item being edited, where `previous` is what it was before.
 *
 * Editing is the one place a spelling can be *changed* rather than matched.
 * If creates silently adopt the established spelling and edits did too, a
 * brand first entered as "new era" could never be corrected to "New Era" —
 * every attempt would be rewritten back. So a case-only change to the brand
 * an item already had is read as a deliberate correction: the typed spelling
 * wins and the user's other pieces of that brand follow it, because the whole
 * point is that one brand has one spelling.
 *
 * Changing to a *different* brand is not a correction, and canonicalises like
 * any other entry — otherwise retyping "Adidas" on one item would rename
 * every adidas piece in the closet.
 */
export async function brandForEditedItem(
  userId: string,
  previous: string | null,
  raw: string | null | undefined,
): Promise<string | null> {
  const normalized = normalizeBrandInput(raw);
  if (!normalized) return null;

  if (!isBrandRespelling(previous, normalized)) return canonicalBrandForUser(userId, normalized);

  await prisma.wardrobeItem.updateMany({
    where: {
      userId,
      brand: { equals: normalized, mode: "insensitive" },
      NOT: { brand: normalized },
    },
    data: { brand: normalized },
  });
  return normalized;
}
