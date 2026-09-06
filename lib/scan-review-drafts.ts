/**
 * Reconciling saved camera-roll review edits with a freshly loaded scan.
 *
 * Review edits — renaming a piece, correcting a brand, unchecking something,
 * reassigning it to the other owner — used to live only in React state. A
 * reload, a crashed tab or a restarted dev server threw all of it away while
 * the expensive part (the Gemini classification behind it) survived in the
 * job row. Persisting the edits closes that gap.
 *
 * The saved copy can disagree with the scan it belongs to: a later worker pass
 * can add, drop or re-split detections. So the scan is always the source of
 * truth for *which* pieces exist, and the saved copy only supplies the *values*
 * the user typed. Anything saved for a reviewId the scan no longer contains is
 * dropped rather than resurrected.
 */

/** The subset of a review row a user can edit. Everything else is derived. */
export type SavedDraftFields = {
  reviewId: string;
  name?: string;
  brand?: string;
  category?: string;
  include?: boolean;
  ownerIds?: string[];
  ungrouped?: boolean;
};

export type SavedReviewDraft = {
  drafts: SavedDraftFields[];
  /** Duplicate groups the user broke apart by hand. */
  splitGroups?: string[];
};

/** Parse the stored JSON, returning null for anything unusable. */
export function parseSavedDraft(raw: string | null | undefined): SavedReviewDraft | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const drafts = (parsed as SavedReviewDraft).drafts;
    if (!Array.isArray(drafts)) return null;
    const clean = drafts.filter(
      (d): d is SavedDraftFields => Boolean(d) && typeof d.reviewId === "string",
    );
    const groups = (parsed as SavedReviewDraft).splitGroups;
    return {
      drafts: clean,
      splitGroups: Array.isArray(groups) ? groups.filter((g) => typeof g === "string") : [],
    };
  } catch {
    // A truncated or hand-edited value must not take the review down with it —
    // losing the edits is recoverable, failing to open the review is not.
    return null;
  }
}

/**
 * Overlay saved values onto the drafts derived from the scan.
 *
 * `fresh` decides membership and ordering; `saved` only overrides fields the
 * user can actually type. A field absent from the saved copy keeps whatever the
 * classifier produced, so a partially saved draft degrades to "some edits
 * kept" rather than blanking the row.
 */
export function mergeSavedDrafts<T extends { reviewId: string }>(
  fresh: T[],
  saved: SavedReviewDraft | null,
): T[] {
  if (!saved || saved.drafts.length === 0) return fresh;
  const byId = new Map(saved.drafts.map((d) => [d.reviewId, d]));
  return fresh.map((row) => {
    const hit = byId.get(row.reviewId);
    if (!hit) return row;
    const merged = { ...row } as T & SavedDraftFields;
    if (typeof hit.name === "string") merged.name = hit.name;
    if (typeof hit.brand === "string") merged.brand = hit.brand;
    if (typeof hit.category === "string") merged.category = hit.category;
    if (typeof hit.include === "boolean") merged.include = hit.include;
    if (typeof hit.ungrouped === "boolean") merged.ungrouped = hit.ungrouped;
    if (Array.isArray(hit.ownerIds)) merged.ownerIds = hit.ownerIds;
    return merged;
  });
}

/** Keep only the fields worth storing, so the column does not carry image paths. */
export function toSavedDraft(
  drafts: readonly (SavedDraftFields & Record<string, unknown>)[],
  splitGroups: readonly string[],
): SavedReviewDraft {
  return {
    drafts: drafts.map((d) => ({
      reviewId: d.reviewId,
      name: d.name,
      brand: d.brand,
      category: d.category,
      include: d.include,
      ownerIds: d.ownerIds,
      ungrouped: d.ungrouped,
    })),
    splitGroups: [...splitGroups],
  };
}
