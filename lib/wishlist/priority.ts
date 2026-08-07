/**
 * Wishlist priority tiers. Stored as an Int on WardrobeItem so ordering is a
 * plain sort — lower is more urgent.
 */

export type WishlistPriority = 0 | 1 | 2;

export const PRIORITY_MUST = 0;
export const PRIORITY_WANT = 1;
export const PRIORITY_SOMEDAY = 2;

export const PRIORITY_OPTIONS: readonly {
  value: WishlistPriority;
  label: string;
  hint: string;
}[] = [
  { value: PRIORITY_MUST, label: "Must have", hint: "Buy this first" },
  { value: PRIORITY_WANT, label: "Want", hint: "Buy if the money stretches" },
  { value: PRIORITY_SOMEDAY, label: "Someday", hint: "Parked — not this round" },
];

const BY_VALUE = new Map(PRIORITY_OPTIONS.map((p) => [p.value, p]));

export function isWishlistPriority(value: number): value is WishlistPriority {
  return BY_VALUE.has(value as WishlistPriority);
}

/** Clamp any stored int into a known tier so bad data can't break sorting. */
export function normalizePriority(value: number | null | undefined): WishlistPriority {
  if (value == null || !isWishlistPriority(value)) return PRIORITY_WANT;
  return value;
}

export function priorityLabel(value: number | null | undefined): string {
  return BY_VALUE.get(normalizePriority(value))?.label ?? "Want";
}

/**
 * Cents → the string to seed a dollar input with. Whole dollars stay short
 * ("100"), anything else keeps both decimal places so $29.90 doesn't render
 * as the lopsided "29.9".
 */
export function centsToInput(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents) || cents <= 0) return "";
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}
