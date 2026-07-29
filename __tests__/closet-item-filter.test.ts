import { describe, it, expect } from "vitest";
import { filterClosetItems, FILTER_CATEGORY_NONE } from "../lib/closet-item-filter";
import { SHARED_OWNER_FILTER } from "../lib/owners";
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
  owners: '["me"]',
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
  owner: "",
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

  it("filters by owner, with a person's view including shared items", () => {
    const mine = { ...baseItem, id: "mine", owners: '["me"]' };
    const hers = { ...baseItem, id: "hers", owners: '["her"]' };
    const shared = { ...baseItem, id: "shared", owners: '["me","her"]' };
    const items = [mine, hers, shared];

    // Everyone
    expect(filterClosetItems(items, emptyFilters)).toHaveLength(3);
    // Mine includes the shared piece
    expect(
      filterClosetItems(items, { ...emptyFilters, owner: "me" }).map((i) => i.id).sort(),
    ).toEqual(["mine", "shared"]);
    // Hers includes the shared piece
    expect(
      filterClosetItems(items, { ...emptyFilters, owner: "her" }).map((i) => i.id).sort(),
    ).toEqual(["hers", "shared"]);
    // Shared = 2+ owners only
    expect(
      filterClosetItems(items, { ...emptyFilters, owner: SHARED_OWNER_FILTER }).map((i) => i.id),
    ).toEqual(["shared"]);
  });
});
