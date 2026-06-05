const SERPAPI_BASE = "https://serpapi.com/search.json";

export class SerpApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SerpApiError";
  }
}

export function serpApiEnabled(): boolean {
  return (
    process.env.USE_REAL_REVERSE_IMAGE_SEARCH === "true" &&
    !!process.env.SERPAPI_KEY?.trim()
  );
}

export async function serpApiGet<T extends Record<string, unknown>>(
  params: Record<string, string>,
): Promise<T> {
  const key = process.env.SERPAPI_KEY?.trim();
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
