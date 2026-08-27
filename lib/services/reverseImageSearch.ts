/**
 * Identify the product in a photo, for prefilling the add-item form.
 *
 * ── What changed and why it matters ─────────────────────────────────────────
 *
 * This was Google Lens through SerpAPI: a real reverse-image search that
 * returned real listings, with real prices and real URLs. It is now gemini
 * vision, which is a different thing wearing the same interface — it recognises
 * the garment from what the model knows, it does not look anything up.
 *
 * Two consequences are deliberate rather than incidental:
 *
 *  - **No URLs.** A model asked for a product link invents a plausible one.
 *    `url` stays empty; paste a link and the (keyless) product scraper reads the
 *    real page instead.
 *  - **No prices.** `priceCents` stays 0 for the same reason. The wishlist
 *    budget at /closet/wishlist sums these, and a fabricated price makes that
 *    number silently wrong — the exact failure the old stub was criticised for
 *    in .env.example.
 *
 * What it is genuinely good at, and all we ask of it: the garment's name, its
 * brand when a logo or silhouette is recognisable, and its material/pattern.
 */
import { log } from "../log";
import { normalizeColorName } from "../colors";
import { contentTypeFor, getObject } from "../storage";
import { geminiJson, geminiTextConfigured } from "./gemini-text";
import { pick, range, seededRng } from "./_rng";

export type ProductMatch = {
  name: string;
  brand: string;
  priceCents: number;
  currency: string;
  retailer: string;
  url: string;
  thumbnailUrl: string | null;
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

/**
 * Products matching an image. Kept on the old name and shape so the add-item and
 * wishlist flows are unchanged; the engine underneath is now gemini vision.
 */
export async function reverseImageSearch(imagePath: string): Promise<ProductMatch[]> {
  if (!geminiTextConfigured()) return reverseImageSearchStub(imagePath);
  const identified = await identifyGarmentInImage(imagePath);
  return identified ? [identified.match] : [];
}
