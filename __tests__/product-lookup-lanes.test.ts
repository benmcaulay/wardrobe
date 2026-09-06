import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { serpApiEnabled, serpApiLensEnabled } from "@/lib/services/serpapi-client";

const ENV = { ...process.env };
const realFetch = globalThis.fetch;

beforeEach(() => {
  for (const v of ["SERPAPI_KEY", "PUBLIC_APP_URL", "IMAGE_SECRET", "GEMINI_API_KEY"]) {
    delete process.env[v];
  }
});
afterEach(() => {
  process.env = { ...ENV };
  globalThis.fetch = realFetch;
});

describe("serpApiEnabled", () => {
  /**
   * The old gate also required USE_REAL_REVERSE_IMAGE_SEARCH, which held back
   * the text lane for no reason: Google Shopping is not a reverse-image search,
   * needs no public image URL, and works from localhost the moment a key exists.
   */
  it("needs only a key, not the old reverse-image flag", () => {
    expect(serpApiEnabled()).toBe(false);
    process.env.SERPAPI_KEY = "k";
    expect(serpApiEnabled()).toBe(true);
    process.env.USE_REAL_REVERSE_IMAGE_SEARCH = "false";
    expect(serpApiEnabled()).toBe(true);
  });

  it("treats an empty key as absent", () => {
    process.env.SERPAPI_KEY = "";
    expect(serpApiEnabled()).toBe(false);
    process.env.SERPAPI_KEY = "   ";
    expect(serpApiEnabled()).toBe(false);
  });
});

describe("serpApiLensEnabled", () => {
  /**
   * Lens is gated separately because SerpAPI has to fetch the image itself,
   * which a localhost URL cannot satisfy. Enabling it without a public origin
   * would send every upload down a lane that always fails.
   */
  it("requires a public origin on top of the key", () => {
    process.env.SERPAPI_KEY = "k";
    expect(serpApiLensEnabled()).toBe(false);

    process.env.PUBLIC_APP_URL = "https://wardrobe.example";
    expect(serpApiLensEnabled()).toBe(false); // secret still missing

    process.env.IMAGE_SECRET = "s";
    expect(serpApiLensEnabled()).toBe(true);
  });

  it("is false without a key even when the origin is public", () => {
    process.env.PUBLIC_APP_URL = "https://wardrobe.example";
    process.env.IMAGE_SECRET = "s";
    expect(serpApiLensEnabled()).toBe(false);
  });
});

describe("searchWebProducts lane selection", () => {
  function stubSerp(results: unknown[]) {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ shopping_results: results }), { status: 200 })) as typeof fetch;
  }

  it("prefers SerpAPI and keeps its real price and URL", async () => {
    process.env.SERPAPI_KEY = "k";
    stubSerp([
      {
        title: "New Balance 2002R",
        source: "GOAT",
        link: "https://www.goat.com/sneakers/2002r",
        extracted_price: 129,
        immersive_product_page_token: "tok",
      },
    ]);
    const { searchWebProducts } = await import("@/lib/services/webProductSearch");
    const [top] = await searchWebProducts("2002r");
    expect(top.priceCents).toBe(12900);
    expect(top.url).toContain("goat.com");
    expect(top.immersiveProductPageToken).toBe("tok");
  });

  it("parses a string price when extracted_price is absent", async () => {
    process.env.SERPAPI_KEY = "k";
    stubSerp([{ title: "Trouser", link: "https://shop.example/x", price: "$89.50" }]);
    const { searchWebProducts } = await import("@/lib/services/webProductSearch");
    const [top] = await searchWebProducts("trouser");
    expect(top.priceCents).toBe(8950);
  });

  it("falls back to the stub when nothing is configured", async () => {
    const { searchWebProducts } = await import("@/lib/services/webProductSearch");
    const results = await searchWebProducts("anything");
    expect(results.length).toBeGreaterThan(0);
  });

  it("returns nothing for an empty query without calling out", async () => {
    process.env.SERPAPI_KEY = "k";
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    const { searchWebProducts } = await import("@/lib/services/webProductSearch");
    expect(await searchWebProducts("   ")).toEqual([]);
    expect(called).toBe(false);
  });

  /**
   * A SerpAPI outage must not take the feature down: a named piece with no price
   * still lets the user add it and paste a link afterwards.
   */
  it("falls through to gemini when SerpAPI errors", async () => {
    process.env.SERPAPI_KEY = "k";
    process.env.GEMINI_API_KEY = "g";
    let call = 0;
    globalThis.fetch = (async (url: string | URL | Request) => {
      call += 1;
      const href = String(url);
      if (href.includes("serpapi.com")) {
        return new Response(JSON.stringify({ error: "quota exhausted" }), { status: 401 });
      }
      return new Response(
        JSON.stringify({
          candidates: [
            { content: { parts: [{ text: '{"products":[{"name":"Wide Leg Trouser","brand":"COS","confidence":0.8}]}' }] } },
          ],
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const { searchWebProducts } = await import("@/lib/services/webProductSearch");
    const results = await searchWebProducts("cos trouser");
    expect(call).toBeGreaterThanOrEqual(2); // serp attempted, then gemini
    expect(results[0].name).toBe("Wide Leg Trouser");
    // Gemini cannot price or link, and must not pretend otherwise.
    expect(results[0].priceCents).toBe(0);
    expect(results[0].url).toBe("");
  });
});
