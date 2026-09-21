/**
 * One brand, one spelling.
 *
 * Brand is free text, so "Nike", "nike" and "NIKE" all end up in the column
 * and the closet grows three separate brand filters for one label. The rule
 * here is that the first spelling a user commits wins: everything typed after
 * it is matched case-insensitively and rewritten to that first spelling.
 *
 * First-spelling-wins rather than title case because brands disagree about
 * their own capitalisation — adidas and COS are correct as written, and
 * "Adidas" would be a downgrade dressed up as a fix.
 */

/**
 * Cleaned-up text as it should be stored: no surrounding space, no double
 * space inside. Purely hygiene — it does not touch case.
 */
export function normalizeBrandInput(raw: string | null | undefined): string {
  return (raw ?? "").trim().replace(/\s+/g, " ");
}

/**
 * The identity two spellings of one brand share. Case only, so it lines up
 * exactly with what a case-insensitive database lookup will match.
 */
export function brandKey(raw: string | null | undefined): string {
  return normalizeBrandInput(raw).toLowerCase();
}

export function sameBrand(a: string | null | undefined, b: string | null | undefined): boolean {
  const key = brandKey(a);
  return key !== "" && key === brandKey(b);
}

/**
 * Rewrite `raw` to whichever spelling in `known` it matches, if any. `known`
 * must be ordered oldest first — the first match is the spelling that wins.
 */
export function canonicalBrand(
  raw: string | null | undefined,
  known: Iterable<string | null | undefined>,
): string {
  const normalized = normalizeBrandInput(raw);
  if (!normalized) return "";
  const key = brandKey(normalized);
  for (const candidate of known) {
    const existing = normalizeBrandInput(candidate);
    if (existing && brandKey(existing) === key) return existing;
  }
  return normalized;
}

/**
 * Whether an edit changes only how the item's existing brand is spelled,
 * rather than moving it to a different brand.
 *
 * The distinction matters because a respelling is a correction the user should
 * be allowed to make — creates adopt the established spelling, so an edit is
 * the only way to change it — while switching brands is an ordinary entry and
 * must not rename anything else in the closet.
 */
export function isBrandRespelling(
  previous: string | null | undefined,
  next: string | null | undefined,
): boolean {
  const normalized = normalizeBrandInput(next);
  if (!normalized) return false;
  return sameBrand(previous, normalized) && previous !== normalized;
}

/**
 * Collapse a facet list to one entry per brand, keeping the first spelling of
 * each. A safety net for rows that predate canonicalisation: without it the
 * filter dropdown offers "Nike" and "nike" as separate choices.
 */
export function dedupeBrands(brands: Iterable<string | null | undefined>): string[] {
  const seen = new Map<string, string>();
  for (const brand of brands) {
    const normalized = normalizeBrandInput(brand);
    if (!normalized) continue;
    const key = brandKey(normalized);
    if (!seen.has(key)) seen.set(key, normalized);
  }
  return [...seen.values()];
}
