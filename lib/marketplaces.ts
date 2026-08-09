/**
 * Resale marketplaces we deep-link into.
 *
 * Auto-posting is not uniformly impossible — an earlier version of this file
 * claimed it was, and that was wrong about eBay. The actual picture, by
 * `integration`:
 *
 *   "open"    eBay. A documented public seller API that genuinely creates live
 *             listings: createInventoryItem → createOffer → publishOffer. Open
 *             to any developer via the eBay Developers Program; needs OAuth
 *             user consent and the seller opted in to eBay business policies.
 *             We could post here for real. See docs/ for the integration plan.
 *
 *   "gated"   Facebook Marketplace, Vinted. An API exists but we can't get at
 *             it. Meta's Marketplace Partner APIs are approval-only and aimed
 *             at vehicle/property/jobs partners and large merchants; Vinted's
 *             Pro Integrations API is for business sellers, not individuals.
 *
 *   "none"    Depop, Poshmark, Mercari, Grailed. No public listing API at any
 *             tier. Every cross-listing tool on the market drives these with a
 *             browser extension, which is a different product with different
 *             terms-of-service exposure.
 *
 * Until an integration is actually built, all seven behave the same way: the UI
 * generates a copy-ready draft and opens the marketplace's "new listing" page.
 * `prefillSupported` tracks URL-level prefill, which none of them support.
 */
export type MarketplaceId =
  | "depop"
  | "poshmark"
  | "mercari"
  | "vinted"
  | "ebay"
  | "grailed"
  | "facebook";

/**
 * How close this marketplace is to us being able to post on the user's behalf.
 * "open" is the only one worth building against; see the module comment.
 */
export type MarketplaceIntegration = "open" | "gated" | "none";

export type Marketplace = {
  id: MarketplaceId;
  label: string;
  /** Where the "sell / create listing" flow lives. Opened in a new tab. */
  sellUrl: string;
  /** True only if listing fields can be prefilled via URL/query (none today). */
  prefillSupported: boolean;
  /** Whether a listing API exists and whether we could actually reach it. */
  integration: MarketplaceIntegration;
  /** Short note shown in the UI about how this one works. */
  note?: string;
};

export const MARKETPLACES: Marketplace[] = [
  {
    id: "depop",
    label: "Depop",
    sellUrl: "https://www.depop.com/sell/",
    prefillSupported: false,
    integration: "none",
    note: "Listing is easiest in the Depop app.",
  },
  {
    id: "poshmark",
    label: "Poshmark",
    sellUrl: "https://poshmark.com/create-listing",
    prefillSupported: false,
    integration: "none",
  },
  {
    id: "mercari",
    label: "Mercari",
    sellUrl: "https://www.mercari.com/sell/",
    prefillSupported: false,
    integration: "none",
  },
  {
    id: "vinted",
    label: "Vinted",
    sellUrl: "https://www.vinted.com/items/new",
    prefillSupported: false,
    integration: "gated",
  },
  {
    id: "ebay",
    label: "eBay",
    sellUrl: "https://www.ebay.com/sl/sell",
    prefillSupported: false,
    integration: "open",
  },
  {
    id: "grailed",
    label: "Grailed",
    sellUrl: "https://www.grailed.com/sell",
    prefillSupported: false,
    integration: "none",
    note: "Best for menswear & designer pieces.",
  },
  {
    id: "facebook",
    label: "FB Marketplace",
    sellUrl: "https://www.facebook.com/marketplace/create/item",
    prefillSupported: false,
    integration: "gated",
  },
];

const MARKETPLACE_BY_ID = new Map<string, Marketplace>(MARKETPLACES.map((m) => [m.id, m]));

export function getMarketplace(id: string): Marketplace | undefined {
  return MARKETPLACE_BY_ID.get(id);
}

export function isMarketplaceId(value: string): value is MarketplaceId {
  return MARKETPLACE_BY_ID.has(value);
}

/** Keep only known marketplace ids, de-duplicated and in canonical order. */
export function sanitizeMarketplaceIds(ids: readonly string[]): MarketplaceId[] {
  const set = new Set(ids.filter(isMarketplaceId));
  return MARKETPLACES.filter((m) => set.has(m.id)).map((m) => m.id);
}
