import { log } from "../log";
import { parseBrandFromTitle } from "../shopping-parse";
import { serpApiEnabled, serpApiGet } from "./serpapi-client";
import type { ProductMatch } from "./reverseImageSearch";
import { pick, range, seededRng } from "./_rng";

const BRAND_RETAILERS: readonly { brand: string; retailer: string; host: string }[] = [
  { brand: "Everlane", retailer: "Everlane", host: "everlane.com" },
  { brand: "COS", retailer: "COS", host: "cos.com" },
  { brand: "Nike", retailer: "Nike", host: "nike.com" },
  { brand: "Madewell", retailer: "Madewell", host: "madewell.com" },
  { brand: "Amazon", retailer: "Amazon", host: "amazon.com" },
];

type ShoppingResult = {
  title?: string;
  source?: string;
  link?: string;
  /** Current Google Shopping API shape (replaces `link` on many responses). */
  product_link?: string;
  thumbnail?: string;
  serpapi_thumbnail?: string;
  extracted_price?: number;
  price?: string;
  immersive_product_page_token?: string;
};

type ShoppingResponse = {
  shopping_results?: ShoppingResult[];
};

function parsePriceCents(item: ShoppingResult): number {
  if (typeof item.extracted_price === "number" && item.extracted_price > 0) {
    return Math.round(item.extracted_price * 100);
  }
  const raw = item.price ?? "";
  const num = parseFloat(raw.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.round(num * 100);
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function mapShoppingResult(item: ShoppingResult, confidence: number): ProductMatch | null {
  const url = (item.link ?? item.product_link)?.trim();
  const name = item.title?.trim();
  if (!url || !name) return null;

  const host = hostFromUrl(url);
  const retailer = item.source?.trim() || host.split(".")[0] || "Shop";
  const priceCents = parsePriceCents(item);
  const brand = parseBrandFromTitle(name) || retailer;

  return {
    name,
    brand,
    priceCents: priceCents > 0 ? priceCents : 0,
    currency: "USD",
    retailer,
    url,
    thumbnailUrl: item.thumbnail ?? item.serpapi_thumbnail ?? null,
    immersiveProductPageToken: item.immersive_product_page_token,
    confidence,
  };
}

async function searchProductsSerp(query: string): Promise<ProductMatch[]> {
  const q = query.trim();
  if (!q) return [];

  const data = await serpApiGet<ShoppingResponse>({
    engine: "google_shopping",
    q,
    hl: "en",
    gl: "us",
    google_domain: "google.com",
  });

  const rows = data.shopping_results ?? [];
  const matches: ProductMatch[] = [];
  let confidence = 0.95;

  for (const row of rows.slice(0, 12)) {
    const m = mapShoppingResult(row, confidence);
    if (!m) continue;
    matches.push(m);
    confidence = Math.max(0.35, confidence - 0.06);
  }

  return matches;
}

function searchProductsStub(query: string): ProductMatch[] {
  const rng = seededRng(`webProductSearch:${query.trim().toLowerCase()}`);
  const seller = pick(rng, BRAND_RETAILERS);
  const slug = query.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 48) || "item";

  return [
    {
      name: query.trim() || "Product",
      brand: seller.brand,
      priceCents: range(rng, 2900, 19900),
      currency: "USD",
      retailer: seller.retailer,
      url: `https://${seller.host}/products/${slug}`,
      thumbnailUrl: null,
      confidence: 0.88,
    },
    {
      name: `${query.trim()} — alternate listing`,
      brand: seller.brand,
      priceCents: range(rng, 3900, 24900),
      currency: "USD",
      retailer: seller.retailer,
      url: `https://${seller.host}/search?q=${encodeURIComponent(query.trim())}`,
      thumbnailUrl: null,
      confidence: 0.72,
    },
  ];
}

/** Text search for products to add (Google Shopping via SerpAPI when configured). */
export async function searchWebProducts(query: string): Promise<ProductMatch[]> {
  const q = query.trim();
  if (!q) return [];

  if (serpApiEnabled()) {
    try {
      return await searchProductsSerp(q);
    } catch (err) {
      log.error("web-product-search.serpapi.failed", err);
      throw err;
    }
  }

  return searchProductsStub(q);
}
