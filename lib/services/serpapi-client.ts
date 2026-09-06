import { strEnv } from "../env";

const SERPAPI_BASE = "https://serpapi.com/search.json";

export class SerpApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SerpApiError";
  }
}

/**
 * SerpAPI is back for one job: product lookup.
 *
 * Gemini runs everything else in this app, but it has no web access, so it can
 * name a garment and cannot price or link it — and an invented price silently
 * corrupts the wishlist budget. SerpAPI is the only lane here that returns a
 * real listing.
 *
 * Gated on the key alone. The old gate also required
 * USE_REAL_REVERSE_IMAGE_SEARCH, which made no sense for the text-search path:
 * Google Shopping is not a reverse-image search and needs no public image URL,
 * so it works from localhost the moment a key exists.
 */
export function serpApiEnabled(): boolean {
  return Boolean(strEnv("SERPAPI_KEY"));
}

/**
 * Google Lens additionally needs the image to be fetchable by SerpAPI, which
 * means a public HTTPS origin — not localhost. Separate from the check above so
 * the text lane is not held back by it.
 */
export function serpApiLensEnabled(): boolean {
  return serpApiEnabled() && Boolean(strEnv("PUBLIC_APP_URL") && strEnv("IMAGE_SECRET"));
}

export async function serpApiGet<T extends Record<string, unknown>>(
  params: Record<string, string>,
): Promise<T> {
  const key = strEnv("SERPAPI_KEY");
  if (!key) throw new SerpApiError("SERPAPI_KEY is not set");

  const url = new URL(SERPAPI_BASE);
  url.searchParams.set("api_key", key);
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), { next: { revalidate: 0 } });
  const body = (await res.json().catch(() => ({}))) as T & {
    error?: string;
  };

  if (!res.ok) {
    const msg = typeof body.error === "string" ? body.error : `SerpAPI HTTP ${res.status}`;
    throw new SerpApiError(msg);
  }
  if (typeof body.error === "string" && body.error) {
    throw new SerpApiError(body.error);
  }

  return body;
}
