import { log } from "../log";
import { signedPublicImageUrl } from "../public-image-url";
import { serpApiEnabled, serpApiGet } from "./serpapi-client";
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

type LensPrice = {
  extracted_value?: number;
  currency?: string;
};

type LensMatch = {
  title?: string;
  link?: string;
  source?: string;
  thumbnail?: string;
  price?: LensPrice | string;
};

type LensResponse = {
  visual_matches?: LensMatch[];
  products?: LensMatch[];
};

const BRAND_RETAILERS: readonly { brand: string; retailer: string; host: string }[] = [
  { brand: "Everlane", retailer: "Everlane", host: "everlane.com" },
  { brand: "COS", retailer: "COS", host: "cos.com" },
  { brand: "Reformation", retailer: "Reformation", host: "thereformation.com" },
  { brand: "Levi's", retailer: "Levi's", host: "levi.com" },
  { brand: "Madewell", retailer: "Madewell", host: "madewell.com" },
  { brand: "Quince", retailer: "Quince", host: "quince.com" },
  { brand: "Uniqlo", retailer: "Uniqlo", host: "uniqlo.com" },
  { brand: "J.Crew", retailer: "J.Crew", host: "jcrew.com" },
];

const NAME_ADJECTIVES = [
  "Relaxed",
  "Slim",
  "Boxy",
  "Cropped",
  "Oversized",
  "Tailored",
  "Wide-Leg",
  "High-Rise",
  "Classic",
  "Vintage",
];
const NAME_NOUNS = [
  "Oxford Shirt",
  "Chino Trouser",
  "Denim Jacket",
  "Midi Skirt",
  "Cashmere Crewneck",
  "Linen Blazer",
  "Canvas Tote",
  "Leather Loafer",
  "Silk Slip Dress",
  "Wool Coat",
];

function parseLensPrice(price: LensPrice | string | undefined): { cents: number; currency: string } {
  if (!price) return { cents: 0, currency: "USD" };
  if (typeof price === "string") {
    const num = parseFloat(price.replace(/[^0-9.]/g, ""));
    return {
      cents: Number.isFinite(num) && num > 0 ? Math.round(num * 100) : 0,
      currency: "USD",
    };
  }
  const val = price.extracted_value;
  const currency =
    price.currency === "¥" ? "JPY" : price.currency === "£" ? "GBP" : price.currency === "€" ? "EUR" : "USD";
  return {
    cents: typeof val === "number" && val > 0 ? Math.round(val * 100) : 0,
    currency: typeof price.currency === "string" && price.currency.length === 3 ? price.currency : currency,
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
    brand: retailer,
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
  if (!imageUrl) {
    log.warn("reverse-image.lens.unconfigured", {
      hint: "PUBLIC_APP_URL and PUBLIC_IMAGE_SECRET required for Google Lens; using stub",
    });
    return reverseImageSearchStub(imagePath);
  }

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

function reverseImageSearchStub(imagePath: string): ProductMatch[] {
  const rng = seededRng(`reverseImageSearch:${imagePath}`);
  const count = range(rng, 2, 4);
  const matches: ProductMatch[] = [];
  let prevConfidence = 0.95;

  for (let i = 0; i < count; i++) {
    const seller = pick(rng, BRAND_RETAILERS);
    const adj = pick(rng, NAME_ADJECTIVES);
    const noun = pick(rng, NAME_NOUNS);
    const slug = `${adj}-${noun}`.toLowerCase().replace(/\s+/g, "-");
    const confidence = Math.max(0.3, prevConfidence - rng() * 0.15);
    prevConfidence = confidence;

    matches.push({
      name: `${adj} ${noun}`,
      brand: seller.brand,
      priceCents: range(rng, 2900, 29900),
      currency: "USD",
      retailer: seller.retailer,
      url: `https://${seller.host}/products/${slug}`,
      thumbnailUrl: null,
      confidence: Number(confidence.toFixed(3)),
    });
  }

  return matches;
}

/**
 * Look up products that visually match an image (Google Lens via SerpAPI when configured).
 */
export async function reverseImageSearch(imagePath: string): Promise<ProductMatch[]> {
  if (serpApiEnabled()) {
    try {
      return await reverseImageSearchSerp(imagePath);
    } catch (err) {
      log.error("reverse-image.serpapi.failed", err);
      throw err;
    }
  }
  return reverseImageSearchStub(imagePath);
}
