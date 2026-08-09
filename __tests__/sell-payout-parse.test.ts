import { describe, it, expect } from "vitest";
import { completePayoutParse, parsePayoutEmail } from "../lib/sell/payout-parse";

// Fixtures are shaped like the plain-text rendering of each platform's real
// payout mail — the messy, label-on-its-own-line output you get from pasting
// an HTML email into a textarea.

const POSHMARK = `
From: no-reply@poshmark.com
Subject: Your sale has shipped!

Congratulations, your listing sold.

Item: Vintage Levi's 501 Denim Jacket
Order date: March 14, 2026

Order total          $85.00
Poshmark fee         -$17.00
Your earnings        $68.00
`;

const DEPOP = `
Depop
Your item sold

"Carhartt Detroit Jacket" sold
Sale price
$120.00
Shipping
$8.50
Depop fee
$4.41
You'll receive
$107.09
`;

const EBAY = `
eBay: Your item sold
Sold on 2026-04-02
Item price: $240.00
Final value fee: -$32.10
Shipping label: -$12.00
Net earnings: $195.90
`;

const VINTED = `
vinted.co.uk
Great news, your item sold!
Item price £42.00
You earned £42.00
`;

describe("parsePayoutEmail", () => {
  it("returns an empty parse for empty input", () => {
    const p = parsePayoutEmail("");
    expect(p.confidence).toBe(0);
    expect(p.found).toEqual([]);
    expect(p.platform).toBeNull();
  });

  it("returns an empty parse for text with nothing in it", () => {
    const p = parsePayoutEmail("hello, how are you today?");
    expect(p.grossCents).toBeNull();
    expect(p.netCents).toBeNull();
    expect(p.confidence).toBeLessThan(0.5);
  });

  it("never throws on junk", () => {
    for (const junk of ["$", "----", "$$$ 1 2 3", "\n\n\n", "fee fee fee"]) {
      expect(() => parsePayoutEmail(junk)).not.toThrow();
    }
  });

  it("parses a Poshmark sale end to end", () => {
    const p = parsePayoutEmail(POSHMARK);
    expect(p.platform).toBe("poshmark");
    expect(p.grossCents).toBe(8500);
    expect(p.feeCents).toBe(1700);
    expect(p.netCents).toBe(6800);
    expect(p.itemHint).toBe("Vintage Levi's 501 Denim Jacket");
    expect(p.currency).toBe("USD");
    expect(p.reconciliationWarning).toBeNull();
    expect(p.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("reads the sale date when the line is labelled", () => {
    expect(parsePayoutEmail(POSHMARK).soldAtMs).toBe(Date.parse("March 14, 2026"));
    expect(parsePayoutEmail(EBAY).soldAtMs).toBe(Date.parse("2026-04-02"));
  });

  it("picks up an amount sitting on the line after its label", () => {
    // Depop's template puts every value on its own line.
    const p = parsePayoutEmail(DEPOP);
    expect(p.platform).toBe("depop");
    expect(p.grossCents).toBe(12000);
    expect(p.shippingCents).toBe(850);
    expect(p.feeCents).toBe(441);
    expect(p.netCents).toBe(10709);
    expect(p.reconciliationWarning).toBeNull();
  });

  it("reads a negative amount as a positive cost", () => {
    const p = parsePayoutEmail(EBAY);
    expect(p.feeCents).toBe(3210);
    expect(p.shippingCents).toBe(1200);
    expect(p.netCents).toBe(19590);
  });

  it("does not mistake 'shipping fee' for a commission", () => {
    const p = parsePayoutEmail("Item price $50.00\nShipping fee $7.00\nYou earned $43.00");
    expect(p.shippingCents).toBe(700);
    expect(p.feeCents).toBeNull();
  });

  it("handles a zero-fee platform", () => {
    const p = parsePayoutEmail(VINTED);
    expect(p.platform).toBe("vinted");
    expect(p.grossCents).toBe(4200);
    expect(p.netCents).toBe(4200);
    expect(p.currency).toBe("GBP");
  });

  it("parses thousands separators", () => {
    const p = parsePayoutEmail("Grailed\nSale price: $1,250.00\nCommission: $112.50");
    expect(p.grossCents).toBe(125000);
    expect(p.feeCents).toBe(11250);
  });

  it("warns when the arithmetic doesn't hold", () => {
    // Gross 100 − fee 10 = 90, but the email claims 50 — a label got mismatched.
    const p = parsePayoutEmail("Item price $100.00\nSelling fee $10.00\nYour earnings $50.00");
    expect(p.reconciliationWarning).toMatch(/90\.00/);
    expect(p.reconciliationWarning).toMatch(/50\.00/);
    expect(p.confidence).toBeLessThan(0.7);
  });

  it("records which fields it actually read", () => {
    const p = parsePayoutEmail(POSHMARK);
    expect(p.found).toContain("platform");
    expect(p.found).toContain("gross");
    expect(p.found).toContain("fee");
    expect(p.found).toContain("net");
    expect(p.found).not.toContain("shipping");
  });

  it("stays confident about a partial parse it can verify", () => {
    const full = parsePayoutEmail(POSHMARK);
    const noPlatform = parsePayoutEmail(POSHMARK.replace(/poshmark/gi, "acme"));
    expect(noPlatform.platform).toBeNull();
    expect(noPlatform.grossCents).toBe(8500);
    expect(noPlatform.confidence).toBeLessThan(full.confidence);
    expect(noPlatform.confidence).toBeGreaterThan(0.4);
  });

  it("does not read a money value as the item name", () => {
    const p = parsePayoutEmail("Item: $42.00\nOrder total $42.00");
    expect(p.itemHint).toBeNull();
  });

  it("ignores a bare date with no label", () => {
    expect(parsePayoutEmail("Item price $10.00\n2026-01-01").soldAtMs).toBeNull();
  });
});

describe("completePayoutParse", () => {
  it("derives the fee from gross and net", () => {
    const p = completePayoutParse(parsePayoutEmail("Order total $100.00\nYour earnings $80.00"));
    expect(p.feeCents).toBe(2000);
    expect(p.derived).toContain("fee");
  });

  it("accounts for shipping when deriving the fee", () => {
    const p = completePayoutParse(
      parsePayoutEmail("Order total $100.00\nShipping $10.00\nYour earnings $80.00"),
    );
    expect(p.feeCents).toBe(1000);
  });

  it("derives the net from gross and fee", () => {
    const p = completePayoutParse(parsePayoutEmail("Order total $100.00\nSelling fee $15.00"));
    expect(p.netCents).toBe(8500);
    expect(p.derived).toContain("net");
  });

  it("derives the gross from net and fee", () => {
    const p = completePayoutParse(parsePayoutEmail("Selling fee $15.00\nYour earnings $85.00"));
    expect(p.grossCents).toBe(10000);
    expect(p.derived).toContain("gross");
  });

  it("refuses a negative implied fee rather than inventing one", () => {
    // Net above gross is nonsense; leave it null so the user resolves it.
    const p = completePayoutParse(parsePayoutEmail("Order total $50.00\nYour earnings $80.00"));
    expect(p.feeCents).toBeNull();
    expect(p.derived).not.toContain("fee");
  });

  it("leaves an already-complete parse alone", () => {
    const p = completePayoutParse(parsePayoutEmail(POSHMARK));
    expect(p.derived).toEqual([]);
    expect(p.feeCents).toBe(1700);
  });
});
