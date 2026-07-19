import { log } from "../log";
import { serpApiEnabled, serpApiGet } from "./serpapi-client";
import type { ProductMetadata } from "./productScraper";

type ImmersiveFeature = { title?: string; value?: string };

type ImmersiveStore = {
  name?: string;
  link?: string;
  price?: string;
  extracted_price?: number;
};

type ImmersiveResponse = {
  product_results?: {
    title?: string;
    brand?: string;
    about_the_product?: {
      features?: ImmersiveFeature[];
      link?: string;
    };
    stores?: ImmersiveStore[];
  };
};

function featureValue(features: ImmersiveFeature[] | undefined, ...labels: string[]): string | null {
  if (!features?.length) return null;
  const wanted = new Set(labels.map((l) => l.toLowerCase()));
  for (const row of features) {
    const key = row.title?.trim().toLowerCase();
    const val = row.value?.trim();
    if (key && val && wanted.has(key)) return val;
  }
  return null;
}

function parseStorePriceCents(store: ImmersiveStore | undefined): number {
  if (!store) return 0;
  if (typeof store.extracted_price === "number" && store.extracted_price > 0) {
    return Math.round(store.extracted_price * 100);
  }
  const raw = store.price ?? "";
  const num = parseFloat(raw.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.round(num * 100);
}

function colorsFromFeatures(features: ImmersiveFeature[] | undefined): string[] {
  const raw =
    featureValue(features, "color", "colour", "colors", "colours") ??
    featureValue(features, "primary color", "main color");
  if (!raw) return [];
  return raw
    .split(/[,;/]|(?:\s+and\s+)/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Fetch brand, material, color, and store pricing via SerpAPI Immersive Product. */
export async function fetchImmersiveProductMetadata(
  pageToken: string,
): Promise<ProductMetadata | null> {
  if (!serpApiEnabled() || !pageToken.trim()) return null;

  const data = await serpApiGet<ImmersiveResponse>({
    engine: "google_immersive_product",
    page_token: pageToken.trim(),
  });

  const product = data.product_results;
  if (!product?.title?.trim()) return null;

  const features = product.about_the_product?.features;
  const primaryStore = product.stores?.[0];
  const brand =
    product.brand?.trim() ||
    featureValue(features, "brand") ||
    "";
  const material = featureValue(features, "material", "fabric", "composition");
  const productUrl =
    primaryStore?.link?.trim() ||
    product.about_the_product?.link?.trim() ||
    "";

  return {
    name: product.title.trim(),
    brand,
    priceCents: parseStorePriceCents(primaryStore),
    currency: "USD",
    retailer: primaryStore?.name?.trim() || "",
    material: material ?? null,
    colors: colorsFromFeatures(features),
    imageUrls: [],
    productUrl,
  };
}

/** Best-effort immersive enrichment; never throws. */
export async function tryImmersiveProductMetadata(
  pageToken: string | undefined,
): Promise<ProductMetadata | null> {
  if (!pageToken?.trim()) return null;
  try {
    return await fetchImmersiveProductMetadata(pageToken);
  } catch (err) {
    log.warn("immersive-product.fetch.failed", { err: (err as Error).message });
    return null;
  }
}
