import { describe, it, expect } from "vitest";
import {
  LISTING_EXPORT_README,
  buildListingExportFolderMeta,
  listingExportClipboardText,
  listingExportSlug,
} from "../lib/sell/listing-export";

describe("listingExportSlug", () => {
  it("slugifies the title and appends a short item id", () => {
    expect(
      listingExportSlug({
        title: "Everlane Oxford Shirt – Tops",
        itemId: "clxyzABCDEF",
      }),
    ).toBe("everlane-oxford-shirt-tops-abcdef");
  });

  it("falls back to brand + name when title is empty", () => {
    expect(
      listingExportSlug({
        title: "",
        brand: "Nike",
        name: "Air Force 1",
        itemId: "item99",
      }),
    ).toBe("nike-air-force-1-item99");
  });

  it("uses item when nothing else is available", () => {
    expect(listingExportSlug({ itemId: "abc123" })).toBe("item-abc123");
  });
});

describe("listingExportClipboardText", () => {
  it("builds paste-ready text with price, condition, and hashtags", () => {
    const text = listingExportClipboardText({
      title: "Everlane Oxford",
      description: "Crisp cotton.\n\n#everlane",
      askingCents: 2400,
      currency: "USD",
      condition: "like_new",
      item: {
        name: "Oxford",
        brand: "Everlane",
        category: "Tops",
        styleTags: ["minimal"],
      },
    });
    expect(text).toContain("Everlane Oxford");
    expect(text).toContain("Price: $24");
    expect(text).toContain("Condition: Like new");
    expect(text).toContain("Crisp cotton.");
    expect(text).toMatch(/#everlane/);
  });

  it("omits price when asking is null", () => {
    const text = listingExportClipboardText({
      title: "Tee",
      description: "Soft.",
      askingCents: null,
      item: { name: "Tee", category: "Tops" },
    });
    expect(text).not.toMatch(/Price:/);
    expect(text).toContain("Tee");
    expect(text).toContain("Soft.");
  });
});

describe("buildListingExportFolderMeta", () => {
  const baseItem = {
    name: "Oxford",
    brand: "Everlane",
    category: "Tops",
    subcategory: "Shirts",
    colors: [{ hex: "#ffffff", name: "White" }],
    material: "Cotton",
    pattern: null,
    styleTags: ["minimal"],
    season: ["spring"],
    notes: null,
    retailCents: 9800,
    retailCurrency: "USD",
    retailer: null,
    productUrl: null,
    timesWorn: 2,
    isWishlist: false,
  };

  const baseListing = {
    status: "for_sale",
    title: "Everlane Oxford",
    description: "Crisp cotton.",
    askingCents: 2400,
    soldPriceCents: null,
    currency: "USD",
    condition: "like_new" as const,
    marketplaces: ["depop"],
    clipboard: "Everlane Oxford\nPrice: $24\n\nCrisp cotton.",
  };

  it("encodes item + listing metadata and points thumbnail at the marked photo", () => {
    const meta = buildListingExportFolderMeta({
      itemId: "item1",
      folder: "everlane-oxford-item1",
      exportedAt: "2026-07-20T00:00:00.000Z",
      item: baseItem,
      listing: baseListing,
      photos: [
        {
          file: "01-primary.jpg",
          role: "primary",
          label: "primary",
          isThumbnail: true,
          source: "ghost",
        },
        {
          file: "02-view-back.jpg",
          role: "ghost_view",
          label: "back",
          isThumbnail: false,
          source: "ghost_view",
        },
      ],
    });

    expect(meta.version).toBe(2);
    expect(meta.thumbnail).toBe("01-primary.jpg");
    expect(meta.item.brand).toBe("Everlane");
    expect(meta.item.colors[0]?.name).toBe("White");
    expect(meta.listing.marketplaces).toEqual(["depop"]);
    expect(meta.photos.filter((p) => p.isThumbnail)).toHaveLength(1);
    expect(meta.photos[0]?.isThumbnail).toBe(true);
    expect(meta.photos[1]?.isThumbnail).toBe(false);
  });

  it("falls back to the first photo when none is marked thumbnail", () => {
    const meta = buildListingExportFolderMeta({
      itemId: "item1",
      folder: "tee-item1",
      exportedAt: "2026-07-20T00:00:00.000Z",
      item: { ...baseItem, name: "Tee", brand: null },
      listing: { ...baseListing, title: "Tee", marketplaces: [] },
      photos: [
        {
          file: "01-original.jpg",
          role: "original",
          label: "original",
          isThumbnail: false,
          source: "original",
        },
      ],
    });
    expect(meta.thumbnail).toBe("01-original.jpg");
    expect(meta.photos[0]?.isThumbnail).toBe(true);
  });

  it("uses empty thumbnail when there are no photos", () => {
    const meta = buildListingExportFolderMeta({
      itemId: "item1",
      folder: "empty-item1",
      exportedAt: "2026-07-20T00:00:00.000Z",
      item: baseItem,
      listing: baseListing,
      photos: [],
    });
    expect(meta.thumbnail).toBe("");
    expect(meta.photos).toEqual([]);
  });
});

describe("LISTING_EXPORT_README", () => {
  it("documents meta.json and thumbnail encoding", () => {
    expect(LISTING_EXPORT_README).toMatch(/meta\.json/);
    expect(LISTING_EXPORT_README).toMatch(/thumbnail/);
    expect(LISTING_EXPORT_README).toMatch(/listing\.txt/);
  });
});
