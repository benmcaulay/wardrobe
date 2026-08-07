"use client";

import { StarDollar } from "@/components/icons";

type Props = {
  /** Tailwind / arbitrary sizes, e.g. h-3.5 w-3.5 */
  className?: string;
  title?: string;
};

/**
 * Credits badge / inline icon (replaces ✨ in product UI).
 *
 * Draws the star-dollar from the icon suite rather than a raster: it inherits
 * the surrounding text colour and carries no background plate, so it sits
 * cleanly on paper, on the ink-filled active nav row, and on the amber
 * low-credits pill alike.
 */
export function CreditMark({
  className = "h-[1em] w-[1em] inline-block align-[-0.15em] shrink-0",
  title,
}: Props) {
  return (
    <StarDollar
      className={className}
      role={title ? "img" : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
    />
  );
}
