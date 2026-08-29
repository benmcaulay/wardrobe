/**
 * Resolve a text query ("cos wide leg trouser") to a product, for the wishlist
 * and the add-item search box.
 *
 * Three lanes, in order:
 *
 *  1. **SerpAPI Google Shopping** when SERPAPI_KEY is set. The only lane that
 *     returns a real listing: real price, real merchant URL, real thumbnail.
 *     This is why SerpAPI survived the move to gemini-only.
 *  2. **Gemini** otherwise. It can identify the product from its own knowledge
 *     but has no web access, so `priceCents` stays 0 and `url` stays empty
 *     rather than being invented — .env.example already noted that fabricated
 *     prices make the wishlist budget at /closet/wishlist meaningless.
 *  3. **Stub** when neither is configured, so offline dev still exercises the
 *     flow.
 *
 * A real price also arrives whenever a URL is pasted: the product scraper reads
 * schema.org/Product JSON-LD off the page and needs no API key.
 */
import { log } from "../log";
import { parseBrandFromTitle } from "../shopping-parse";
import { serpApiEnabled, serpApiGet } from "./serpapi-client";
import { getCachedSearch, setCachedSearch } from "./product-search-cache";
import { geminiJson, geminiTextConfigured } from "./gemini-text";
import { pick, range, seededRng } from "./_rng";
import type { ProductMatch } from "./reverseImageSearch";

const BRAND_RETAILERS: readonly { brand: string; retailer: string; host: string }[] = [
  { brand: "Everlane", retailer: "Everlane", host: "everlane.com" },
  { brand: "COS", retailer: "COS", host: "cos.com" },
  { brand: "Nike", retailer: "Nike", host: "nike.com" },
  { brand: "Madewell", retailer: "Madewell", host: "madewell.com" },
  { brand: "Amazon", retailer: "Amazon", host: "amazon.com" },
];

// -----------------------------------------------------------------------------
// Lane 1: SerpAPI Google Shopping
// -----------------------------------------------------------------------------

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

type ShoppingResponse = { shopping_results?: ShoppingResult[] };

function parsePriceCents(item: ShoppingResult): number {
  if (typeof item.extracted_price === "number" && item.extracted_price > 0) {
    return Math.round(item.extracted_price * 100);
  }
  const num = parseFloat((item.price ?? "").replace(/[^0-9.]/g, ""));
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

  return {
    name,
    brand: parseBrandFromTitle(name) || retailer,
    priceCents: priceCents > 0 ? priceCents : 0,
    currency: "USD",
    retailer,
    url,
    thumbnailUrl: item.thumbnail ?? item.serpapi_thumbnail ?? null,
    immersiveProductPageToken: item.immersive_product_page_token,
    confidence,
  };
}

/** Confidence given to the top hit, and to the last one. */
const SERP_CONFIDENCE_TOP = 0.95;
const SERP_CONFIDENCE_LAST = 0.35;

/**
 * Every result Google Shopping returned, not the first twelve.
 *
 * There used to be a `.slice(0, 12)` here, which saved nothing: `data` is the
 * response body, so the request had already been made and already been billed.
 * One call returns roughly forty to sixty rows and we were discarding most of
 * them, then charging the user another search when the twelve did not contain
 * what they wanted. Keeping them all costs exactly the same.
 *
 * Confidence is now spread across however many results there are rather than
 * decremented by a fixed step. The old 0.06-per-row decay with a 0.35 floor hit
 * that floor at row 11, so past the old cap every result claimed identical
 * confidence and the ordering signal was gone precisely where it was needed.
 */
async function searchProductsSerp(query: string): Promise<ProductMatch[]> {
  const data = await serpApiGet<ShoppingResponse>({
    engine: "google_shopping",
    q: query,
    hl: "en",
    gl: "us",
    google_domain: "google.com",
  });

  const rows = data.shopping_results ?? [];
  const span = SERP_CONFIDENCE_TOP - SERP_CONFIDENCE_LAST;
  const matches: ProductMatch[] = [];
  for (const [i, row] of rows.entries()) {
    // Rank-proportional, so the first is always 0.95 and the last always 0.35
    // whether there are five results or sixty. A single result gets the top
    // score rather than being averaged into the middle.
    const progress = rows.length > 1 ? i / (rows.length - 1) : 0;
    const m = mapShoppingResult(row, round2(SERP_CONFIDENCE_TOP - span * progress));
    if (!m) continue;
    matches.push(m);
  }
  return matches;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// -----------------------------------------------------------------------------
// Lane 2: gemini identification (no price, no URL)
// -----------------------------------------------------------------------------

const SEARCH_PROMPT = `A user typed this into a clothing wishlist search box. Identify the most likely retail products they mean.

Query: %QUERY%

Rules:
- Return up to 3 candidates, most likely first.
- "name": short product title as a shop would list it. Required.
- "brand": only when the query or your knowledge makes it certain, else "".
- "confidence": 0.0-1.0.
- Do NOT guess a price. Do NOT invent a URL.

Reply with ONLY valid JSON: {"products":[{"name":"...","brand":"...","confidence":0.0}]}`;

type SearchJson = {
  products?: Array<{ name?: string; brand?: string; confidence?: number }>;
};

async function searchProductsGemini(query: string): Promise<ProductMatch[]> {
  const raw = await geminiJson<SearchJson>(SEARCH_PROMPT.replace("%QUERY%", query));
  return (raw.products ?? [])
    .map((p) => {
      const name = p.name?.trim();
      if (!name) return null;
      const brand = p.brand?.trim() ?? "";
      const match: ProductMatch = {
        name,
        brand,
        // Deliberately unpriced and unlinked — see the module docstring.
        priceCents: 0,
        currency: "USD",
        retailer: brand,
        url: "",
        thumbnailUrl: null,
        confidence: Math.min(Math.max(p.confidence ?? 0.5, 0), 1),
      };
      return match;
    })
    .filter((p): p is ProductMatch => p !== null)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3);
}

// -----------------------------------------------------------------------------
// Lane 3: offline stub
// -----------------------------------------------------------------------------

function searchProductsStub(query: string): ProductMatch[] {
  const rng = seededRng(`webProductSearch:${query.toLowerCase()}`);
  const seller = pick(rng, BRAND_RETAILERS);
  const slug = query.toLowerCase().replace(/\s+/g, "-").slice(0, 48) || "item";
  return [
    {
      name: query || "Product",
      brand: seller.brand,
      priceCents: range(rng, 2900, 19900),
      currency: "USD",
      retailer: seller.retailer,
      url: `https://${seller.host}/products/${slug}`,
      thumbnailUrl: null,
      confidence: 0.88,
    },
  ];
}

/** Which lane answered, and whether anything was billed for it. */
export type SearchProvider = "serpapi" | "gemini" | "stub";

export type WebProductSearch = {
  matches: ProductMatch[];
  provider: SearchProvider;
  /** True when the cache answered, so no request went out and nothing was billed. */
  cached: boolean;
};

/**
 * Text search for products to add.
 *
 * Returns *how* it answered as well as what it found, because the caller has to
 * record the search — SerpAPI bills per request and until now none of those
 * requests were counted anywhere (see prisma ProductSearchEvent).
 *
 * Only the SerpAPI lane is cached. Caching gemini would be caching a result with
 * no price and no URL, and if SerpAPI were briefly down, a ten-minute cache
 * would keep serving that degraded answer after it recovered.
 */
export async function searchWebProductsDetailed(query: string): Promise<WebProductSearch> {
  const q = query.trim();
  if (!q) return { matches: [], provider: "stub", cached: true };

  if (serpApiEnabled()) {
    const nowMs = Date.now();
    const hit = getCachedSearch<ProductMatch[]>(q, nowMs);
    if (hit) {
      log.info("web-product-search.cache-hit", { provider: "serpapi", results: hit.length });
      return { matches: hit, provider: "serpapi", cached: true };
    }

    const startedAt = Date.now();
    try {
      const matches = await searchProductsSerp(q);
      // Empty results are cached too: a query that finds nothing will find
      // nothing again in ten minutes, and re-billing to confirm that is the
      // most wasteful search there is.
      setCachedSearch(q, matches, Date.now());
      log.info("web-product-search.ok", {
        provider: "serpapi",
        ms: Date.now() - startedAt,
        results: matches.length,
      });
      return { matches, provider: "serpapi", cached: false };
    } catch (err) {
      // Fall through to gemini rather than failing: a name with no price still
      // lets the user add the piece and paste a link afterwards.
      log.error("web-product-search.serpapi.failed", err, { ms: Date.now() - startedAt });
    }
  }

  if (geminiTextConfigured()) {
    const startedAt = Date.now();
    try {
      const matches = await searchProductsGemini(q);
      log.info("web-product-search.ok", {
        provider: "gemini",
        ms: Date.now() - startedAt,
        results: matches.length,
        priced: false,
      });
      return { matches, provider: "gemini", cached: false };
    } catch (err) {
      log.error("web-product-search.gemini.failed", err, { ms: Date.now() - startedAt });
      return { matches: [], provider: "gemini", cached: false };
    }
  }

  return { matches: searchProductsStub(q), provider: "stub", cached: false };
}

/**
 * Matches only.
 *
 * Kept for callers that genuinely cannot record the search — nothing else. If
 * you have a userId in scope, use `searchWebProductsDetailed` and log a
 * ProductSearchEvent; a billed call that reports nothing is how this path became
 * invisible in the first place.
 */
export async function searchWebProducts(query: string): Promise<ProductMatch[]> {
  return (await searchWebProductsDetailed(query)).matches;
}
