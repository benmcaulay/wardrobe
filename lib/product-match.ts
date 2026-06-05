import type { Color } from "./json";
import type { PrefillResult } from "./prefill";
import type { ProductMatch } from "./services/reverseImageSearch";
import type { ProductMetadata } from "./services/productScraper";
import type { ItemFormValue } from "./types";

const COLOR_NAME_TO_HEX: Record<string, string> = {
  black: "#1a1a1a",
  ivory: "#f5f0e8",
  charcoal: "#36454f",
  sage: "#9caf88",
  terracotta: "#c67b5c",
  indigo: "#3f51b5",
  sand: "#c2b280",
  cognac: "#9a463d",
  cream: "#fffdd0",
  olive: "#708238",
  white: "#fafafa",
  gray: "#9e9e9e",
  grey: "#9e9e9e",
  navy: "#1e3a5f",
  red: "#c62828",
  blue: "#1565c0",
  green: "#2e7d32",
  brown: "#6d4c41",
  beige: "#d7ccc8",
  pink: "#f48fb1",
};

function colorsFromNames(names: string[]): Color[] {
  const out: Color[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const hex = COLOR_NAME_TO_HEX[key] ?? "#888888";
    out.push({ name, hex });
  }
  return out;
}

/** Map web / lens match (+ optional scrape) into form + prefill fields. */
export function productMatchToFormPatch(
  match: ProductMatch,
  scraped?: ProductMetadata | null,
): Partial<ItemFormValue> & { retailer?: string; productUrl?: string } {
  const src = scraped ?? null;
  return {
    name: src?.name || match.name,
    brand: src?.brand || match.brand,
    priceCents: src?.priceCents ?? match.priceCents,
    currency: src?.currency || match.currency,
    material: src?.material ?? "",
    colors: src?.colors?.length ? colorsFromNames(src.colors) : [],
    retailer: src?.retailer || match.retailer,
    productUrl: src?.productUrl || match.url,
  };
}

export function productMatchToPrefill(
  match: ProductMatch,
  scraped?: ProductMetadata | null,
): PrefillResult {
  const patch = productMatchToFormPatch(match, scraped);
  return {
    name: patch.name ?? "",
    brand: patch.brand ?? "",
    category: "",
    subcategory: "",
    colors: patch.colors ?? [],
    priceCents: patch.priceCents ?? null,
    currency: patch.currency ?? "USD",
    retailer: patch.retailer ?? "",
    productUrl: patch.productUrl ?? "",
    material: patch.material ?? "",
    pattern: "",
    styleTags: [],
    season: [],
  };
}
