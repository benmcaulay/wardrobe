import type { Color } from "./json";
import { isAggregatorProductUrl, parseBrandFromTitle } from "./shopping-parse";
import type { PrefillResult } from "./prefill";
import type { ProductMatch } from "./services/reverseImageSearch";
import type { ProductMetadata } from "./services/productScraper";
import { scrapeProduct } from "./services/productScraper";
import { tryImmersiveProductMetadata } from "./services/immersiveProduct";
import type { ItemFormValue } from "./types";

const COLOR_NAME_TO_HEX: Record<string, string> = {
  black: "#1a1a1a",
  ivory: "#f5f0e8",
  charcoal: "#36454f",
  sage: "#9caf88",
  terracotta: "#c67b5c",
  indigo: "#3f51b5",
  sand: "#c2b280",
  cognac: "#9a463d",
  cream: "#fffdd0",
  olive: "#708238",
  white: "#fafafa",
  gray: "#9e9e9e",
  grey: "#9e9e9e",
  navy: "#1e3a5f",
  red: "#c62828",
  blue: "#1565c0",
  green: "#2e7d32",
  brown: "#6d4c41",
  beige: "#d7ccc8",
  pink: "#f48fb1",
};

function colorsFromNames(names: string[]): Color[] {
  const out: Color[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const hex = COLOR_NAME_TO_HEX[key] ?? "#888888";
    out.push({ name, hex });
  }
  return out;
}

function matchBrand(match: ProductMatch): string {
  return match.brand || parseBrandFromTitle(match.name) || match.retailer;
}

function trustedScrape(scraped: ProductMetadata | null | undefined): ProductMetadata | null {
  if (!scraped) return null;
  if (isAggregatorProductUrl(scraped.productUrl)) return null;
  return scraped;
}

/**
 * Resolve listing metadata: Immersive Product (SerpAPI) when available, else
 * direct URL scrape for real merchant PDPs. Never returns aggregator junk.
 */
export async function resolveProductMetadata(match: ProductMatch): Promise<ProductMetadata | null> {
  const immersive = await tryImmersiveProductMetadata(match.immersiveProductPageToken);
  if (immersive?.name) return immersive;

  if (!isAggregatorProductUrl(match.url)) {
    try {
      return trustedScrape(await scrapeProduct(match.url));
    } catch {
      return null;
    }
  }

  return null;
}

/** Map web / lens match (+ optional enrichment) into form + prefill fields. */
export function productMatchToFormPatch(
  match: ProductMatch,
  enriched?: ProductMetadata | null,
): Partial<ItemFormValue> & { retailer?: string; productUrl?: string } {
  const extra = trustedScrape(enriched);
  const brand = extra?.brand?.trim() || matchBrand(match);
  const priceCents =
    extra?.priceCents && extra.priceCents > 0
      ? extra.priceCents
      : match.priceCents > 0
        ? match.priceCents
        : null;

  return {
    name: extra?.name?.trim() || match.name,
    brand,
    priceCents,
    currency: extra?.currency || match.currency,
    material: extra?.material?.trim() ?? "",
    colors: extra?.colors?.length ? colorsFromNames(extra.colors) : [],
    retailer: extra?.retailer?.trim() || match.retailer,
    productUrl: extra?.productUrl?.trim() || match.url,
  };
}

export function productMatchToPrefill(
  match: ProductMatch,
  enriched?: ProductMetadata | null,
): PrefillResult {
  const patch = productMatchToFormPatch(match, enriched);
  return {
    name: patch.name ?? "",
    brand: patch.brand ?? "",
    category: "",
    subcategory: "",
    colors: patch.colors ?? [],
    priceCents: patch.priceCents ?? null,
    currency: patch.currency ?? "USD",
    retailer: patch.retailer ?? "",
    productUrl: patch.productUrl ?? "",
    material: patch.material ?? "",
    pattern: "",
    styleTags: [],
    season: [],
  };
}
