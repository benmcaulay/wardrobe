/**
 * How wide the space in "MAKING SPACE" is.
 *
 * The one gap in the wordmark is the only part of the brand that moves: it
 * widens as pieces leave the closet, so the logo in the corner is a reading of
 * your own month rather than a fixed asset. lib/brand.ts already kept
 * `APP_WORDMARK` separate from `APP_NAME` so the display form could diverge
 * from the prose form; this is the divergence.
 *
 * Pure and integer-in/number-out so the server and the client compute the same
 * width from the same count. Getting a different number on each side would
 * hydrate as a visible jump in the header, which is worse than not doing it.
 *
 * Deliberately *not* a score. It counts one thing (pieces that left), it has no
 * target, and it does not go down when you buy something — a gap that closed
 * when you shopped would turn the wordmark into a scold, and the closet lenses
 * (lib/actions/closet-lenses.ts) already establish that this product states
 * facts and stops.
 */

/** Space width with nothing out yet — a normal word space at display tracking. */
export const WORDMARK_SPACE_MIN_EM = 0.3;

/**
 * Widest the gap is allowed to get.
 *
 * Capped because past roughly this width the two halves stop reading as one
 * name — "MAKING" and "SPACE" become two separate words on a shelf, and a
 * wordmark that falls apart at 30 sales is not a wordmark.
 */
export const WORDMARK_SPACE_MAX_EM = 1.9;

/** Count at which the gap reaches `WORDMARK_SPACE_MAX_EM`. */
export const WORDMARK_SPACE_CAP = 24;

/**
 * Em width of the wordmark's space for a given number of pieces out.
 *
 * Square-root rather than linear: the first piece to leave should be visible —
 * that is the whole reward — while the twentieth should not have to move the
 * gap as far again. Linear made the first few sales look like nothing happened
 * and then ran into the cap for the rest of the year.
 *
 * Rounded to three decimals so a float tail can't differ between the server's
 * render and the browser's.
 */
export function wordmarkSpaceEm(piecesOut: number): number {
  if (!Number.isFinite(piecesOut) || piecesOut <= 0) return WORDMARK_SPACE_MIN_EM;
  const progress = Math.sqrt(Math.min(piecesOut, WORDMARK_SPACE_CAP) / WORDMARK_SPACE_CAP);
  const span = WORDMARK_SPACE_MAX_EM - WORDMARK_SPACE_MIN_EM;
  return round3(WORDMARK_SPACE_MIN_EM + span * progress);
}

/**
 * What the gap currently means, in words.
 *
 * The wordmark is decorative to anyone who isn't told what it's doing, so this
 * is the tooltip and the screen-reader description. States the count and
 * nothing else — no "keep going", no comparison to last month.
 */
export function wordmarkSpaceLabel(piecesOut: number, windowLabel = "this month"): string {
  if (!Number.isFinite(piecesOut) || piecesOut <= 0) {
    return `Nothing has left the closet ${windowLabel}.`;
  }
  const n = Math.floor(piecesOut);
  return `${n} ${n === 1 ? "piece" : "pieces"} left the closet ${windowLabel}. The space in the name is that wide.`;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
