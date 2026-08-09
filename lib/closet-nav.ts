/**
 * The closet's global navigation. Pure data + matching so the drawer, and
 * anything else that wants to render these links, agree on one list.
 */

export type ClosetNavItem = {
  href: string;
  label: string;
  /** One-line explanation shown under the label in the drawer. */
  hint: string;
  /**
   * Name of an icon in the suite (see components/icons.tsx). Kept as a string
   * rather than a component so this stays a plain data module the tests can
   * import without pulling in JSX.
   */
  icon: string;
  /**
   * Only the exact path counts as active. Set for hub routes that are a prefix
   * of every other route (i.e. /closet), which would otherwise light up
   * everywhere.
   */
  exact?: boolean;
};

export const CLOSET_NAV: readonly ClosetNavItem[] = [
  { href: "/closet", label: "Closet", hint: "Everything you own", icon: "closet", exact: true },
  { href: "/closet/scan", label: "Scan roll", hint: "Find garments in your camera roll", icon: "scan" },
  { href: "/closet/try-on", label: "Try on", hint: "See it on you first", icon: "camera" },
  { href: "/closet/outfits", label: "Outfits", hint: "Build and save looks", icon: "hanger" },
  { href: "/closet/smartpakker", label: "Trip packing", hint: "Pack for the weather", icon: "suitcase" },
  { href: "/closet/sell", label: "Sell", hint: "What you've made, and what's left to list", icon: "tag" },
  { href: "/closet/wishlist", label: "Wishlist", hint: "What you want, and what it costs", icon: "heart" },
  { href: "/closet/share", label: "Share", hint: "Send a piece, a look, or your list", icon: "share" },
];

export const SETTINGS_HREF = "/settings";

/**
 * Is `href` the section the user is currently in? Non-exact entries match
 * their whole subtree, so /closet/sell/listings still highlights "Sell" —
 * but only on a path boundary, so /closet/sell-anything wouldn't.
 */
export function isNavItemActive(item: ClosetNavItem, pathname: string): boolean {
  const path = normalizePath(pathname);
  const href = normalizePath(item.href);

  if (path === href) return true;
  if (item.exact) return false;
  return path.startsWith(`${href}/`);
}

/** The most specific matching entry, so /closet never wins over /closet/sell. */
export function activeNavItem(
  pathname: string,
  items: readonly ClosetNavItem[] = CLOSET_NAV,
): ClosetNavItem | null {
  let best: ClosetNavItem | null = null;
  for (const item of items) {
    if (!isNavItemActive(item, pathname)) continue;
    if (!best || item.href.length > best.href.length) best = item;
  }
  return best;
}

/** Strip the trailing slash (but keep a bare "/") and any query or hash. */
function normalizePath(value: string): string {
  const path = value.split(/[?#]/)[0];
  if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);
  return path;
}
