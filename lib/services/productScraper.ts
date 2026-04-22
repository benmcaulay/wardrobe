import { pick, pickN, range, seededRng } from "./_rng";

// TODO: replace with a real scraper (ScrapingBee, Bright Data, Apify, or a
// custom fetcher over schema.org/Product + og:image markup).
// ScrapingBee: https://www.scrapingbee.com/documentation/
// schema.org Product: https://schema.org/Product

export type ProductMetadata = {
  name: string;
  brand: string;
  priceCents: number;
  currency: string;
  retailer: string;
  material: string | null;
  colors: string[];
  imageUrls: string[];
  productUrl: string;
};

const MATERIALS = ["Cotton", "Wool", "Wool blend", "Linen", "Silk", "Cashmere", "Denim", "Leather", "Polyester blend"];
const COLOR_NAMES = ["black", "ivory", "charcoal", "sage", "terracotta", "indigo", "sand", "cognac", "cream", "olive"];

/**
 * Given a product URL, pull back structured metadata. Stub derives a
 * deterministic response from the URL — good enough for the add-item
 * pre-fill flow during development.
 */
export async function scrapeProduct(url: string): Promise<ProductMetadata> {
  let host = "shop.example.com";
  let slug = "product";
  try {
    const parsed = new URL(url);
    host = parsed.host.replace(/^www\./, "");
    slug = parsed.pathname.split("/").filter(Boolean).pop() ?? "product";
  } catch {
    // leave defaults; we still want a stable stub response
  }

  const rng = seededRng(`scrapeProduct:${host}:${slug}`);
  const retailer = host.split(".")[0].replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const name = slug
    .replace(/[-_]+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase()) || "Unnamed Product";

  return {
    name,
    brand: retailer,
    priceCents: range(rng, 3900, 34900),
    currency: "USD",
    retailer,
    material: pick(rng, MATERIALS),
    colors: pickN(rng, COLOR_NAMES, range(rng, 1, 2)),
    imageUrls: [],
    productUrl: url,
  };
}
