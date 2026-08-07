import { log } from "../log";
import { pick, pickN, range, seededRng } from "./_rng";
import { parseProductHtml } from "./pdp-parse";

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

/** Real mode fetches the page and reads schema.org/OpenGraph markup. */
export function realProductScraperEnabled(): boolean {
  return process.env.USE_REAL_PRODUCT_SCRAPER === "true";
}

const FETCH_TIMEOUT_MS = 15_000;
const MAX_HTML_BYTES = 3 * 1024 * 1024;

/**
 * Given a product URL, pull back structured metadata.
 *
 * Real mode (USE_REAL_PRODUCT_SCRAPER=true) fetches the PDP and parses
 * schema.org/Product JSON-LD plus OpenGraph tags — it returns null when the
 * page yields nothing usable rather than inventing a price. Stub mode derives
 * a deterministic fake response from the URL for local development.
 *
 * Returns null for aggregator URLs (Google Shopping redirects) in both modes,
 * where the result would be garbage like name "Search" / brand "Google".
 */
export async function scrapeProduct(url: string): Promise<ProductMetadata | null> {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    if (host === "google.com" || host.endsWith(".google.com")) {
      return null;
    }
  } catch {
    return null;
  }

  if (realProductScraperEnabled()) {
    return fetchAndParseProduct(url);
  }

  let host = "shop.example.com";
  let slug = "product";
  try {
    const parsed = new URL(url);
    host = parsed.host.replace(/^www\./, "");
    slug = parsed.pathname.split("/").filter(Boolean).pop() ?? "product";
  } catch {
    return null;
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

/**
 * Fetch a merchant PDP and read its structured markup. Retailers vary in how
 * much they gate on User-Agent; we send a normal desktop UA and follow
 * redirects, but we never fall back to fabricated data — a null here means the
 * caller should ask the user for the price instead.
 */
async function fetchAndParseProduct(url: string): Promise<ProductMetadata | null> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      next: { revalidate: 0 },
    });

    if (!res.ok) {
      log.warn("scrapeProduct: non-OK response", { url, status: res.status });
      return null;
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (contentType && !contentType.includes("html")) return null;

    const html = await readCapped(res, MAX_HTML_BYTES);
    // Redirects are common (locale/regional splits); parse against the URL we
    // actually landed on so relative image paths resolve correctly.
    return parseProductHtml(html, res.url || url);
  } catch (err) {
    log.warn("scrapeProduct: fetch failed", { url, error: (err as Error).message });
    return null;
  }
}

/** Read the body but stop at a byte cap so a pathological page can't blow up memory. */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return res.text();

  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let total = 0;

  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    chunks.push(decoder.decode(value, { stream: true }));
  }
  await reader.cancel().catch(() => {});
  chunks.push(decoder.decode());
  return chunks.join("");
}
