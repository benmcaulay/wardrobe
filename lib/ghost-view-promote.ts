/**
 * What happens to an item's images when the original photo is deleted.
 *
 * `WardrobeItem.originalImagePath` is non-null, so "delete the original" cannot
 * mean clearing it — an item always has a base photo. It means the phone snap
 * goes and a better image takes over that role, which is a small rearrangement
 * with several ways to get it subtly wrong: promoting the wrong view, leaving
 * the promoted image in `ghostViews` so it renders twice, or forgetting that
 * `ghostImagePath: null` is how "the original is the thumbnail" is spelled.
 *
 * Pure, so all of that is testable without a database and without deleting
 * anybody's photo. lib/actions/ghost-mannequin.ts does the auth, the write and
 * the storage delete around it.
 */

export type GhostViewRow = {
  label: string;
  imagePath: string;
  mirror?: boolean;
  thumbZoom?: number;
};

export type PromoteOnDeleteInput = {
  originalImagePath: string;
  /** The thumbnail pointer. Null means the original is currently the thumbnail. */
  ghostImagePath: string | null;
  views: readonly GhostViewRow[];
};

export type PromoteOnDeleteResult =
  | {
      ok: true;
      /** The view taking the original's place. */
      promoted: GhostViewRow;
      /** `ghostViews` after the promoted row is pulled out of it. */
      remaining: GhostViewRow[];
    }
  | { ok: false; reason: "no-views" | "already-original" };

/**
 * Decide which image replaces the original.
 *
 * The **thumbnail** is promoted, not the first view. That keeps the change
 * invisible to everything downstream: the thumbnail is already what the closet
 * grid shows and already what a render starts from (see
 * `runGenerateGhostViewFor`), so afterwards both read the same bytes they read
 * before. Promoting the first view instead would silently change the item's
 * appearance in the grid as a side effect of a delete.
 *
 * Falls back to the first view when the original is itself the thumbnail —
 * it cannot promote itself out of existence.
 */
export function promoteOnOriginalDelete(
  input: PromoteOnDeleteInput,
): PromoteOnDeleteResult {
  const { originalImagePath, ghostImagePath, views } = input;

  if (views.length === 0) return { ok: false, reason: "no-views" };

  const thumbnailView = ghostImagePath
    ? views.find((v) => v.imagePath === ghostImagePath)
    : undefined;
  const promoted = thumbnailView ?? views[0]!;

  // A view pointing at the original's own file. Deleting that file would take
  // the "promoted" image with it, which is a data-loss bug rather than a tidy-up.
  if (promoted.imagePath === originalImagePath) {
    return { ok: false, reason: "already-original" };
  }

  return {
    ok: true,
    promoted,
    // Compared by path, not by identity: two rows can legitimately share a file
    // after a cache hit, and both must go or the strip keeps a row pointing at
    // a deleted image.
    remaining: views.filter((v) => v.imagePath !== promoted.imagePath),
  };
}
