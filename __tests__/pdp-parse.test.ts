import { describe, it, expect } from "vitest";
import { hostOf, parseProductHtml, retailerFromHost, toCents } from "../lib/services/pdp-parse";

const URL_UNDER_TEST = "https://www.everlane.com/products/mens-linen-shirt";

function page(body: string): string {
  return `<!doctype html><html><head>${body}</head><body></body></html>`;
}

function ldScript(json: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(json)}</script>`;
}

describe("toCents", () => {
  it("reads plain numbers and numeric strings", () => {
    expect(toCents(49)).toBe(4900);
    expect(toCents("49")).toBe(4900);
    expect(toCents("49.99")).toBe(4999);
  });

  it("strips currency symbols and thousands separators", () => {
    expect(toCents("$1,299.00")).toBe(129_900);
    expect(toCents("USD 49.00")).toBe(4900);
    expect(toCents("£85")).toBe(8500);
  });

  it("handles European decimal commas", () => {
    expect(toCents("1.299,00")).toBe(129_900);
    expect(toCents("49,95")).toBe(4995);
  });

  it("returns 0 for junk and non-positive values", () => {
    expect(toCents("")).toBe(0);
    expect(toCents("free")).toBe(0);
    expect(toCents(0)).toBe(0);
    expect(toCents(-10)).toBe(0);
    expect(toCents(null)).toBe(0);
    expect(toCents(undefined)).toBe(0);
  });
});

describe("hostOf / retailerFromHost", () => {
  it("normalises hosts", () => {
    expect(hostOf("https://WWW.Everlane.com/x")).toBe("everlane.com");
    expect(hostOf("not a url")).toBe("");
  });

  it("derives a readable retailer label", () => {
    expect(retailerFromHost("everlane.com")).toBe("Everlane");
    expect(retailerFromHost("shop.madewell.com")).toBe("Madewell");
    expect(retailerFromHost("nordstrom.co.uk")).toBe("Co");
  });
});

describe("parseProductHtml — JSON-LD", () => {
  it("reads a schema.org Product", () => {
    const html = page(
      ldScript({
        "@context": "https://schema.org",
        "@type": "Product",
        name: "Linen Shirt",
        brand: { "@type": "Brand", name: "Everlane" },
        material: "Linen",
        color: "Sand",
        image: ["https://cdn.everlane.com/shirt.jpg"],
        offers: {
          "@type": "Offer",
          price: "88.00",
          priceCurrency: "USD",
          availability: "https://schema.org/InStock",
        },
      }),
    );

    const meta = parseProductHtml(html, URL_UNDER_TEST);
    expect(meta).not.toBeNull();
    expect(meta!.name).toBe("Linen Shirt");
    expect(meta!.brand).toBe("Everlane");
    expect(meta!.priceCents).toBe(8800);
    expect(meta!.currency).toBe("USD");
    expect(meta!.material).toBe("Linen");
    expect(meta!.colors).toEqual(["Sand"]);
    expect(meta!.imageUrls).toContain("https://cdn.everlane.com/shirt.jpg");
    expect(meta!.productUrl).toBe(URL_UNDER_TEST);
  });

  it("finds a Product nested in an @graph", () => {
    const html = page(
      ldScript({
        "@context": "https://schema.org",
        "@graph": [
          { "@type": "Organization", name: "Everlane" },
          {
            "@type": "Product",
            name: "Wool Trouser",
            offers: { "@type": "Offer", price: 148, priceCurrency: "USD" },
          },
        ],
      }),
    );
    const meta = parseProductHtml(html, URL_UNDER_TEST);
    expect(meta!.name).toBe("Wool Trouser");
    expect(meta!.priceCents).toBe(14_800);
  });

  it("prefers an in-stock offer over a sold-out one", () => {
    const html = page(
      ldScript({
        "@type": "Product",
        name: "Chore Jacket",
        offers: [
          { "@type": "Offer", price: "10.00", availability: "https://schema.org/OutOfStock" },
          { "@type": "Offer", price: "168.00", availability: "https://schema.org/InStock" },
        ],
      }),
    );
    expect(parseProductHtml(html, URL_UNDER_TEST)!.priceCents).toBe(16_800);
  });

  it("unwraps an AggregateOffer", () => {
    const html = page(
      ldScript({
        "@type": "Product",
        name: "Denim Jacket",
        offers: {
          "@type": "AggregateOffer",
          lowPrice: "98.00",
          priceCurrency: "USD",
        },
      }),
    );
    expect(parseProductHtml(html, URL_UNDER_TEST)!.priceCents).toBe(9800);
  });

  it("survives a malformed JSON-LD block next to a good one", () => {
    const html = page(
      `<script type="application/ld+json">{ oops </script>` +
        ldScript({ "@type": "Product", name: "Silk Scarf", offers: { price: "45" } }),
    );
    expect(parseProductHtml(html, URL_UNDER_TEST)!.name).toBe("Silk Scarf");
  });
});

describe("parseProductHtml — meta tags", () => {
  it("falls back to OpenGraph when there is no JSON-LD", () => {
    const html = page(`
      <meta property="og:title" content="Cashmere Crew &amp; Co">
      <meta property="og:image" content="https://cdn.example.com/crew.jpg">
      <meta property="og:site_name" content="COS">
      <meta property="product:price:amount" content="120.00">
      <meta property="product:price:currency" content="USD">
    `);

    const meta = parseProductHtml(html, "https://www.cos.com/en/product/123");
    expect(meta!.name).toBe("Cashmere Crew & Co");
    expect(meta!.priceCents).toBe(12_000);
    expect(meta!.retailer).toBe("COS");
    expect(meta!.imageUrls).toEqual(["https://cdn.example.com/crew.jpg"]);
  });

  it("matches meta tags with the attributes in either order", () => {
    const html = page(`<meta content="Reverse Order Tee" property="og:title">
      <meta content="https://cdn.example.com/t.jpg" property="og:image">`);
    expect(parseProductHtml(html, URL_UNDER_TEST)!.name).toBe("Reverse Order Tee");
  });

  it("resolves a relative og:image against the page URL", () => {
    const html = page(`<meta property="og:title" content="Relative Image Tee">
      <meta property="og:image" content="/img/tee.jpg">`);
    const meta = parseProductHtml(html, "https://shop.example.com/p/tee");
    expect(meta!.imageUrls).toEqual(["https://shop.example.com/img/tee.jpg"]);
  });

  it("backfills a JSON-LD product that omits its price", () => {
    const html = page(
      ldScript({ "@type": "Product", name: "Priceless Coat" }) +
        `<meta property="og:image" content="https://cdn.example.com/coat.jpg">
         <meta property="product:price:amount" content="395.00">`,
    );
    const meta = parseProductHtml(html, URL_UNDER_TEST);
    expect(meta!.name).toBe("Priceless Coat");
    expect(meta!.priceCents).toBe(39_500);
  });
});

describe("parseProductHtml — refusing to guess", () => {
  it("returns null for a page with no product signal at all", () => {
    expect(parseProductHtml(page("<title></title>"), URL_UNDER_TEST)).toBeNull();
  });

  it("returns null when there's a name but neither a price nor an image", () => {
    const html = page(`<title>Some Store</title>`);
    expect(parseProductHtml(html, URL_UNDER_TEST)).toBeNull();
  });

  it("returns null for an unparseable URL", () => {
    expect(parseProductHtml(page("<title>x</title>"), "not-a-url")).toBeNull();
  });

  it("keeps an item that has a photo but no price, so the user can fill it in", () => {
    const html = page(`<meta property="og:title" content="Unpriced Coat">
      <meta property="og:image" content="https://cdn.example.com/c.jpg">`);
    const meta = parseProductHtml(html, URL_UNDER_TEST);
    expect(meta).not.toBeNull();
    expect(meta!.priceCents).toBe(0);
    expect(meta!.imageUrls).toHaveLength(1);
  });
});
