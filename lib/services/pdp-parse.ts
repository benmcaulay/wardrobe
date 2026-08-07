/**
 * Parse product metadata out of a merchant PDP's HTML.
 *
 * Pure string → data, no network, so it unit-tests against fixture HTML.
 * Two sources, in order of trust:
 *   1. schema.org/Product JSON-LD — the structured data most storefronts
 *      (Shopify, Salesforce Commerce, Magento) emit for Google Shopping.
 *   2. OpenGraph / product meta tags — the fallback when JSON-LD is absent.
 *
 * Returns null rather than guessing. A wishlist budget built on invented
 * prices is worse than one with a blank the user fills in themselves.
 */

import type { ProductMetadata } from "./productScraper";

type Json = Record<string, unknown>;

const SCRIPT_LD_RE =
  /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

export function parseProductHtml(html: string, url: string): ProductMetadata | null {
  const host = hostOf(url);
  if (!host) return null;

  const fromLd = fromJsonLd(html, url, host);
  const fromMeta = fromMetaTags(html, url, host);

  // Merge field by field: JSON-LD wins, meta tags backfill. Neither source is
  // reliably complete — JSON-LD often omits the price, and og:image is usually
  // a better hero shot than the JSON-LD image array.
  const name = fromLd?.name || fromMeta.name;
  const priceCents = firstPositive(fromLd?.priceCents, fromMeta.priceCents);
  const imageUrls = dedupe([...(fromLd?.imageUrls ?? []), ...fromMeta.imageUrls]);

  // A name alone isn't a product — every storefront's 404 page has a title.
  if (!name || (priceCents === 0 && imageUrls.length === 0)) return null;

  const retailer = fromLd?.retailer || fromMeta.retailer || retailerFromHost(host);

  return {
    name,
    brand: fromLd?.brand || fromMeta.brand || retailer,
    priceCents,
    currency: fromLd?.currency || fromMeta.currency || "USD",
    retailer,
    material: fromLd?.material ?? fromMeta.material,
    colors: fromLd?.colors?.length ? fromLd.colors : fromMeta.colors,
    imageUrls,
    productUrl: url,
  };
}

/* ------------------------------------------------------------------ JSON-LD */

function fromJsonLd(html: string, url: string, host: string): ProductMetadata | null {
  for (const raw of jsonLdBlocks(html)) {
    const node = findProductNode(raw);
    if (!node) continue;

    const name = str(node.name);
    if (!name) continue;

    const offer = firstOffer(node.offers);
    const priceCents = toCents(offer ? (offer.price ?? offer.lowPrice ?? offer.highPrice) : null);
    const currency = str(offer?.priceCurrency) || "";

    return {
      name,
      brand: brandName(node.brand),
      priceCents,
      currency: currency || "USD",
      retailer: sellerName(offer) || retailerFromHost(host),
      material: str(node.material) || null,
      colors: colorList(node.color),
      imageUrls: imageList(node.image),
      productUrl: str(node.url) || url,
    };
  }
  return null;
}

function jsonLdBlocks(html: string): Json[] {
  const out: Json[] = [];
  SCRIPT_LD_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SCRIPT_LD_RE.exec(html)) !== null) {
    const body = match[1]?.trim();
    if (!body) continue;
    try {
      const parsed = JSON.parse(stripJsonComments(body)) as unknown;
      if (Array.isArray(parsed)) {
        for (const entry of parsed) if (isJson(entry)) out.push(entry);
      } else if (isJson(parsed)) {
        out.push(parsed);
      }
    } catch {
      /* a malformed block shouldn't sink the others */
    }
  }
  return out;
}

/** Walk @graph / nested arrays looking for the first node typed as a Product. */
function findProductNode(node: unknown, depth = 0): Json | null {
  if (depth > 5 || !node) return null;

  if (Array.isArray(node)) {
    for (const entry of node) {
      const found = findProductNode(entry, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (!isJson(node)) return null;

  if (isProductType(node["@type"])) return node;

  for (const key of ["@graph", "mainEntity", "itemListElement", "item"]) {
    const found = findProductNode(node[key], depth + 1);
    if (found) return found;
  }
  return null;
}

function isProductType(value: unknown): boolean {
  const types = Array.isArray(value) ? value : [value];
  return types.some((t) => {
    const s = typeof t === "string" ? t.toLowerCase() : "";
    return s === "product" || s === "productmodel" || s.endsWith("/product");
  });
}

function firstOffer(offers: unknown): Json | null {
  if (!offers) return null;
  if (Array.isArray(offers)) {
    // Prefer an in-stock offer; a sold-out variant's price is misleading.
    const inStock = offers.filter(isJson).find((o) => availabilityInStock(o.availability));
    return inStock ?? offers.filter(isJson)[0] ?? null;
  }
  if (!isJson(offers)) return null;
  if (offers["@type"] === "AggregateOffer" || offers.offers) {
    const nested = firstOffer(offers.offers);
    if (nested) return nested;
  }
  return offers;
}

function availabilityInStock(value: unknown): boolean {
  const s = typeof value === "string" ? value.toLowerCase() : "";
  return s.includes("instock") || s.includes("limitedavailability") || s.includes("preorder");
}

function brandName(brand: unknown): string {
  if (typeof brand === "string") return brand.trim();
  if (Array.isArray(brand)) return brandName(brand[0]);
  if (isJson(brand)) return str(brand.name);
  return "";
}

function sellerName(offer: Json | null): string {
  if (!offer) return "";
  const seller = offer.seller;
  if (typeof seller === "string") return seller.trim();
  if (isJson(seller)) return str(seller.name);
  return "";
}

/* ------------------------------------------------------------- meta tags */

/**
 * Never returns null: a page can carry a usable price or hero image without an
 * og:title (the name then comes from JSON-LD). The caller decides whether the
 * merged result is substantial enough to keep.
 */
function fromMetaTags(html: string, url: string, host: string): ProductMetadata {
  const name = meta(html, "og:title") || meta(html, "twitter:title") || titleTag(html) || "";

  const priceCents = toCents(
    meta(html, "product:price:amount") ||
      meta(html, "og:price:amount") ||
      itemprop(html, "price") ||
      meta(html, "twitter:data1"),
  );

  const currency =
    meta(html, "product:price:currency") ||
    meta(html, "og:price:currency") ||
    itemprop(html, "priceCurrency") ||
    "";

  const images = dedupe(
    [meta(html, "og:image"), meta(html, "og:image:secure_url"), meta(html, "twitter:image")].filter(
      Boolean,
    ) as string[],
  );

  const retailer = meta(html, "og:site_name") || retailerFromHost(host);

  return {
    name: name ? decodeEntities(name) : "",
    brand: meta(html, "product:brand") || "",
    priceCents,
    currency: currency || "USD",
    retailer: decodeEntities(retailer),
    material: null,
    colors: [],
    imageUrls: images.map((i) => absolutize(i, url)).filter(Boolean) as string[],
    productUrl: url,
  };
}

/** Match `<meta property|name="X" content="Y">` in either attribute order. */
function meta(html: string, key: string): string {
  const k = escapeRe(key);
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)\\s*=\\s*["']${k}["'][^>]*?content\\s*=\\s*["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content\\s*=\\s*["']([^"']*)["'][^>]*?(?:property|name)\\s*=\\s*["']${k}["']`, "i"),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return decodeEntities(m[1].trim());
  }
  return "";
}

function itemprop(html: string, key: string): string {
  const k = escapeRe(key);
  const patterns = [
    new RegExp(`<meta[^>]+itemprop\\s*=\\s*["']${k}["'][^>]*?content\\s*=\\s*["']([^"']*)["']`, "i"),
    new RegExp(`<[^>]+itemprop\\s*=\\s*["']${k}["'][^>]*?content\\s*=\\s*["']([^"']*)["']`, "i"),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return decodeEntities(m[1].trim());
  }
  return "";
}

function titleTag(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m?.[1] ? decodeEntities(m[1].trim()) : "";
}

/* ---------------------------------------------------------------- helpers */

/**
 * Price strings come in wildly inconsistent shapes: "1,299.00", "1.299,00",
 * "$49", "49.00 USD". Normalise to cents, or 0 when it isn't a price.
 */
export function toCents(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : 0;
  }
  if (typeof value !== "string") return 0;

  const cleaned = value.replace(/[^0-9.,]/g, "").trim();
  if (!cleaned) return 0;

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalized: string;

  if (lastComma > lastDot) {
    // European: dots group thousands, comma is the decimal separator.
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else {
    normalized = cleaned.replace(/,/g, "");
  }

  const num = parseFloat(normalized);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.round(num * 100);
}

function imageList(image: unknown): string[] {
  if (!image) return [];
  if (typeof image === "string") return [image.trim()].filter(Boolean);
  if (Array.isArray(image)) return dedupe(image.flatMap(imageList));
  if (isJson(image)) {
    const u = str(image.url) || str(image.contentUrl);
    return u ? [u] : [];
  }
  return [];
}

function colorList(color: unknown): string[] {
  if (typeof color === "string") {
    return color
      .split(/[,/|]/)
      .map((c) => c.trim())
      .filter(Boolean);
  }
  if (Array.isArray(color)) return dedupe(color.flatMap(colorList));
  return [];
}

/** "shop.everlane.com" → "Everlane". Good enough as a retailer label. */
export function retailerFromHost(host: string): string {
  const parts = host.split(".").filter((p) => p !== "www" && p !== "shop" && p !== "store");
  const core = parts.length > 1 ? parts[parts.length - 2] : parts[0] || host;
  return core.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function absolutize(src: string, base: string): string {
  try {
    return new URL(src, base).toString();
  } catch {
    return "";
  }
}

function stripJsonComments(body: string): string {
  // Some CMSes wrap JSON-LD in CDATA or an HTML comment.
  return body
    .replace(/^\s*<!\[CDATA\[/, "")
    .replace(/\]\]>\s*$/, "")
    .replace(/^\s*<!--/, "")
    .replace(/-->\s*$/, "");
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
  "#x27": "'",
  "#x2F": "/",
};

function decodeEntities(value: string): string {
  return value
    .replace(/&([a-zA-Z]+|#x?[0-9a-fA-F]+);/g, (whole, code: string) => {
      const direct = ENTITIES[code] ?? ENTITIES[code.toLowerCase()];
      if (direct) return direct;
      const num = code.startsWith("#x")
        ? parseInt(code.slice(2), 16)
        : code.startsWith("#")
          ? parseInt(code.slice(1), 10)
          : NaN;
      return Number.isFinite(num) ? String.fromCodePoint(num) : whole;
    })
    .replace(/\s+/g, " ")
    .trim();
}

function firstPositive(...values: (number | undefined)[]): number {
  for (const v of values) if (typeof v === "number" && v > 0) return v;
  return 0;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

function isJson(value: unknown): value is Json {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
