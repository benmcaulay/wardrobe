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
    // Every editable field starts blank. The vision/search/scraper stubs still
    // run (their results are stashed in sourceData for debugging), but we
    // don't surface their guesses on the form because they're meaningless
    // until the real Claude-vision call is wired up. The category dropdown
    // gets vision.category as a starting point so the select isn't empty.
    name: "",
    brand: "",
    category: vision.category,
    subcategory: "",
    colors: [],
    priceCents: null,
    currency: "USD",
    retailer: "",
    productUrl: "",
    material: "",
    pattern: "",
    styleTags: [],
    season: [],
  };

  return {
    prefill,
    matches,
    sourceData: { vision, matches, scraped },
  };
}
