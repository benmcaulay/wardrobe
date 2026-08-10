/**
 * Perceptual colour harmony (docs/OUTFIT_INTELLIGENCE.md §4, Layer 1).
 *
 * Colour carries this layer. On the measured closet it is 100% populated while
 * `styleTags` is 7.2%, `material` 3.3% and `season` 0% — see the header of
 * lib/packing/palette.ts. Any scorer that leans on the sparse fields is mostly
 * scoring absence, so the weighting here is deliberate rather than an accident
 * of what was easy.
 *
 * This goes beyond the name-based roles in lib/packing/palette.ts, which answer
 * "is this a statement colour?" from a closed 15-name vocabulary. Items also
 * store a hex, and hex supports the question that actually matters for pairing:
 * *how* do two colours relate — same family, opposite, or the muddy in-between
 * that reads as a mistake. That needs a perceptual space; it cannot be done in
 * sRGB, where equal numeric steps are wildly unequal to the eye.
 *
 * Pure and dependency-free, so it runs client-side like lib/packing.
 */

import type { Color } from "@/lib/json";
import { colorRole } from "@/lib/packing/palette";

export type Lab = { l: number; a: number; b: number };
export type LCh = { l: number; c: number; h: number };

/** sRGB gamma expansion to linear-light. */
function toLinear(channel: number): number {
  const v = channel / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function hexToRgb(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const int = Number.parseInt(match[1], 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

/** D65 reference white, the illuminant sRGB is defined against. */
const WHITE = { x: 95.047, y: 100.0, z: 108.883 };

function pivot(t: number): number {
  return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
}

export function hexToLab(hex: string): Lab | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;

  const [r, g, b] = rgb.map(toLinear);
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) * 100;
  const y = (r * 0.2126 + g * 0.7152 + b * 0.0722) * 100;
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) * 100;

  const fx = pivot(x / WHITE.x);
  const fy = pivot(y / WHITE.y);
  const fz = pivot(z / WHITE.z);

  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

export function labToLCh(lab: Lab): LCh {
  const c = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
  let h = (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: lab.l, c, h };
}

export function hexToLCh(hex: string): LCh | null {
  const lab = hexToLab(hex);
  return lab ? labToLCh(lab) : null;
}

/** CIE76 ΔE. Crude next to CIEDE2000, but we only need "close / far", not a
 *  just-noticeable-difference threshold, and the extra machinery would be
 *  precision this input doesn't have. */
export function deltaE(a: Lab, b: Lab): number {
  return Math.sqrt((a.l - b.l) ** 2 + (a.a - b.a) ** 2 + (a.b - b.b) ** 2);
}

/**
 * Below this chroma a colour behaves as a neutral — it sits with anything, and
 * its hue angle is numerically unstable anyway (the hue of a near-grey is
 * essentially noise, so comparing it to another hue is meaningless).
 */
export const NEUTRAL_CHROMA = 18;

export function isPerceptuallyNeutral(lch: LCh): boolean {
  return lch.c < NEUTRAL_CHROMA;
}

/** Shortest angular distance between two hues, 0..180. */
export function hueDistance(h1: number, h2: number): number {
  const raw = Math.abs(h1 - h2) % 360;
  return raw > 180 ? 360 - raw : raw;
}

export type HueRelation =
  | "monochrome"
  | "analogous"
  | "complementary"
  | "triadic"
  | "discordant";

/**
 * Classify how two hues relate.
 *
 * The named relations are the ones that read as deliberate. Everything else is
 * "discordant" — not ugly by law, but the in-between intervals (a red with an
 * orange-yellow, say) are the ones that look like the second item was picked in
 * the dark. A rule can catch that reliably, which is most of the value.
 */
export function hueRelation(h1: number, h2: number): HueRelation {
  const d = hueDistance(h1, h2);
  if (d <= 12) return "monochrome";
  if (d <= 45) return "analogous";
  if (d >= 160) return "complementary";
  if (d >= 105 && d <= 135) return "triadic";
  return "discordant";
}

const RELATION_SCORE: Record<HueRelation, number> = {
  monochrome: 0.92,
  analogous: 0.88,
  complementary: 0.8,
  triadic: 0.68,
  discordant: 0.32,
};

/** A neutral beside anything is the safest pairing there is. */
const NEUTRAL_PAIR_SCORE = 0.95;
/** Two neutrals: safe, but a whole outfit of them is flat rather than good. */
const BOTH_NEUTRAL_SCORE = 0.88;
/** No usable hex on one side — don't reward, don't punish. */
export const UNKNOWN_PAIR_SCORE = 0.6;

/**
 * Two colours that share a hue but sit at nearly the same lightness read muddy
 * — the eye can't tell whether the match was intended or missed. Real monochrome
 * dressing separates the values.
 */
const MUDDY_LIGHTNESS_GAP = 8;
const MUDDY_PENALTY = 0.22;

/** Harmony of two hex colours, 0..1. */
export function pairHarmony(hexA: string, hexB: string): number {
  const a = hexToLCh(hexA);
  const b = hexToLCh(hexB);
  if (!a || !b) return UNKNOWN_PAIR_SCORE;

  const aNeutral = isPerceptuallyNeutral(a);
  const bNeutral = isPerceptuallyNeutral(b);
  if (aNeutral && bNeutral) return BOTH_NEUTRAL_SCORE;
  if (aNeutral || bNeutral) return NEUTRAL_PAIR_SCORE;

  const relation = hueRelation(a.h, b.h);
  let score = RELATION_SCORE[relation];

  if (
    (relation === "monochrome" || relation === "analogous") &&
    Math.abs(a.l - b.l) < MUDDY_LIGHTNESS_GAP
  ) {
    score -= MUDDY_PENALTY;
  }

  return Math.min(1, Math.max(0, score));
}

/** Dominant colour of an item — the first listed, which is how the picker orders them. */
export function dominantColor(colors: readonly Color[] | undefined | null): Color | null {
  return colors?.find((c) => c?.hex && c.hex.trim().length > 0) ?? null;
}

/**
 * Harmony between two garments, judged on their dominant colours.
 *
 * Dominant-only rather than every pairwise combination: a graphic tee with six
 * colours would otherwise drag every score toward the mean and make busy items
 * look uniformly mediocre instead of specifically hard to place. Busy-ness is
 * already priced by `colorVersatility` in lib/packing/palette.ts.
 *
 * Falls back to the name-based role when hex is missing, so items from older
 * imports still score rather than dropping to neutral-unknown.
 */
export function itemColorHarmony(
  a: readonly Color[] | undefined | null,
  b: readonly Color[] | undefined | null,
): number {
  const first = dominantColor(a);
  const second = dominantColor(b);
  if (!first || !second) return UNKNOWN_PAIR_SCORE;

  const harmony = pairHarmony(first.hex, second.hex);
  if (harmony !== UNKNOWN_PAIR_SCORE) return harmony;

  // Hex unusable on at least one side: fall back to the closed-vocabulary roles.
  const roleA = first.name ? colorRole(first.name) : "accent";
  const roleB = second.name ? colorRole(second.name) : "accent";
  if (roleA !== "accent" || roleB !== "accent") return NEUTRAL_PAIR_SCORE;
  return UNKNOWN_PAIR_SCORE;
}

/**
 * Harmony across a whole look: the mean of its pairwise scores, dragged toward
 * the worst pair.
 *
 * A plain mean lets three good pairings hide one genuine clash, which is the
 * failure people actually notice — an outfit is judged by its worst element,
 * not its average one.
 */
export const WORST_PAIR_WEIGHT = 0.4;

export function outfitColorHarmony(
  items: readonly { colors?: Color[] | null }[],
): number {
  const usable = items.filter((item) => dominantColor(item.colors) != null);
  if (usable.length < 2) return UNKNOWN_PAIR_SCORE;

  let total = 0;
  let count = 0;
  let worst = 1;
  for (let i = 0; i < usable.length; i += 1) {
    for (let j = i + 1; j < usable.length; j += 1) {
      const score = itemColorHarmony(usable[i].colors, usable[j].colors);
      total += score;
      count += 1;
      if (score < worst) worst = score;
    }
  }
  if (count === 0) return UNKNOWN_PAIR_SCORE;

  const mean = total / count;
  return mean * (1 - WORST_PAIR_WEIGHT) + worst * WORST_PAIR_WEIGHT;
}
