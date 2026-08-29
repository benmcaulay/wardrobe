/**
 * The wordmark, with the one gap that moves.
 *
 * "MAKING SPACE" set with a space whose width is a reading of your own month:
 * it widens as pieces leave the closet. The logo in the corner stops being a
 * fixed asset and becomes the only part of the interface that is about you
 * before you've clicked anything.
 *
 * A server component on purpose — no directive, no state. The width arrives as
 * a prop already computed by `wordmarkSpaceEm`, so the server and the client
 * produce the identical inline style and there is nothing to hydrate. Making
 * this a client component and reading the count in an effect would show the
 * name snapping wider one frame after load, on every navigation.
 *
 * Screen readers get the plain name once (`aria-label` on the wrapper, the
 * halves hidden), plus the count as the title — the gap is a fact, but it is
 * not worth spelling the name out twice to deliver it.
 */

import { APP_WORDMARK, APP_WORDMARK_PARTS } from "@/lib/brand";
import { wordmarkSpaceEm, wordmarkSpaceLabel } from "@/lib/space/wordmark";

type Props = {
  /** Pieces that left the closet in the window. Sizes the gap. */
  piecesOut: number;
  /** Names the window in the tooltip. Must match what `piecesOut` counted. */
  windowLabel?: string;
  className?: string;
};

export function Wordmark({ piecesOut, windowLabel = "this month", className }: Props) {
  const em = wordmarkSpaceEm(piecesOut);
  const label = wordmarkSpaceLabel(piecesOut, windowLabel);
  const [first, second] = APP_WORDMARK_PARTS;

  return (
    <span
      role="img"
      aria-label={APP_WORDMARK}
      title={label}
      className={`inline-flex items-baseline whitespace-nowrap ${className ?? ""}`}
    >
      <span aria-hidden>{first}</span>
      {/*
        An empty inline-block rather than letter-spacing or a padded span: the
        gap has to be exactly `em` wide with nothing in it, and both of the
        alternatives leave the trailing space of the first word in play as well,
        which double-counts at large widths.

        The transition only ever fires on a client-side navigation that changes
        the count — on first paint the width is already correct.
      */}
      <span
        aria-hidden
        className="inline-block transition-[width] duration-500 ease-out"
        style={{ width: `${em}em` }}
      />
      <span aria-hidden>{second}</span>
    </span>
  );
}
