/**
 * Colour reasoning for packing.
 *
 * Colour is the only rich structured signal this closet actually has. Measured
 * on a real 180-item wardrobe: 100% of items carry colours, drawn from a closed
 * 15-name vocabulary, mean 1.85 colours per item. By contrast `season` is 0%
 * populated, `material` 3.3%, `styleTags` 7.2%. So colour is where selection
 * intelligence has to come from — see the memory note on designing around the
 * empty fields rather than backfilling them.
 *
 * The idea it encodes is the oldest rule in packing: a capsule works because
 * most of it is neutral, so any top goes with any bottom. A black tee earns its
 * litre several times over; a neon-orange one goes with two things you own.
 *
 * Pure, no dependencies, runs client-side like the rest of lib/packing.
 */
import type { Color } from "@/lib/json";

/**
 * True neutrals — they combine with essentially anything, so they carry a
 * capsule. Spelling variants included because colour names come from several
 * sources (manual entry, AI tagging, retailer scrapes).
 */
const NEUTRAL = new Set([
  "black",
  "white",
  "gray",
  "grey",
  "charcoal",
  "beige",
  "cream",
  "ivory",
  "tan",
  "stone",
  "off-white",
]);

/**
 * Near-neutrals. Navy and denim blue function as neutrals in practice, and the
 * earth tones (brown, olive, khaki, cognac) combine with most of a wardrobe
 * without being true blank slates.
 */
const SEMI_NEUTRAL = new Set([
  "navy",
  "blue",
  "denim",
  "brown",
  "olive",
  "khaki",
  "cognac",
  "camel",
  "burgundy",
]);

export type ColorRole = "neutral" | "semi" | "accent";

export function colorRole(name: string): ColorRole {
  const key = name.trim().toLowerCase();
  if (NEUTRAL.has(key)) return "neutral";
  if (SEMI_NEUTRAL.has(key)) return "semi";
  return "accent";
}

const ROLE_VALUE: Record<ColorRole, number> = {
  neutral: 1,
  semi: 0.7,
  accent: 0.25,
};

/**
 * Versatility of an item with no colour data at all. Deliberately mid-range:
 * missing data should not be scored as if it were a neon print, nor rewarded
 * as if it were black.
 */
const UNKNOWN_VERSATILITY = 0.6;

/** Each colour past the second makes a piece harder to combine. */
const BUSY_PENALTY_PER_EXTRA_COLOR = 0.15;

/**
 * How easily this piece combines with the rest of a wardrobe, 0..1.
 *
 * Mean of its colours' roles, damped by how many colours it has — an
 * eight-colour graphic tee is genuinely harder to build outfits around than a
 * two-tone one, and the measured closet does contain items with up to 8.
 */
export function colorVersatility(colors: readonly Color[] | undefined | null): number {
  if (!colors || colors.length === 0) return UNKNOWN_VERSATILITY;

  const named = colors.map((c) => c?.name).filter((n): n is string => !!n && n.trim().length > 0);
  if (named.length === 0) return UNKNOWN_VERSATILITY;

  const mean = named.reduce((sum, n) => sum + ROLE_VALUE[colorRole(n)], 0) / named.length;
  const busy = 1 / (1 + BUSY_PENALTY_PER_EXTRA_COLOR * Math.max(0, named.length - 2));
  return Math.min(1, Math.max(0, mean * busy));
}

/**
 * The role of a piece's dominant colour — the first one listed, which is how
 * the colour picker orders them.
 *
 * Unknown colour data reports "neutral" on purpose: an untagged piece should
 * never be the thing that makes an outfit read as a colour clash, because we
 * have no evidence that it does.
 */
export function dominantRole(colors: readonly Color[] | undefined | null): ColorRole {
  const first = colors?.find((c) => c?.name && c.name.trim().length > 0);
  return first ? colorRole(first.name) : "neutral";
}

/** True when every named colour is a true or near neutral. */
export function isNeutralPiece(colors: readonly Color[] | undefined | null): boolean {
  if (!colors || colors.length === 0) return false;
  const named = colors.map((c) => c?.name).filter((n): n is string => !!n);
  if (named.length === 0) return false;
  return named.every((n) => colorRole(n) !== "accent");
}
