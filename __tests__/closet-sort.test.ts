import { describe, expect, it } from "vitest";
import { sortWardrobeItems } from "@/lib/closet-sort";

const d = (iso: string) => new Date(iso);

function item(p: {
  id: string;
  priceCents: number | null;
  category: string;
  colors: string;
  season: string;
  createdAt: Date;
}) {
  return {
    id: p.id,
    priceCents: p.priceCents,
    category: p.category,
    colors: p.colors,
    season: p.season,
    createdAt: p.createdAt,
  };
}

describe("sortWardrobeItems", () => {
  it("sorts by price ascending with nulls last", () => {
    const rows = [
      item({
        id: "a",
        priceCents: 2000,
        category: "x",
        colors: "[]",
        season: "[]",
        createdAt: d("2024-01-02"),
      }),
      item({
        id: "b",
        priceCents: null,
        category: "x",
        colors: "[]",
        season: "[]",
        createdAt: d("2024-01-03"),
      }),
      item({
        id: "c",
        priceCents: 1000,
        category: "x",
        colors: "[]",
        season: "[]",
        createdAt: d("2024-01-01"),
      }),
    ];
    const out = sortWardrobeItems(rows, "price_asc");
    expect(out.map((r) => r.id)).toEqual(["c", "a", "b"]);
  });

  it("sorts by first color name", () => {
    const rows = [
      item({
        id: "a",
        priceCents: 0,
        category: "x",
        colors: `[{"hex":"#000","name":"Zebra"}]`,
        season: "[]",
        createdAt: d("2024-01-01"),
      }),
      item({
        id: "b",
        priceCents: 0,
        category: "x",
        colors: `[{"hex":"#fff","name":"Apple"}]`,
        season: "[]",
        createdAt: d("2024-01-02"),
      }),
    ];
    const out = sortWardrobeItems(rows, "color_asc");
    expect(out.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("uses custom color order from settings when provided", () => {
    const rows = [
      item({
        id: "black",
        priceCents: 0,
        category: "x",
        colors: `[{"hex":"#000","name":"black"}]`,
        season: "[]",
        createdAt: d("2024-01-01"),
      }),
      item({
        id: "red",
        priceCents: 0,
        category: "x",
        colors: `[{"hex":"#f00","name":"red"}]`,
        season: "[]",
        createdAt: d("2024-01-02"),
      }),
      item({
        id: "blue",
        priceCents: 0,
        category: "x",
        colors: `[{"hex":"#00f","name":"blue"}]`,
        season: "[]",
        createdAt: d("2024-01-03"),
      }),
    ];
    const out = sortWardrobeItems(rows, "color_asc", { colorOrder: ["blue", "red", "black"] });
    expect(out.map((r) => r.id)).toEqual(["blue", "red", "black"]);
  });

  it("uses custom category order and reverses with color_desc", () => {
    const rows = [
      item({
        id: "shoes",
        priceCents: 0,
        category: "shoes",
        colors: "[]",
        season: "[]",
        createdAt: d("2024-01-01"),
      }),
      item({
        id: "top",
        priceCents: 0,
        category: "top",
        colors: "[]",
        season: "[]",
        createdAt: d("2024-01-02"),
      }),
      item({
        id: "bottom",
        priceCents: 0,
        category: "bottom",
        colors: "[]",
        season: "[]",
        createdAt: d("2024-01-03"),
      }),
    ];
    const out = sortWardrobeItems(rows, "category_desc", {
      categoryOrder: ["top", "bottom", "shoes"],
    });
    expect(out.map((r) => r.id)).toEqual(["shoes", "bottom", "top"]);
  });

  it("uses manual group order within matching category and color", () => {
    const rows = [
      item({
        id: "a",
        priceCents: 0,
        category: "shirt",
        colors: `[{"hex":"#000","name":"black"}]`,
        season: "[]",
        createdAt: d("2024-01-03"),
      }),
      item({
        id: "b",
        priceCents: 0,
        category: "shirt",
        colors: `[{"hex":"#000","name":"black"}]`,
        season: "[]",
        createdAt: d("2024-01-02"),
      }),
      item({
        id: "c",
        priceCents: 0,
        category: "shirt",
        colors: `[{"hex":"#000","name":"black"}]`,
        season: "[]",
        createdAt: d("2024-01-01"),
      }),
    ];
    const out = sortWardrobeItems(rows, "color_asc", {
      closetGroupOrders: { "shirt\0black": ["c", "a", "b"] },
    });
    expect(out.map((r) => r.id)).toEqual(["c", "a", "b"]);
  });

  it("uses earliest season in calendar order for season_asc", () => {
    const rows = [
      item({
        id: "summerOnly",
        priceCents: 0,
        category: "x",
        colors: "[]",
        season: `["summer"]`,
        createdAt: d("2024-01-01"),
      }),
      item({
        id: "springWinter",
        priceCents: 0,
        category: "x",
        colors: "[]",
        season: `["winter","spring"]`,
        createdAt: d("2024-01-02"),
      }),
    ];
    const out = sortWardrobeItems(rows, "season_asc");
    // springWinter min is spring (0), summerOnly min is summer (1)
    expect(out[0].id).toBe("springWinter");
    expect(out[1].id).toBe("summerOnly");
  });
});
