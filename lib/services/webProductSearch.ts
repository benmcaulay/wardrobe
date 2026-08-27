/**
 * Resolve a text query ("cos wide leg trouser") to a product, for the wishlist
 * and the add-item search box.
 *
 * Was SerpAPI Google Shopping — a real search with live prices and links. It is
 * now gemini, which has no web access, so the same caveats as its sibling in
 * `reverseImageSearch.ts` apply and for the same reasons: it names the product,
 * it does not price or link it. `priceCents` stays 0 and `url` stays empty
 * rather than being invented, because the wishlist budget sums those prices and
 * a plausible-looking guess would quietly corrupt it.
 *
 * A real price still arrives the moment a URL is pasted: the product scraper
 * reads schema.org/Product JSON-LD off the page and needs no API key.
 */
import { log } from "../log";
import { geminiJson, geminiTextConfigured } from "./gemini-text";
import { pick, range, seededRng } from "./_rng";
import type { ProductMatch } from "./reverseImageSearch";

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

function searchWebProductsStub(query: string): ProductMatch[] {
  const rng = seededRng(query);
  const brand = pick(rng, ["Everlane", "COS", "Uniqlo", "Arket", "Madewell"]);
  return [
    {
      name: query.trim() || "Unknown piece",
      brand,
      priceCents: range(rng, 2900, 29900),
      currency: "USD",
      retailer: brand,
      url: "",
      thumbnailUrl: null,
      confidence: 0.5,
    },
  ];
}

export async function searchWebProducts(query: string): Promise<ProductMatch[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  if (!geminiTextConfigured()) return searchWebProductsStub(trimmed);

  const startedAt = Date.now();
  let raw: SearchJson;
  try {
    raw = await geminiJson<SearchJson>(SEARCH_PROMPT.replace("%QUERY%", trimmed));
  } catch (err) {
    log.error("web-product-search.failed", err, { ms: Date.now() - startedAt });
    return [];
  }
  const products = (raw.products ?? [])
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

  log.info("web-product-search.ok", { ms: Date.now() - startedAt, results: products.length });
  return products;
}
