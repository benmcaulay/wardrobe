import { pick, range, seededRng } from "./_rng";

// TODO: replace with a real reverse image search call (SerpAPI Google Lens,
// Bing Visual Search, or TinEye).
// SerpAPI Google Lens: https://serpapi.com/google-lens-api
// Bing Visual Search: https://learn.microsoft.com/bing/search-apis/bing-visual-search

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

/**
 * Look up products that visually match an image. Stub returns 3 deterministic
 * matches (highest confidence first). A real provider should return results of
 * the same shape, sorted by confidence.
 */
export async function reverseImageSearch(imagePath: string): Promise<ProductMatch[]> {
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
