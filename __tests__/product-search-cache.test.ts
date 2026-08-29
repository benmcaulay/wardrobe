import { beforeEach, describe, expect, it } from "vitest";
import {
  clearSearchCache,
  getCachedSearch,
  searchCacheKey,
  searchCacheSize,
  SEARCH_CACHE_MAX_ENTRIES,
  SEARCH_CACHE_TTL_MS,
  setCachedSearch,
} from "@/lib/services/product-search-cache";

const T0 = 1_000_000;

beforeEach(() => {
  clearSearchCache();
});

describe("searchCacheKey", () => {
  it("collapses spellings SerpAPI would bill identically", () => {
    // These are one search to the biller, so they must be one search to us.
    expect(searchCacheKey("Black Jeans")).toBe("black jeans");
    expect(searchCacheKey("  black   jeans  ")).toBe("black jeans");
    expect(searchCacheKey("BLACK\tJEANS")).toBe("black jeans");
  });

  it("does not collapse genuinely different queries", () => {
    expect(searchCacheKey("black jeans")).not.toBe(searchCacheKey("blue jeans"));
  });
});

describe("get/setCachedSearch", () => {
  it("returns nothing for a query never searched", () => {
    expect(getCachedSearch("black jeans", T0)).toBeNull();
  });

  it("returns a stored value within the TTL", () => {
    setCachedSearch("black jeans", ["a"], T0);
    expect(getCachedSearch("black jeans", T0)).toEqual(["a"]);
    expect(getCachedSearch("black jeans", T0 + SEARCH_CACHE_TTL_MS - 1)).toEqual(["a"]);
  });

  it("hits across equivalent spellings, so the repeat is not billed", () => {
    setCachedSearch("Black  Jeans", ["a"], T0);
    expect(getCachedSearch("black jeans", T0)).toEqual(["a"]);
  });

  it("expires exactly at the TTL, not after it", () => {
    setCachedSearch("black jeans", ["a"], T0);
    expect(getCachedSearch("black jeans", T0 + SEARCH_CACHE_TTL_MS)).toBeNull();
  });

  it("drops an expired entry rather than leaving it in the map", () => {
    setCachedSearch("black jeans", ["a"], T0);
    expect(searchCacheSize()).toBe(1);
    getCachedSearch("black jeans", T0 + SEARCH_CACHE_TTL_MS);
    expect(searchCacheSize()).toBe(0);
  });

  it("caches an empty result, because re-confirming nothing is the worst search", () => {
    setCachedSearch("asdfghjkl", [], T0);
    expect(getCachedSearch("asdfghjkl", T0)).toEqual([]);
  });

  it("ignores a blank query in both directions", () => {
    setCachedSearch("   ", ["a"], T0);
    expect(searchCacheSize()).toBe(0);
    expect(getCachedSearch("   ", T0)).toBeNull();
  });

  it("overwrites and refreshes the timestamp on re-set", () => {
    setCachedSearch("q", ["old"], T0);
    setCachedSearch("q", ["new"], T0 + SEARCH_CACHE_TTL_MS - 1);
    expect(searchCacheSize()).toBe(1);
    // Still fresh well past the original entry's expiry.
    expect(getCachedSearch("q", T0 + SEARCH_CACHE_TTL_MS + 10)).toEqual(["new"]);
  });
});

describe("bounding", () => {
  it("never grows past the cap", () => {
    for (let i = 0; i < SEARCH_CACHE_MAX_ENTRIES + 50; i += 1) {
      setCachedSearch(`query ${i}`, [i], T0 + i);
    }
    expect(searchCacheSize()).toBe(SEARCH_CACHE_MAX_ENTRIES);
  });

  it("evicts the oldest, keeping the newest", () => {
    for (let i = 0; i < SEARCH_CACHE_MAX_ENTRIES + 1; i += 1) {
      setCachedSearch(`query ${i}`, [i], T0 + i);
    }
    expect(getCachedSearch("query 0", T0)).toBeNull();
    expect(getCachedSearch(`query ${SEARCH_CACHE_MAX_ENTRIES}`, T0)).toEqual([
      SEARCH_CACHE_MAX_ENTRIES,
    ]);
  });

  it("evicts least-recently-used, not least-recently-written", () => {
    // A hot query written first must survive; otherwise the entry doing the most
    // work to avoid billed searches is the first one thrown away.
    setCachedSearch("hot", ["hot"], T0);
    for (let i = 0; i < SEARCH_CACHE_MAX_ENTRIES - 1; i += 1) {
      setCachedSearch(`filler ${i}`, [i], T0 + i);
      getCachedSearch("hot", T0 + i);
    }
    setCachedSearch("one more", ["x"], T0 + 1);
    expect(getCachedSearch("hot", T0 + 1)).toEqual(["hot"]);
  });
});
