import { describe, it, expect } from "vitest";
import {
  summarizeListings,
  listingClipboardText,
  type SummarizableListing,
} from "../lib/sale-listing";

describe("summarizeListings", () => {
  const listings: SummarizableListing[] = [
    { status: "for_sale", askingCents: 2000, currency: "USD" },
    { status: "for_sale", askingCents: null, currency: "USD" }, // no price → counts, adds 0
    { status: "listed", askingCents: 3500, currency: "USD" },
    { status: "sold", askingCents: 1500, currency: "USD" },
    { status: "sold", askingCents: 4000, currency: "USD" },
    { status: "skipped", askingCents: 9999, currency: "USD" }, // ignored entirely
  ];

  it("counts each lifecycle bucket", () => {
    const s = summarizeListings(listings);
    expect(s.forSaleCount).toBe(2);
    expect(s.listedCount).toBe(1);
    expect(s.soldCount).toBe(2);
    expect(s.activeCount).toBe(3); // for_sale + listed
  });

  it("sums active asking and sold value, treating null prices as 0", () => {
    const s = summarizeListings(listings);
    expect(s.activeAskingCents).toBe(2000 + 0 + 3500);
    expect(s.soldValueCents).toBe(1500 + 4000);
  });

  it("ignores skipped (kept) items in every total", () => {
    const s = summarizeListings(listings);
    expect(s.activeAskingCents).not.toContain(9999);
    expect(s.forSaleCount + s.listedCount + s.soldCount).toBe(5);
  });

  it("handles an empty board", () => {
    const s = summarizeListings([]);
    expect(s).toMatchObject({ forSaleCount: 0, activeAskingCents: 0, soldValueCents: 0, currency: "USD" });
  });

  it("adopts the currency of the first listing that has one", () => {
    expect(summarizeListings([{ status: "sold", askingCents: 100, currency: "EUR" }]).currency).toBe("EUR");
  });

  it("counts actual sold price when recorded, falling back to asking", () => {
    const s = summarizeListings([
      { status: "sold", askingCents: 5000, soldPriceCents: 4200 }, // sold below asking
      { status: "sold", askingCents: 3000, soldPriceCents: null }, // legacy row → asking
    ]);
    expect(s.soldValueCents).toBe(4200 + 3000);
  });
});

describe("listingClipboardText", () => {
  it("includes title, price, condition, body, and hashtags in order", () => {
    const text = listingClipboardText({
      title: "Everlane Oxford Shirt",
      description: "Crisp cotton oxford.",
      askingCents: 2400,
      currency: "USD",
      condition: "like_new",
      hashtags: ["#everlane", "#oxford"],
    });
    expect(text).toBe(
      "Everlane Oxford Shirt\nPrice: $24\nCondition: Like new\n\nCrisp cotton oxford.\n\n#everlane #oxford",
    );
  });

  it("omits the price line when there's no asking price", () => {
    const text = listingClipboardText({ title: "Tee", description: "Soft.", askingCents: null });
    expect(text).toBe("Tee\n\nSoft.");
    expect(text).not.toMatch(/Price:/);
  });

  it("omits hashtags when none are given", () => {
    const text = listingClipboardText({
      title: "Tee",
      description: "Soft.",
      askingCents: 1000,
      hashtags: [],
    });
    expect(text).toBe("Tee\nPrice: $10\n\nSoft.");
  });
});
