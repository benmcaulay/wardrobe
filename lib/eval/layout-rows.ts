/**
 * Pure geometry helpers for the layout audit (scripts/audit-layout.ts).
 *
 * ── Why this is a module and not inline in the script ────────────────────────
 *
 * The row counter got this wrong twice. The first version counted distinct
 * `top` offsets, so a row of controls with differing heights — a checkbox next
 * to a pill button — read as multiple rows. That made a `flex-nowrap` container
 * report as wrapped after it had been fixed, and sent the investigation to the
 * wrong file. The logic is small, load-bearing and easy to get subtly wrong, so
 * it lives here with tests and the script imports it.
 *
 * The browser side only collects rectangles; every judgement happens here.
 */

export type Rect = { top: number; bottom: number; left: number; right: number; width: number };

/**
 * How many visual rows a set of sibling rectangles occupies.
 *
 * A new row starts only when a rectangle begins at or below the bottom of
 * everything seen so far — that is what makes it tolerant of children with
 * different heights sharing one line. The 2px slack absorbs sub-pixel layout.
 */
export function countRowBands(rects: readonly Rect[], slack = 2): number {
  if (rects.length === 0) return 0;
  const sorted = [...rects].sort((a, b) => a.top - b.top);
  let rows = 1;
  let bandBottom = sorted[0]!.bottom;
  for (const r of sorted.slice(1)) {
    if (r.top >= bandBottom - slack) {
      rows++;
      bandBottom = r.bottom;
    } else {
      bandBottom = Math.max(bandBottom, r.bottom);
    }
  }
  return rows;
}

/**
 * Containers big enough that wrapping is obviously the point — the closet grid,
 * an icon gallery. Reporting those as defects buries the real findings.
 */
export const GALLERY_CHILD_THRESHOLD = 24;

export function isGallery(childCount: number, threshold = GALLERY_CHILD_THRESHOLD): boolean {
  return childCount >= threshold;
}

/** Fewer than this and a wrap isn't meaningfully a "row spilling". */
export const MIN_ROW_CHILDREN = 5;

export type Candidate = { sel: string; kids: Rect[]; width: number; labels: string[] };
export type WrappedRow = { sel: string; kids: number; rows: number; width: number; labels: string[] };

/** Candidates that occupy more than one visual row and aren't galleries. */
export function findWrappedRows(candidates: readonly Candidate[]): WrappedRow[] {
  const out: WrappedRow[] = [];
  for (const c of candidates) {
    if (c.kids.length < MIN_ROW_CHILDREN) continue;
    if (isGallery(c.kids.length)) continue;
    const rows = countRowBands(c.kids);
    if (rows > 1) {
      out.push({ sel: c.sel, kids: c.kids.length, rows, width: Math.round(c.width), labels: c.labels });
    }
  }
  return out;
}
