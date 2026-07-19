import { describe, it, expect } from "vitest";
import { filterClosetItems, FILTER_CATEGORY_NONE } from "../lib/closet-item-filter";
import type { ActiveFilters } from "../components/closet-filters";

const baseItem = {
  id: "1",
  name: "Oxford shirt",
  brand: "Brooks",
  category: "top",
  subcategory: null,
  pattern: null,
  material: null,
  styleTags: '["casual"]',
  notes: null,
  season: '["spring","summer"]',
  colors: '[{"name":"navy","hex":"#001f3f"}]',
  isWishlist: false,
  createdAt: new Date(),
};

const emptyFilters: ActiveFilters = {
  q: "",
  categories: [],
  brand: "",
  colors: [],
  season: "",
  tag: "",
  wishlist: false,
  sort: "newest",
};

describe("filterClosetItems", () => {
  it("matches text search on category, color, and season", () => {
    expect(filterClosetItems([baseItem], { ...emptyFilters, q: "top" })).toHaveLength(1);
    expect(filterClosetItems([baseItem], { ...emptyFilters, q: "navy" })).toHaveLength(1);
    expect(filterClosetItems([baseItem], { ...emptyFilters, q: "spring" })).toHaveLength(1);
    expect(filterClosetItems([baseItem], { ...emptyFilters, q: "zzz" })).toHaveLength(0);
  });

  it("matches structured category and season filters", () => {
    expect(
      filterClosetItems([baseItem], { ...emptyFilters, categories: ["top"] }),
    ).toHaveLength(1);
    expect(
      filterClosetItems([baseItem], { ...emptyFilters, season: "spring" }),
    ).toHaveLength(1);
    expect(
      filterClosetItems([baseItem], { ...emptyFilters, categories: [FILTER_CATEGORY_NONE] }),
    ).toHaveLength(0);
  });
});
