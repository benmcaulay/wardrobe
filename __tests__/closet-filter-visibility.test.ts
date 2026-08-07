import { describe, it, expect } from "vitest";
import type { ActiveFilters } from "../components/closet-filters";
import {
  CLOSET_FILTER_KEYS,
  CLOSET_FILTER_LABELS,
  clearHiddenFilterValues,
  getHiddenFiltersFromPrefs,
  isClosetFilterKey,
  isFilterVisible,
  sanitizeHiddenFilters,
  toggleHiddenFilter,
} from "../lib/closet-filter-visibility";

const FULL: ActiveFilters = {
  q: "linen",
  categories: ["top"],
  brand: "Nike",
  colors: ["black"],
  season: "summer",
  tag: "casual",
  owner: "owner-1",
  sort: "newest",
};

describe("sanitizeHiddenFilters", () => {
  it("keeps known keys", () => {
    expect(sanitizeHiddenFilters(["season", "brand"])).toEqual(["brand", "season"]);
  });

  it("returns them in a stable canonical order regardless of input order", () => {
    expect(sanitizeHiddenFilters(["tag", "owner", "color"])).toEqual(["owner", "color", "tag"]);
  });

  it("drops unknown keys, duplicates and non-strings", () => {
    expect(
      sanitizeHiddenFilters(["season", "season", "nonsense", "", "sort", null as never, 7 as never]),
    ).toEqual(["season"]);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(sanitizeHiddenFilters([" Season ", "BRAND"])).toEqual(["brand", "season"]);
  });

  it("handles undefined and non-arrays", () => {
    expect(sanitizeHiddenFilters(undefined)).toEqual([]);
    expect(sanitizeHiddenFilters("season" as never)).toEqual([]);
  });
});

describe("getHiddenFiltersFromPrefs", () => {
  it("defaults to showing everything", () => {
    expect(getHiddenFiltersFromPrefs({})).toEqual([]);
  });

  it("reads and sanitizes the stored list", () => {
    expect(getHiddenFiltersFromPrefs({ hiddenClosetFilters: ["season", "bogus"] })).toEqual([
      "season",
    ]);
  });
});

describe("isFilterVisible", () => {
  it("is true unless the key is hidden", () => {
    expect(isFilterVisible("season", [])).toBe(true);
    expect(isFilterVisible("season", ["season"])).toBe(false);
    expect(isFilterVisible("brand", ["season"])).toBe(true);
  });
});

describe("clearHiddenFilterValues", () => {
  it("returns the same object when nothing is hidden", () => {
    expect(clearHiddenFilterValues(FULL, [])).toBe(FULL);
  });

  it("blanks a hidden filter so it stops narrowing the closet", () => {
    const out = clearHiddenFilterValues(FULL, ["season"]);
    expect(out.season).toBe("");
    // Everything else survives.
    expect(out.brand).toBe("Nike");
    expect(out.categories).toEqual(["top"]);
    expect(out.owner).toBe("owner-1");
  });

  it("blanks list filters to empty arrays, not empty strings", () => {
    const out = clearHiddenFilterValues(FULL, ["category", "color"]);
    expect(out.categories).toEqual([]);
    expect(out.colors).toEqual([]);
  });

  it("can blank every filter at once", () => {
    const out = clearHiddenFilterValues(FULL, [...CLOSET_FILTER_KEYS]);
    expect(out.owner).toBe("");
    expect(out.brand).toBe("");
    expect(out.season).toBe("");
    expect(out.tag).toBe("");
    expect(out.categories).toEqual([]);
    expect(out.colors).toEqual([]);
  });

  it("never touches search or sort — those aren't hideable", () => {
    const out = clearHiddenFilterValues(FULL, [...CLOSET_FILTER_KEYS]);
    expect(out.q).toBe("linen");
    expect(out.sort).toBe("newest");
  });

  it("does not mutate the input", () => {
    const input = { ...FULL };
    clearHiddenFilterValues(input, ["season"]);
    expect(input.season).toBe("summer");
  });
});

describe("toggleHiddenFilter", () => {
  it("hides and un-hides a key", () => {
    expect(toggleHiddenFilter([], "season", true)).toEqual(["season"]);
    expect(toggleHiddenFilter(["season"], "season", false)).toEqual([]);
  });

  it("is idempotent", () => {
    expect(toggleHiddenFilter(["season"], "season", true)).toEqual(["season"]);
    expect(toggleHiddenFilter([], "season", false)).toEqual([]);
  });

  it("keeps the canonical order as keys accumulate", () => {
    let hidden = toggleHiddenFilter([], "tag", true);
    hidden = toggleHiddenFilter(hidden, "owner", true);
    hidden = toggleHiddenFilter(hidden, "brand", true);
    expect(hidden).toEqual(["owner", "brand", "tag"]);
  });
});

describe("filter metadata", () => {
  it("is a known key for each entry and vice versa", () => {
    for (const key of CLOSET_FILTER_KEYS) expect(isClosetFilterKey(key)).toBe(true);
    expect(isClosetFilterKey("sort")).toBe(false);
    expect(isClosetFilterKey("q")).toBe(false);
  });

  it("gives every filter a label and a hint for the settings UI", () => {
    for (const key of CLOSET_FILTER_KEYS) {
      expect(CLOSET_FILTER_LABELS[key].label.length).toBeGreaterThan(0);
      expect(CLOSET_FILTER_LABELS[key].hint.length).toBeGreaterThan(0);
    }
  });
});
