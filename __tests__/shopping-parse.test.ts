import { describe, it, expect } from "vitest";
import { parseBrandFromTitle, isAggregatorProductUrl } from "../lib/shopping-parse";
import { productMatchToFormPatch } from "../lib/product-match";
import type { ProductMatch } from "../lib/services/reverseImageSearch";

describe("parseBrandFromTitle", () => {
  it("extracts brand before Men's / Women's", () => {
    expect(parseBrandFromTitle("Vuori Men's Sunday Performance Short")).toBe("Vuori");
    expect(parseBrandFromTitle("Nike Women's Dri-FIT Leggings")).toBe("Nike");
  });

  it("extracts brand before separators", () => {
    expect(parseBrandFromTitle("Patagonia - Better Sweater Fleece")).toBe("Patagonia");
  });

  it("falls back to first capitalized token", () => {
    expect(parseBrandFromTitle("Arc'teryx Atom LT Hoody")).toBe("Arc'teryx");
  });
});

describe("isAggregatorProductUrl", () => {
  it("flags Google Shopping links", () => {
    expect(isAggregatorProductUrl("https://www.google.com/shopping/product/123")).toBe(true);
    expect(isAggregatorProductUrl("https://rei.com/product/123")).toBe(false);
  });
});

describe("productMatchToFormPatch", () => {
  const match: ProductMatch = {
    name: "Vuori Men's Sunday Performance Short",
    brand: "Vuori",
    priceCents: 8400,
    currency: "USD",
    retailer: "REI",
    url: "https://www.google.com/shopping/product/1",
    thumbnailUrl: null,
    confidence: 0.9,
  };

  it("uses shopping match when stub scrape would be garbage", () => {
    const patch = productMatchToFormPatch(match, {
      name: "Search",
      brand: "Google",
      priceCents: 11100,
      currency: "USD",
      retailer: "Google",
      material: "Polyester blend",
      colors: ["black"],
      imageUrls: [],
      productUrl: "https://www.google.com/shopping/product/1",
    });
    expect(patch.name).toBe("Vuori Men's Sunday Performance Short");
    expect(patch.brand).toBe("Vuori");
    expect(patch.priceCents).toBe(8400);
  });

  it("prefers immersive enrichment over match when trustworthy", () => {
    const patch = productMatchToFormPatch(match, {
      name: "Vuori Sunday Performance Short 7\"",
      brand: "Vuori",
      priceCents: 8400,
      currency: "USD",
      retailer: "REI",
      material: "Polyester",
      colors: ["black"],
      imageUrls: [],
      productUrl: "https://www.rei.com/product/123",
    });
    expect(patch.material).toBe("Polyester");
    expect(patch.colors).toHaveLength(1);
    expect(patch.colors?.[0]?.name).toBe("black");
  });
});
