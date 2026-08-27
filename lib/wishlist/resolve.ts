/**
 * Turn a pasted store link into the fields a wishlist row needs: name, brand,
 * price, retailer and a hero image.
 *
 * Order of attack:
 *   1. Scrape the PDP itself (schema.org/OpenGraph) — authoritative, and the
 *      image is the merchant's own hero shot.
 *   2. If the page yielded no price, ask Google Shopping (SerpAPI) about the
 *      scraped product name and borrow the price/thumbnail from the match.
 *
 * Anything we can't establish comes back null so the UI can ask the user
 * rather than showing a number nobody verified.
 */

import { tryImmersiveProductMetadata } from "../services/immersiveProduct";
import { isAggregatorProductUrl, parseBrandFromTitle } from "../shopping-parse";
import { scrapeProduct, type ProductMetadata } from "../services/productScraper";
import type { ProductMatch } from "../services/reverseImageSearch";
import { searchWebProducts } from "../services/webProductSearch";

export type ResolvedProduct = {
  name: string;
  brand: string | null;
  priceCents: number | null;
  currency: string;
  retailer: string | null;
  productUrl: string;
  imageUrl: string | null;
  colors: string[];
  material: string | null;
  /** Where the price came from — surfaced in the UI so an inferred price is visible as such. */
  priceSource: "merchant" | "shopping-search" | "none";
};

export type ResolveFailure = { ok: false; error: string };
export type ResolveSuccess = { ok: true; product: ResolvedProduct };

export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export async function resolveWishlistProduct(
  rawUrl: string,
): Promise<ResolveSuccess | ResolveFailure> {
  const url = rawUrl.trim();
  if (!isHttpUrl(url)) {
    return { ok: false, error: "That doesn't look like a link. Paste the product page URL." };
  }
  if (isAggregatorProductUrl(url)) {
    return {
      ok: false,
      error: "That's a Google Shopping link. Open the store's own product page and paste that URL.",
    };
  }

  let scraped: ProductMetadata | null = null;
  try {
    scraped = await scrapeProduct(url);
  } catch {
    scraped = null;
  }

  if (!scraped?.name) {
    return {
      ok: false,
      error: "Couldn't read that product page. Add it by hand, or try searching for it by name.",
    };
  }

  const base: ResolvedProduct = {
    name: scraped.name,
    brand: scraped.brand?.trim() || null,
    priceCents: scraped.priceCents > 0 ? scraped.priceCents : null,
    currency: scraped.currency || "USD",
    retailer: scraped.retailer?.trim() || null,
    productUrl: scraped.productUrl || url,
    imageUrl: scraped.imageUrls[0] ?? null,
    colors: scraped.colors ?? [],
    material: scraped.material,
    priceSource: scraped.priceCents > 0 ? "merchant" : "none",
  };

  if (base.priceCents != null) return { ok: true, product: base };

  const fallback = await priceFromShoppingSearch(base.name, base.brand);
  if (!fallback) return { ok: true, product: base };

  return {
    ok: true,
    product: {
      ...base,
      priceCents: fallback.priceCents,
      currency: fallback.currency || base.currency,
      imageUrl: base.imageUrl ?? fallback.thumbnailUrl,
      priceSource: "shopping-search",
    },
  };
}

async function priceFromShoppingSearch(
  name: string,
  brand: string | null,
): Promise<{ priceCents: number; currency: string; thumbnailUrl: string | null } | null> {
  const query = [brand, name].filter(Boolean).join(" ").trim();
  if (!query) return null;

  try {
    const matches = await searchWebProducts(query);
    const priced = matches.find((m) => m.priceCents > 0);
    if (!priced) return null;
    return {
      priceCents: priced.priceCents,
      currency: priced.currency || "USD",
      thumbnailUrl: priced.thumbnailUrl,
    };
  } catch {
    return null;
  }
}

/**
 * Turn a Google Shopping search hit into a wishlist row.
 *
 * The `url` on a shopping result is a Google redirect, not the shop — storing
 * it would give us a "buy at Nordstrom" button that lands on a search page,
 * and the price watcher would refuse to re-read it. The Immersive Product
 * endpoint hands back the merchant's own link, so we ask for that first and
 * only keep the aggregator URL if there's nothing better.
 */
export async function resolveSearchMatch(match: ProductMatch): Promise<ResolvedProduct> {
  const immersive = await tryImmersiveProductMetadata(match.immersiveProductPageToken);
  const storeUrl = immersive?.productUrl?.trim();
  const hasRealStoreUrl = !!storeUrl && isHttpUrl(storeUrl) && !isAggregatorProductUrl(storeUrl);

  // A gemini-identified match carries no price at all, so priceCents stays null
  // and the row waits for a pasted URL rather than being recorded as free.
  const priceCents =
    match.priceCents > 0
      ? match.priceCents
      : immersive && immersive.priceCents > 0
        ? immersive.priceCents
        : null;

  return {
    name: immersive?.name?.trim() || match.name,
    brand: immersive?.brand?.trim() || match.brand || parseBrandFromTitle(match.name),
    priceCents,
    currency: match.currency || immersive?.currency || "USD",
    retailer: immersive?.retailer?.trim() || match.retailer || null,
    productUrl: hasRealStoreUrl ? storeUrl : match.url,
    imageUrl: match.thumbnailUrl,
    colors: immersive?.colors ?? [],
    material: immersive?.material ?? null,
    priceSource: priceCents != null ? "shopping-search" : "none",
  };
}

/**
 * Re-read just the price for the price-drop watch. Never touches the row's
 * other fields.
 *
 * Scraping the merchant page is the cheap, authoritative path. Plenty of
 * storefronts render the price client-side though, so when the page yields
 * nothing we fall back to a shopping search on the item's name — otherwise
 * those rows would silently never be watched.
 */
export async function recheckPriceCents(
  url: string,
  name?: string | null,
  brand?: string | null,
): Promise<number | null> {
  if (isHttpUrl(url) && !isAggregatorProductUrl(url)) {
    try {
      const scraped = await scrapeProduct(url);
      if (scraped && scraped.priceCents > 0) return scraped.priceCents;
    } catch {
      /* fall through to the search fallback */
    }
  }

  if (!name?.trim()) return null;
  const fallback = await priceFromShoppingSearch(name, brand ?? null);
  return fallback?.priceCents ?? null;
}
