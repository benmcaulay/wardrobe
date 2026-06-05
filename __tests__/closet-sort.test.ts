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
