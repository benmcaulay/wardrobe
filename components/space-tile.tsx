"use client";

/**
 * The two doors out of the trip plan.
 *
 * Pack mode and the looks carousel are the parts of this feature worth looking
 * at, and they were reached by two ordinary buttons sitting in a row of
 * ordinary buttons. These are a matched pair instead: same size, same
 * structure, mirrored — one glyph on the left and its text on the right, the
 * other reversed — so they read as two halves of one choice rather than two
 * items on a list.
 *
 * Each glyph is a still of the thing behind it. The bag with its ring of
 * satellites is the orbit; the fanned cards are the carousel. On hover they
 * start doing what the real page does, which is a promise the page then keeps.
 */

import type { ReactNode } from "react";

export type SpaceTileProps = {
  title: string;
  /** One line under the title: what's in there right now. */
  summary: ReactNode;
  glyph: "orbit" | "carousel";
  /** Which side the art sits on. The pair should disagree. */
  align?: "left" | "right";
  disabled?: boolean;
  onClick: () => void;
};

export function SpaceTile({
  title,
  summary,
  glyph,
  align = "left",
  disabled = false,
  onClick,
}: SpaceTileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`group relative flex flex-1 items-center gap-4 overflow-hidden rounded-2xl border border-accent/60 bg-accent/15 p-5 text-left
        shadow-tile transition hover:-translate-y-0.5 hover:border-accent hover:bg-accent/25
        disabled:pointer-events-none disabled:translate-y-0 disabled:opacity-40
        ${align === "right" ? "flex-row-reverse text-right" : ""}`}
    >
      <span className="shrink-0 text-ink">
        {glyph === "orbit" ? <OrbitGlyph /> : <CarouselGlyph />}
      </span>
      <span className="min-w-0">
        <span className="block font-serif text-2xl tracking-tight">{title}</span>
        {/* Wraps rather than truncates: on a phone these lines are wider than
            the tile, and the counts are the whole point of showing them. Two
            lines is the cap, and the row stretches both tiles to match. */}
        <span className="mt-0.5 line-clamp-2 block text-xs text-ink-muted">{summary}</span>
      </span>

      {/* A sweep of light across the tile on hover. Purely decorative, and the
          app's prefers-reduced-motion rule turns the transition off for free. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 -left-full w-1/2 -skew-x-12 bg-paper/40 transition-all duration-700 group-hover:left-[150%]"
      />
    </button>
  );
}

/**
 * A bag with three satellites. Mirrors Pack mode's orbit — the ring tilts and
 * the satellites swing round a little on hover.
 */
function OrbitGlyph() {
  return (
    <svg
      width="56"
      height="56"
      viewBox="0 0 56 56"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <ellipse
        cx="28"
        cy="28"
        rx="24"
        ry="9"
        className="origin-center opacity-30 transition-transform duration-700 group-hover:-rotate-12"
      />
      <g className="origin-center transition-transform duration-700 group-hover:rotate-[40deg]">
        <circle cx="52" cy="28" r="3" fill="currentColor" stroke="none" className="opacity-70" />
        <circle cx="16" cy="35.8" r="2.4" fill="currentColor" stroke="none" className="opacity-45" />
        <circle cx="40" cy="20.2" r="2.4" fill="currentColor" stroke="none" className="opacity-45" />
      </g>
      {/* The bag, echoing components/bag-art.tsx's duffel. */}
      <path d="M16 24h24a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4H16a4 4 0 0 1-4-4v-8a4 4 0 0 1 4-4Z" />
      <path d="M24 24v-3a3 3 0 0 1 3-3h2a3 3 0 0 1 3 3v3" />
    </svg>
  );
}

/**
 * Three cards on an arc, the middle one forward. Mirrors the looks carousel —
 * the outer two spread further on hover, as if the ring were turning.
 */
function CarouselGlyph() {
  return (
    <svg
      width="56"
      height="56"
      viewBox="0 0 56 56"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect
        x="4"
        y="18"
        width="14"
        height="20"
        rx="3"
        className="opacity-55 transition-transform duration-500 group-hover:-translate-x-1.5"
      />
      <rect
        x="38"
        y="18"
        width="14"
        height="20"
        rx="3"
        className="opacity-55 transition-transform duration-500 group-hover:translate-x-1.5"
      />
      <rect
        x="18"
        y="12"
        width="20"
        height="32"
        rx="4"
        className="origin-center transition-transform duration-500 group-hover:scale-105"
        fill="var(--paper)"
      />
    </svg>
  );
}
