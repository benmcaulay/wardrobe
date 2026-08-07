/**
 * What a share link can point at. Pure — no Prisma, no I/O — so the public
 * page, the share tab and the tests all agree on one vocabulary.
 */

export const SHARE_KINDS = ["item", "outfit", "wishlist"] as const;

export type ShareKind = (typeof SHARE_KINDS)[number];

export const SHARE_KIND_LABELS: Record<ShareKind, { label: string; blurb: string }> = {
  item: { label: "Item", blurb: "A single piece, with its brand and colours" },
  outfit: { label: "Outfit", blurb: "A saved look and everything in it" },
  wishlist: { label: "Wishlist", blurb: "What you want, with prices and store links" },
};

export function isShareKind(value: string): value is ShareKind {
  return (SHARE_KINDS as readonly string[]).includes(value);
}

/** The wishlist is per-user; items and outfits need a target row. */
export function kindRequiresTarget(kind: ShareKind): boolean {
  return kind !== "wishlist";
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
