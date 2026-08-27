/**
 * Find the product in a photo, for prefilling the add-item form.
 *
 * Three lanes, in order:
 *
 *  1. **Google Lens via SerpAPI** — a real reverse-image search returning real
 *     listings with real prices and URLs. Needs SERPAPI_KEY *and* a publicly
 *     reachable image URL (PUBLIC_APP_URL + PUBLIC_IMAGE_SECRET), because
 *     SerpAPI has to fetch the image itself. That rules it out on localhost.
 *  2. **Gemini vision** — recognises the garment from what the model knows
 *     rather than looking it up, so it names the piece but cannot price or link
 *     it. `priceCents` stays 0 and `url` stays empty rather than being invented:
 *     the wishlist budget sums these, and a plausible guess would corrupt it
 *     silently. Good at name, brand when a logo is legible, material, pattern.
 *  3. **Stub** for offline dev.
 *
 * The lane actually used is logged, because "no price" versus "real price" is
 * the difference between the wishlist budget working and not, and it is not
 * otherwise visible from the result.
 */
import { log } from "../log";
import { normalizeColorName } from "../colors";
import { parseBrandFromTitle } from "../shopping-parse";
import { signedPublicImageUrl } from "../public-image-url";
import { contentTypeFor, getObject } from "../storage";
import { geminiJson, geminiTextConfigured } from "./gemini-text";
import { serpApiGet, serpApiLensEnabled } from "./serpapi-client";
import { pick, range, seededRng } from "./_rng";

export type ProductMatch = {
  name: string;
  brand: string;
  priceCents: number;
  currency: string;
  retailer: string;
  url: string;
  thumbnailUrl: string | null;
  /** SerpAPI token for Google Immersive Product (merchant link, specs). */
  immersiveProductPageToken?: string;
  /** 0..1 — how confident the match is. Highest first in the returned array. */
  confidence: number;
};

/** Known brands mapped to their real storefront, so `retailer` is never invented. */
const BRAND_RETAILERS: readonly { brand: string; retailer: string }[] = [
  { brand: "Everlane", retailer: "Everlane" },
  { brand: "COS", retailer: "COS" },
  { brand: "Uniqlo", retailer: "Uniqlo" },
  { brand: "Arket", retailer: "Arket" },
  { brand: "New Balance", retailer: "New Balance" },
  { brand: "Nike", retailer: "Nike" },
  { brand: "Adidas", retailer: "Adidas" },
  { brand: "Levi's", retailer: "Levi's" },
  { brand: "Madewell", retailer: "Madewell" },
  { brand: "Aritzia", retailer: "Aritzia" },
];

function retailerForBrand(brand: string): string {
  const hit = BRAND_RETAILERS.find(
    (b) => b.brand.toLowerCase() === brand.trim().toLowerCase(),
  );
  return hit?.retailer ?? "";
}

const IDENTIFY_PROMPT = `Identify the single clothing item, shoe, or accessory in this photo as a retail product.

Rules:
- "name": a short product title, as a shop would list it (e.g. "Wide Leg Chino Trouser"). Required.
- "brand": only if a logo, wordmark, or unmistakable design makes it certain. Otherwise "".
- "material" / "pattern": best guess, or omit.
- "colors": 1-3 dominant colours, most dominant first, or omit.
- "confidence": 0.0-1.0, how sure you are of name + brand together.
- Do NOT guess a price. Do NOT invent a product URL or a retailer.

Reply with ONLY valid JSON:
{"name":"...","brand":"...","material":"...","pattern":"...","colors":["..."],"confidence":0.0}`;

type IdentifyJson = {
  name?: string;
  brand?: string;
  material?: string;
  pattern?: string;
  colors?: string[];
  confidence?: number;
};

/** Extra fields the add-item prefill can use beyond the ProductMatch shape. */
export type IdentifiedGarment = {
  match: ProductMatch;
  material?: string;
  pattern?: string;
  colors: string[];
};

export async function identifyGarmentInImage(
  imagePath: string,
): Promise<IdentifiedGarment | null> {
  const buffer = await getObject(imagePath);
  if (!buffer) return null;

  const startedAt = Date.now();
  let raw: IdentifyJson;
  try {
    raw = await geminiJson<IdentifyJson>(IDENTIFY_PROMPT, {
      images: [{ buffer, mime: contentTypeFor(imagePath) }],
    });
  } catch (err) {
    log.error("product-identify.failed", err, { ms: Date.now() - startedAt });
    return null;
  }
  const name = raw.name?.trim();
  if (!name) return null;

  const brand = raw.brand?.trim() ?? "";
  log.info("product-identify.ok", {
    ms: Date.now() - startedAt,
    hasBrand: brand.length > 0,
    confidence: raw.confidence ?? null,
  });

  return {
    match: {
      name,
      brand,
      // Price and URL are intentionally empty — see the module docstring.
      priceCents: 0,
      currency: "USD",
      retailer: retailerForBrand(brand),
      url: "",
      thumbnailUrl: null,
      confidence: Math.min(Math.max(raw.confidence ?? 0.5, 0), 1),
    },
    material: raw.material?.trim() || undefined,
    pattern: raw.pattern?.trim() || undefined,
    colors: (raw.colors ?? [])
      .map((c) => normalizeColorName(c))
      .filter((c): c is string => Boolean(c))
      .slice(0, 3),
  };
}

/** Offline stand-in so dev without a key still exercises the flow. */
function reverseImageSearchStub(imagePath: string): ProductMatch[] {
  const rng = seededRng(imagePath);
  const adj = pick(rng, ["Boxy", "Relaxed", "Cropped", "Tailored", "Slim"]);
  const noun = pick(rng, ["Shirt", "Trouser", "Jacket", "Knit", "Dress"]);
  const seller = pick(rng, BRAND_RETAILERS);
  return [
    {
      name: `${adj} ${noun}`,
      brand: seller.brand,
      priceCents: range(rng, 2900, 29900),
      currency: "USD",
      retailer: seller.retailer,
      url: "",
      thumbnailUrl: null,
      confidence: 0.62,
    },
  ];
}

// -----------------------------------------------------------------------------
// Lane 1: Google Lens via SerpAPI
// -----------------------------------------------------------------------------

type LensPrice = { extracted_value?: number; currency?: string };
type LensMatch = {
  title?: string;
  link?: string;
  source?: string;
  thumbnail?: string;
  price?: LensPrice | string;
};
type LensResponse = { visual_matches?: LensMatch[]; products?: LensMatch[] };

function parseLensPrice(price: LensMatch["price"]): { cents: number; currency: string } {
  if (!price) return { cents: 0, currency: "USD" };
  if (typeof price === "string") {
    const num = parseFloat(price.replace(/[^0-9.]/g, ""));
    return { cents: Number.isFinite(num) && num > 0 ? Math.round(num * 100) : 0, currency: "USD" };
  }
  const value = price.extracted_value;
  return {
    cents: typeof value === "number" && value > 0 ? Math.round(value * 100) : 0,
    currency: price.currency?.trim() || "USD",
  };
}

function mapLensMatch(item: LensMatch, confidence: number): ProductMatch | null {
  const url = item.link?.trim();
  const name = item.title?.trim();
  if (!url || !name) return null;

  const { cents, currency } = parseLensPrice(item.price);
  const retailer = item.source?.trim() || "Shop";
  return {
    name,
    brand: parseBrandFromTitle(name) || retailer,
    priceCents: cents,
    currency,
    retailer,
    url,
    thumbnailUrl: item.thumbnail ?? null,
    confidence,
  };
}

async function reverseImageSearchSerp(imagePath: string): Promise<ProductMatch[]> {
  const imageUrl = signedPublicImageUrl(imagePath);
  if (!imageUrl) return [];

  const data = await serpApiGet<LensResponse>({
    engine: "google_lens",
    url: imageUrl,
    type: "products",
    hl: "en",
    country: "us",
  });

  const rows = [...(data.products ?? []), ...(data.visual_matches ?? [])];
  const matches: ProductMatch[] = [];
  const seen = new Set<string>();
  let confidence = 0.95;
  for (const row of rows) {
    const m = mapLensMatch(row, confidence);
    if (!m || seen.has(m.url)) continue;
    seen.add(m.url);
    matches.push(m);
    confidence = Math.max(0.3, confidence - 0.07);
    if (matches.length >= 10) break;
  }
  return matches;
}

/**
 * Products matching an image. Same name and shape as always, so the add-item and
 * wishlist flows do not care which lane answered.
 */
export async function reverseImageSearch(imagePath: string): Promise<ProductMatch[]> {
  if (serpApiLensEnabled()) {
    const startedAt = Date.now();
    try {
      const matches = await reverseImageSearchSerp(imagePath);
      if (matches.length > 0) {
        log.info("reverse-image.ok", {
          provider: "serpapi-lens",
          ms: Date.now() - startedAt,
          results: matches.length,
        });
        return matches;
      }
      log.info("reverse-image.empty", { provider: "serpapi-lens", ms: Date.now() - startedAt });
    } catch (err) {
      // Fall through: a named garment with no price beats no answer at all.
      log.error("reverse-image.serpapi.failed", err, { ms: Date.now() - startedAt });
    }
  }

  if (geminiTextConfigured()) {
    const identified = await identifyGarmentInImage(imagePath);
    if (identified) {
      log.info("reverse-image.ok", { provider: "gemini", results: 1, priced: false });
      return [identified.match];
    }
    return [];
  }

  return reverseImageSearchStub(imagePath);
}
