/**
 * Renders a marketplace's official mark in one colour.
 *
 * Sized by *height* with width left to the mark's own aspect ratio, which is
 * how logo lockups are normally set — a row of them then shares an optical
 * baseline even though "depop" is six times wider than the Facebook "f".
 *
 * The artwork and its provenance live in lib/sell/marketplace-marks.ts.
 */
import { getMarketplace, type MarketplaceId } from "@/lib/marketplaces";
import { MARKETPLACE_MARKS } from "@/lib/sell/marketplace-marks";

/** Default mark height in px. Roughly the cap-height of 13px body text. */
const DEFAULT_HEIGHT = 13;

/**
 * Wordmarks vary wildly in aspect — Poshmark's is 8:1, eBay's 2.5:1 — so
 * scaling them all to one height makes Poshmark enormous. Fitting each inside
 * a box instead keeps the row balanced: tall-ish marks hit the height limit,
 * very wide ones hit the width limit.
 */
const WORDMARK_MAX_WIDTH = 84;

export function MarketplaceMark({
  platform,
  height = DEFAULT_HEIGHT,
  className,
}: {
  platform: MarketplaceId;
  height?: number;
  className?: string;
}) {
  const mark = MARKETPLACE_MARKS[platform];
  const label = mark?.label ?? getMarketplace(platform)?.label ?? platform;

  // No licensed artwork (Grailed) — set the name instead. Uppercase and
  // tracked out so it still reads as a mark rather than as body copy.
  if (!mark) {
    return (
      <span
        className={className}
        style={{ fontSize: height * 0.85, letterSpacing: "0.13em", fontWeight: 500 }}
      >
        {label.toUpperCase()}
      </span>
    );
  }

  // Fit inside (maxWidth × height) without distorting: scale by whichever
  // dimension runs out first. The viewBox is cropped to the mark's real ink
  // bounds, so this is true optical sizing rather than box sizing.
  const [, , vbWidth, vbHeight] = mark.viewBox.split(/\s+/).map(Number);
  const maxWidth = mark.kind === "wordmark" ? WORDMARK_MAX_WIDTH : height * 4;
  const scale = Math.min(height / vbHeight, maxWidth / vbWidth);
  const width = vbWidth * scale;
  const renderHeight = vbHeight * scale;

  const svg = (
    <svg
      viewBox={mark.viewBox}
      width={width}
      height={renderHeight}
      fill="currentColor"
      role="img"
      aria-label={label}
      focusable="false"
      style={{ display: "block", flex: "0 0 auto" }}
    >
      {mark.paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );

  // A glyph doesn't say its own name, so pair it with one.
  if (mark.kind === "glyph") {
    return (
      <span className={className} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        {svg}
        <span style={{ fontSize: height, fontWeight: 500, letterSpacing: "-0.01em" }}>{label}</span>
      </span>
    );
  }

  return <span className={className}>{svg}</span>;
}

/** The brand colour, for the hover/active treatment. */
export function marketplaceColor(platform: MarketplaceId): string {
  return MARKETPLACE_MARKS[platform]?.color ?? "var(--ink)";
}
