/**
 * Bag artwork for Pack mode.
 *
 * `lib/packing/silhouettes.ts` only ever carried metadata — a label, a typical
 * volume, an aspect ratio — so there was nothing to actually *look* at. Pack
 * mode puts the bag at the centre of the screen, which needs a picture.
 *
 * Drawn on a 120×120 box in the same monoline language as components/icons.tsx
 * (round caps and joins, generous radii, `currentColor`), but at a heavier
 * stroke because these render at 200px+ rather than 20px. A user who uploaded a
 * photo of their real bag gets that instead; this is the fallback, and the
 * default for everyone who hasn't.
 *
 * The fill level is drawn as a rising wash clipped to the bag's own outline, so
 * a 60%-full duffel looks 60% full.
 */

import type { SVGProps } from "react";

const BASE = {
  viewBox: "0 0 120 120",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 3.2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/**
 * Each bag as a closed body path plus its detail lines.
 *
 * `body` is kept separate because it doubles as the clip path for the fill
 * wash — the level has to stop at the bag's edge, not at a bounding box.
 */
const BAG_SHAPES: Record<string, { body: string; details: string[] }> = {
  tote: {
    body: "M22 44h76a4 4 0 0 1 4 4.3l-4.6 52A8 8 0 0 1 89.4 108H30.6a8 8 0 0 1-8-7.7l-4.6-52A4 4 0 0 1 22 44Z",
    details: ["M40 44V32a20 20 0 0 1 40 0v12"],
  },
  backpack: {
    body: "M30 46a30 30 0 0 1 60 0v54a8 8 0 0 1-8 8H38a8 8 0 0 1-8-8Z",
    details: [
      "M30 74h60",
      "M46 46V32a14 14 0 0 1 28 0v14",
      "M52 90h16a4 4 0 0 1 0 8H52a4 4 0 0 1 0-8Z",
    ],
  },
  carryon: {
    body: "M26 40h68a8 8 0 0 1 8 8v52a8 8 0 0 1-8 8H26a8 8 0 0 1-8-8V48a8 8 0 0 1 8-8Z",
    details: [
      "M60 40V16",
      "M44 16h32",
      "M18 66h84",
      "M34 108v6M86 108v6",
    ],
  },
  duffel: {
    body: "M18 54h84a10 10 0 0 1 10 10v26a10 10 0 0 1-10 10H18A10 10 0 0 1 8 90V64a10 10 0 0 1 10-10Z",
    details: ["M44 54V44a8 8 0 0 1 8-8h16a8 8 0 0 1 8 8v10", "M8 72h104"],
  },
  checked: {
    body: "M24 34h72a10 10 0 0 1 10 10v56a10 10 0 0 1-10 10H24a10 10 0 0 1-10-10V44a10 10 0 0 1 10-10Z",
    details: [
      "M14 58h92",
      "M60 34V12",
      "M46 12h28",
      "M40 76v14M80 76v14",
      "M30 110v6M90 110v6",
    ],
  },
};

const FALLBACK = BAG_SHAPES.duffel;

// `fill` is omitted deliberately: SVG already has one, and a prop of the same
// name typed as a number collapses the intersection to `never`. The fill level
// is `level`, which is clearer anyway.
export type BagArtProps = Omit<SVGProps<SVGSVGElement>, "children" | "fill"> & {
  /** Silhouette id from lib/packing/silhouettes.ts. Unknown ids draw a duffel. */
  silhouette: string;
  /**
   * How full the bag is, 0..1. Drawn as a wash rising inside the outline.
   * Values past 1 are clamped — the outline can't show more than "full", and
   * the meters say the overflow number.
   */
  level?: number;
  /** Tints the wash rose once the bag is over capacity. */
  over?: boolean;
};

export function BagArt({ silhouette, level: rawLevel = 0, over = false, ...props }: BagArtProps) {
  const shape = BAG_SHAPES[silhouette] ?? FALLBACK;
  const level = Math.min(1, Math.max(0, Number.isFinite(rawLevel) ? rawLevel : 0));
  // The wash rises from the bottom of the 120-box, so its top edge is at
  // 120 - level*120. At level 0 the rect is empty rather than a hairline.
  const clipId = `bag-fill-${silhouette}`;

  return (
    <svg {...BASE} aria-hidden focusable="false" {...props}>
      <defs>
        <clipPath id={clipId}>
          <path d={shape.body} />
        </clipPath>
      </defs>

      {level > 0 ? (
        <rect
          x="0"
          y={120 - level * 120}
          width="120"
          height={level * 120}
          clipPath={`url(#${clipId})`}
          fill="currentColor"
          className={over ? "text-rose-500/35" : "text-accent/35"}
          stroke="none"
        />
      ) : null}

      <path d={shape.body} />
      {shape.details.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
