/**
 * Resale marketplaces we deep-link into. None of these expose a public API for
 * creating listings programmatically, so we can't auto-post — the UI generates
 * a copy-ready draft and opens the marketplace's "new listing" page in a tab.
 * `prefillSupported` stays false everywhere until that ever changes.
 */
export type MarketplaceId =
  | "depop"
  | "poshmark"
  | "mercari"
  | "vinted"
  | "ebay"
  | "grailed"
  | "facebook";

export type Marketplace = {
  id: MarketplaceId;
  label: string;
  /** Where the "sell / create listing" flow lives. Opened in a new tab. */
  sellUrl: string;
  /** True only if listing fields can be prefilled via URL/query (none today). */
  prefillSupported: boolean;
  /** Short note shown in the UI about how this one works. */
  note?: string;
};

export const MARKETPLACES: Marketplace[] = [
  {
    id: "depop",
    label: "Depop",
    sellUrl: "https://www.depop.com/sell/",
    prefillSupported: false,
    note: "Listing is easiest in the Depop app.",
  },
  {
    id: "poshmark",
    label: "Poshmark",
    sellUrl: "https://poshmark.com/create-listing",
    prefillSupported: false,
  },
  {
    id: "mercari",
    label: "Mercari",
    sellUrl: "https://www.mercari.com/sell/",
    prefillSupported: false,
  },
  {
    id: "vinted",
    label: "Vinted",
    sellUrl: "https://www.vinted.com/items/new",
    prefillSupported: false,
  },
  {
    id: "ebay",
    label: "eBay",
    sellUrl: "https://www.ebay.com/sl/sell",
    prefillSupported: false,
  },
  {
    id: "grailed",
    label: "Grailed",
    sellUrl: "https://www.grailed.com/sell",
    prefillSupported: false,
    note: "Best for menswear & designer pieces.",
  },
  {
    id: "facebook",
    label: "FB Marketplace",
    sellUrl: "https://www.facebook.com/marketplace/create/item",
    prefillSupported: false,
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
