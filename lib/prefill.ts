import type { Color } from "./json";
import type { Season } from "./types";
import { NONE_CATEGORY } from "./categories";
import { productMatchToPrefill } from "./product-match";
import { reverseImageSearch, type ProductMatch } from "./services/reverseImageSearch";
import { scrapeProduct, type ProductMetadata } from "./services/productScraper";
import { webMatchAutofillEnabled } from "./web-match-autofill";

export type PrefillResult = {
  name: string;
  brand: string;
  category: string;
  subcategory: string;
  colors: Color[];
  priceCents: number | null;
  currency: string;
  retailer: string;
  productUrl: string;
  material: string;
  pattern: string | null;
  styleTags: string[];
  season: Season[];
};

export type PrefillBundle = {
  prefill: PrefillResult;
  matches: ProductMatch[];
  /** Raw responses from stubs — stashed on the item as sourceData for debugging. */
  sourceData: {
    matches: ProductMatch[];
    scraped: ProductMetadata | null;
  };
};

/**
 * Reverse-image search (+ optional product scrape). Category is not inferred;
 * new items default to {@link NONE_CATEGORY}.
 */
function emptyPrefillBundle(): PrefillBundle {
  return {
    prefill: {
      name: "",
      brand: "",
      category: NONE_CATEGORY,
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
    },
    matches: [],
    sourceData: { matches: [], scraped: null },
  };
}

export async function runPrefill(originalImagePath: string): Promise<PrefillBundle> {
  if (!webMatchAutofillEnabled()) {
    return emptyPrefillBundle();
  }

  const matches = await reverseImageSearch(originalImagePath);
  const topMatch = matches[0] ?? null;
  const scraped = topMatch ? await scrapeProduct(topMatch.url) : null;

  const prefill: PrefillResult = topMatch
    ? { ...productMatchToPrefill(topMatch, scraped), category: NONE_CATEGORY }
    : {
        name: "",
        brand: "",
        category: NONE_CATEGORY,
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
    sourceData: { matches, scraped },
  };
}
