import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { searchWebProductsDetailed } from "@/lib/services/webProductSearch";
import { clearSearchCache } from "@/lib/services/product-search-cache";

const ENV = { ...process.env };
const realFetch = globalThis.fetch;

/** How many times SerpAPI was actually hit — i.e. how many searches were billed. */
let calls = 0;

function shoppingRow(i: number) {
  return {
    title: `Product ${i}`,
    link: `https://shop.example/p/${i}`,
    source: "Shop",
    extracted_price: 10 + i,
    thumbnail: `https://img.example/${i}.jpg`,
  };
}

/** Google Shopping really does return this many rows for one billed search. */
function mockSerp(rowCount: number) {
  calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return {
      ok: true,
      json: async () => ({
        shopping_results: Array.from({ length: rowCount }, (_, i) => shoppingRow(i)),
      }),
    };
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  clearSearchCache();
  process.env.SERPAPI_KEY = "test-key";
  delete process.env.GEMINI_API_KEY;
});

afterEach(() => {
  process.env = { ...ENV };
  globalThis.fetch = realFetch;
  clearSearchCache();
});

describe("result cap", () => {
  it("keeps every result the one billed search returned", async () => {
    // The old `.slice(0, 12)` threw ~48 of these away *after* paying for them.
    mockSerp(60);
    const { matches } = await searchWebProductsDetailed("black jeans");
    expect(matches).toHaveLength(60);
    expect(calls).toBe(1);
  });

  it("still costs exactly one search however many results come back", async () => {
    mockSerp(60);
    await searchWebProductsDetailed("black jeans");
    expect(calls).toBe(1);
  });

  it("skips rows with no title or link rather than emitting a dead result", async () => {
    calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return {
        ok: true,
        json: async () => ({
          shopping_results: [shoppingRow(0), { title: "No link" }, { link: "https://x/y" }],
        }),
      };
    }) as unknown as typeof fetch;
    const { matches } = await searchWebProductsDetailed("q");
    expect(matches).toHaveLength(1);
  });
});

describe("confidence spread", () => {
  it("anchors the first at 0.95 and the last at 0.35 whatever the count", async () => {
    for (const n of [2, 12, 60]) {
      clearSearchCache();
      mockSerp(n);
      const { matches } = await searchWebProductsDetailed(`q${n}`);
      expect(matches[0].confidence).toBeCloseTo(0.95, 5);
      expect(matches[matches.length - 1].confidence).toBeCloseTo(0.35, 5);
    }
  });

  it("keeps ranking meaningful past result 11", async () => {
    // The old fixed 0.06 decay with a 0.35 floor pinned everything from row 11
    // down to the same value, so the ordering signal vanished exactly where the
    // extra results now live.
    mockSerp(40);
    const { matches } = await searchWebProductsDetailed("black jeans");
    const tail = matches.slice(11).map((m) => m.confidence);
    expect(new Set(tail).size).toBeGreaterThan(1);
  });

  it("decreases monotonically", async () => {
    mockSerp(30);
    const { matches } = await searchWebProductsDetailed("black jeans");
    for (let i = 1; i < matches.length; i += 1) {
      expect(matches[i].confidence).toBeLessThanOrEqual(matches[i - 1].confidence);
    }
  });

  it("gives a lone result the top score rather than averaging it", async () => {
    mockSerp(1);
    const { matches } = await searchWebProductsDetailed("q");
    expect(matches[0].confidence).toBeCloseTo(0.95, 5);
  });
});

describe("caching", () => {
  it("serves a repeat query without billing a second search", async () => {
    mockSerp(20);
    const first = await searchWebProductsDetailed("black jeans");
    const second = await searchWebProductsDetailed("black jeans");

    expect(calls).toBe(1);
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.matches).toEqual(first.matches);
  });

  it("treats an equivalent spelling as the same search", async () => {
    mockSerp(5);
    await searchWebProductsDetailed("Black Jeans");
    const again = await searchWebProductsDetailed("  black   jeans ");
    expect(calls).toBe(1);
    expect(again.cached).toBe(true);
  });

  it("does not cache across genuinely different queries", async () => {
    mockSerp(5);
    await searchWebProductsDetailed("black jeans");
    await searchWebProductsDetailed("blue jeans");
    expect(calls).toBe(2);
  });

  it("caches an empty result so confirming nothing is not billed twice", async () => {
    calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return { ok: true, json: async () => ({ shopping_results: [] }) };
    }) as unknown as typeof fetch;

    const first = await searchWebProductsDetailed("asdfghjkl");
    const second = await searchWebProductsDetailed("asdfghjkl");
    expect(first.matches).toEqual([]);
    expect(second.cached).toBe(true);
    expect(calls).toBe(1);
  });

  it("reports the provider so the caller can bill it correctly", async () => {
    mockSerp(3);
    const res = await searchWebProductsDetailed("q");
    expect(res.provider).toBe("serpapi");
  });

  it("does not cache a failure, so a transient outage isn't sticky", async () => {
    calls = 0;
    let fail = true;
    globalThis.fetch = (async () => {
      calls += 1;
      if (fail) return { ok: false, json: async () => ({ error: "rate limited" }) };
      return {
        ok: true,
        json: async () => ({ shopping_results: [shoppingRow(0)] }),
      };
    }) as unknown as typeof fetch;

    // No gemini key either, so the failure falls through to the stub lane.
    const first = await searchWebProductsDetailed("black jeans");
    expect(first.provider).toBe("stub");

    fail = false;
    const second = await searchWebProductsDetailed("black jeans");
    expect(second.provider).toBe("serpapi");
    expect(second.matches).toHaveLength(1);
  });

  it("does not touch the network at all for a blank query", async () => {
    mockSerp(5);
    const res = await searchWebProductsDetailed("   ");
    expect(calls).toBe(0);
    expect(res.matches).toEqual([]);
    expect(res.cached).toBe(true);
  });
});
