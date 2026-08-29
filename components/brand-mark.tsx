/**
 * The Making Space mark: two slabs and the gap between them.
 *
 * The subject of this logo is the empty part. Everything drawn is there to give
 * the gap an edge to be measured against, which is why every variant keeps the
 * same two ink slabs at the same coordinates and differs only in how it treats
 * the space — arrows, brackets, serifs, a scale, or a ghost of where the slab
 * used to be. Swapping variants should feel like changing your mind about one
 * thing, not picking a different logo.
 *
 * Five of them because this is still being chosen. `BRAND_MARK_VARIANTS` is the
 * registry (same shape as ICON_REGISTRY in components/icons.tsx) so
 * /design-lab/marks can enumerate them without this file knowing about the
 * page. Once one wins, delete the other four and the `variant` prop with them.
 *
 * Two colours, both from the palette rather than hardcoded: the slabs take
 * `currentColor` like the rest of the icon suite, and the measure defaults to
 * `--accent`, so the mark follows Paper and Space mode without a second asset.
 *
 * Drawn on a 32-unit grid. The slabs are 6 wide with a 12-wide gap, which is
 * the proportion that survives being scaled to a 16px favicon — at that size
 * the slabs land on 3 device pixels and the gap on 6, so it still reads as two
 * things with room between them rather than a smudge.
 */

export type BrandMarkVariant = "dimension" | "caliper" | "serif" | "scale" | "ghost";

export type BrandMarkProps = {
  variant?: BrandMarkVariant;
  /** Rendered size in px. The grid is resolution-independent. */
  size?: number;
  /** Overrides the measure colour. Defaults to the theme accent. */
  measure?: string;
  className?: string;
  /**
   * Accessible name. Omit for a decorative mark sitting next to the wordmark —
   * it defaults to hidden, because a logo announced twice is noise.
   */
  title?: string;
};

/** Slab geometry, shared by every variant so they stay siblings. */
const SLAB = { y: 6, w: 6, h: 20, rx: 1, leftX: 4, rightX: 22 } as const;
/** The gap: everything between the slabs' inner edges. */
const GAP = { from: SLAB.leftX + SLAB.w, to: SLAB.rightX, midY: 16 } as const;

export function BrandMark({
  variant = "dimension",
  size = 32,
  measure,
  className,
  title,
}: BrandMarkProps) {
  const measureColor = measure ?? "var(--accent)";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}

      {/* The slabs. `ghost` draws its own pair because one of them moved. */}
      {variant === "ghost" ? null : (
        <>
          <rect
            x={SLAB.leftX}
            y={SLAB.y}
            width={SLAB.w}
            height={SLAB.h}
            rx={SLAB.rx}
            fill="currentColor"
          />
          <rect
            x={SLAB.rightX}
            y={SLAB.y}
            width={SLAB.w}
            height={SLAB.h}
            rx={SLAB.rx}
            fill="currentColor"
          />
        </>
      )}

      {variant === "dimension" && <Dimension color={measureColor} />}
      {variant === "caliper" && <Caliper color={measureColor} />}
      {variant === "serif" && <Serif />}
      {variant === "scale" && <Scale color={measureColor} />}
      {variant === "ghost" && <Ghost color={measureColor} />}
    </svg>
  );
}

/**
 * Arrows pointing outward into the gap — the architect's dimension line.
 *
 * The most literal reading and the one that animates best: run the two heads
 * apart from the centre and the mark performs its own name.
 */
function Dimension({ color }: { color: string }) {
  return (
    <g fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d={`M${GAP.from + 2} ${GAP.midY} H${GAP.to - 2}`} />
      <path d={`M${GAP.from + 4.5} 13.5 L${GAP.from + 2} ${GAP.midY} L${GAP.from + 4.5} 18.5`} />
      <path d={`M${GAP.to - 4.5} 13.5 L${GAP.to - 2} ${GAP.midY} L${GAP.to - 4.5} 18.5`} />
    </g>
  );
}

/**
 * Two brackets facing each other across the gap.
 *
 * No arrowheads, which removes the one element that reads as "instruction"
 * rather than "measurement", and at 64px the brackets close into a frame that
 * is the handsomest of the five. The trade is at the other end: on the review
 * sheet the brackets merge into the slabs at 16px and the mark goes to a solid
 * blob, so this one needs a separate favicon drawing if it wins.
 */
function Caliper({ color }: { color: string }) {
  return (
    <g fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d={`M${GAP.from + 1} 9.5 V7 H${GAP.to - 1} V9.5`} />
      <path d={`M${GAP.from + 1} 22.5 V25 H${GAP.to - 1} V22.5`} />
    </g>
  );
}

/**
 * Serifs, no second colour.
 *
 * The slabs become two typographic stems, so the mark is a fragment of a
 * wordmark rather than a diagram — which sits closer to the Fraunces the app
 * actually sets its headings in. The only one-colour variant, and therefore the
 * only one that can be embossed, stamped, or faxed without a fallback.
 */
function Serif() {
  const foot = (x: number, y: number) => (
    <rect x={x - 2.5} y={y} width={SLAB.w + 5} height={1.8} rx={0.6} fill="currentColor" />
  );
  return (
    <>
      {foot(SLAB.leftX, SLAB.y)}
      {foot(SLAB.leftX, SLAB.y + SLAB.h - 1.8)}
      {foot(SLAB.rightX, SLAB.y)}
      {foot(SLAB.rightX, SLAB.y + SLAB.h - 1.8)}
    </>
  );
}

/**
 * A graduated scale across the floor of the gap.
 *
 * Measurement without the arrow cliché, and the only variant that implies the
 * gap has *units* — which is the closest the mark gets to the rail inches the
 * ledger reports (lib/space/ledger.ts). Tallest tick at the centre so it has a
 * midpoint to read from.
 */
function Scale({ color }: { color: string }) {
  const ticks = [12, 14, 16, 18, 20];
  return (
    <g stroke={color} strokeWidth={1.3} strokeLinecap="round">
      <path d={`M${GAP.from + 0.5} 21 H${GAP.to - 0.5}`} fill="none" />
      {ticks.map((x) => (
        <path key={x} d={`M${x} 21 V${x === 16 ? 16.5 : 18.6}`} fill="none" />
      ))}
    </g>
  );
}

/**
 * The slab that moved, and the outline of where it was.
 *
 * The only variant with a before and an after in it, so it states the verb in
 * the name rather than the noun — space being made, not space existing. Costs
 * the symmetry the other four have, which is either the point or the objection.
 */
function Ghost({ color }: { color: string }) {
  return (
    <>
      <rect
        x={SLAB.leftX}
        y={SLAB.y}
        width={SLAB.w}
        height={SLAB.h}
        rx={SLAB.rx}
        fill="currentColor"
      />
      {/* Where the right slab used to sit. Hairline so it reads as a memory. */}
      <rect
        x={14}
        y={SLAB.y}
        width={SLAB.w}
        height={SLAB.h}
        rx={SLAB.rx}
        fill="none"
        stroke={color}
        strokeWidth={1}
        strokeDasharray="2 2"
      />
      <rect
        x={SLAB.rightX}
        y={SLAB.y}
        width={SLAB.w}
        height={SLAB.h}
        rx={SLAB.rx}
        fill="currentColor"
      />
    </>
  );
}

/**
 * The five, with the argument for each.
 *
 * `note` is the trade-off rather than a description — a preview sheet that only
 * says what you can already see is not worth the page.
 */
export const BRAND_MARK_VARIANTS: readonly {
  id: BrandMarkVariant;
  label: string;
  note: string;
}[] = [
  {
    id: "dimension",
    label: "Dimension",
    note: "Arrows out. The most literal, and the one that animates into its own name.",
  },
  {
    id: "caliper",
    label: "Caliper",
    note: "Brackets, no heads. Best of the five at 64px; blobs at 16px and would need its own favicon.",
  },
  {
    id: "serif",
    label: "Serif",
    note: "One colour, typographic. Reads as a wordmark fragment rather than a diagram.",
  },
  {
    id: "scale",
    label: "Scale",
    note: "Graduated floor. The only one implying the gap has units, like rail inches.",
  },
  {
    id: "ghost",
    label: "Ghost",
    note: "Before and after. States the verb, not the noun — at the cost of symmetry.",
  },
];
