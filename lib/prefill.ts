import { analyzeGarment, type VisionResult } from "./services/vision";
import { reverseImageSearch, type ProductMatch } from "./services/reverseImageSearch";
import { scrapeProduct, type ProductMetadata } from "./services/productScraper";

export type PrefillResult = {
  name: string;
  brand: string;
  category: VisionResult["category"];
  subcategory: string;
  colors: VisionResult["colors"];
  priceCents: number | null;
  currency: string;
  retailer: string;
  productUrl: string;
  material: string;
  pattern: string | null;
  styleTags: string[];
  season: VisionResult["season"];
};

export type PrefillBundle = {
  prefill: PrefillResult;
  matches: ProductMatch[];
  /** Raw responses from every stub — stashed on the item as sourceData for debugging. */
  sourceData: {
    vision: VisionResult;
    matches: ProductMatch[];
    scraped: ProductMetadata | null;
  };
};

/**
 * Run vision + reverse-image-search in parallel against an already-saved
 * image path, then (serially) scrape the top match for extra metadata, and
 * merge everything into a single pre-fill blob for the confirmation form.
 */
export async function runPrefill(originalImagePath: string): Promise<PrefillBundle> {
  const [vision, matches] = await Promise.all([
    analyzeGarment(originalImagePath),
    reverseImageSearch(originalImagePath),
  ]);
  const topMatch = matches[0] ?? null;
  const scraped = topMatch ? await scrapeProduct(topMatch.url) : null;

  const prefill: PrefillResult = {
    // Name / brand / productUrl / styleTags are intentionally left blank so
    // we don't surface the stub's fake guesses. The user fills these in.
    name: "",
    brand: "",
    category: vision.category,
    subcategory: vision.subcategory,
    colors: vision.colors,
    priceCents: topMatch?.priceCents ?? scraped?.priceCents ?? null,
    currency: topMatch?.currency ?? scraped?.currency ?? "USD",
    retailer: topMatch?.retailer ?? scraped?.retailer ?? "",
    productUrl: "",
    // Default material: cotton for everything except shoes (where assuming a
    // material is more wrong than right).
    material: vision.category === "shoes" ? "" : "cotton",
    pattern: vision.pattern,
    styleTags: [],
    season: vision.season,
  };

  return {
    prefill,
    matches,
    sourceData: { vision, matches, scraped },
  };
}
