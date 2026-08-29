/**
 * What a share link can point at. Pure — no Prisma, no I/O — so the public
 * page, the share tab and the tests all agree on one vocabulary.
 */

export const SHARE_KINDS = ["item", "outfit", "wishlist", "space"] as const;

export type ShareKind = (typeof SHARE_KINDS)[number];

export const SHARE_KIND_LABELS: Record<ShareKind, { label: string; blurb: string }> = {
  item: { label: "Item", blurb: "A single piece, with its brand and colours" },
  outfit: { label: "Outfit", blurb: "A saved look and everything in it" },
  wishlist: { label: "Wishlist", blurb: "What you want, with prices and store links" },
  /*
   * The only kind that shares no photographs and no garments at all — just how
   * many pieces came in, how many went out, and roughly how much rail that
   * freed. Money is deliberately absent; see `SharedSpace` in ./resolve.ts.
   */
  space: { label: "Space", blurb: "Your year in counts — no photos, no prices" },
};

export function isShareKind(value: string): value is ShareKind {
  return (SHARE_KINDS as readonly string[]).includes(value);
}

/**
 * Kinds that are about the whole account rather than one row, and so store a
 * null `targetId`.
 *
 * A set rather than `kind !== "wishlist"`: that comparison was true of every
 * targetless kind by coincidence, and adding a second one turned it into a
 * silent bug — a space share would have demanded an item id.
 */
const TARGETLESS_KINDS: ReadonlySet<ShareKind> = new Set<ShareKind>(["wishlist", "space"]);

/** Items and outfits need a target row; account-wide kinds don't. */
export function kindRequiresTarget(kind: ShareKind): boolean {
  return !TARGETLESS_KINDS.has(kind);
}

/**
 * Validate a (kind, targetId) pair before it reaches the database, so we can't
 * store an item share with no item or a wishlist share pinned to a stray id.
 */
export function normalizeShareTarget(
  kind: ShareKind,
  targetId: string | null | undefined,
): { ok: true; targetId: string | null } | { ok: false; error: string } {
  const id = targetId?.trim() || null;
  if (kindRequiresTarget(kind)) {
    if (!id) return { ok: false, error: `Pick ${kind === "item" ? "an item" : "an outfit"} to share.` };
    return { ok: true, targetId: id };
  }
  // Forced to null so a stray id can never be stored against an account-wide
  // kind and later resolved as a target.
  return { ok: true, targetId: null };
}

/** Public URL path for a token. Relative so it works on any host. */
export function sharePath(token: string): string {
  return `/s/${encodeURIComponent(token)}`;
}

/** Absolute URL, when we have an origin to hang it off. */
export function shareUrl(token: string, origin: string): string {
  const base = origin.trim().replace(/\/$/, "");
  return `${base}${sharePath(token)}`;
}
