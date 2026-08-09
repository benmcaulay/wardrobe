/**
 * Pull the numbers out of a pasted marketplace payout or sale-confirmation
 * email, so logging a sale is a paste rather than five fields of typing.
 *
 * This is deliberately best-effort. Marketplaces change their email templates
 * without warning, and a parser that silently guesses wrong is worse than one
 * that admits it doesn't know — a mis-parsed fee quietly corrupts every net
 * number on the Sell landing. So:
 *
 *   - every field is independently nullable; a partial parse is a success
 *   - `found` lists exactly which fields came out of the text
 *   - `confidence` drops when the amounts don't reconcile
 *   - the caller must render the result into editable fields for confirmation,
 *     never write it straight to the database
 *
 * Pure and dependency-free, so the tests are plain fixtures.
 */
import { MARKETPLACES, type MarketplaceId } from "@/lib/marketplaces";

export type PayoutField = "platform" | "gross" | "fee" | "shipping" | "net" | "item" | "soldAt";

export type PayoutParse = {
  platform: MarketplaceId | null;
  /** What the buyer paid for the item, before the platform's cut. */
  grossCents: number | null;
  feeCents: number | null;
  /** Shipping charged to the seller. Buyer-paid postage is not a seller cost. */
  shippingCents: number | null;
  /** What the seller actually receives. */
  netCents: number | null;
  currency: string;
  /** The item's name, when the email states it. */
  itemHint: string | null;
  soldAtMs: number | null;
  /** Which fields were genuinely read from the text. */
  found: PayoutField[];
  /** 0..1. Below ~0.5 the UI should treat this as a hint, not an answer. */
  confidence: number;
  /**
   * Set when gross − fee − shipping doesn't match the stated net. Usually
   * means a label was matched to the wrong amount, and the user needs to look.
   */
  reconciliationWarning: string | null;
};

/** Domains and names that identify the sender. Ordered most- to least-specific. */
const PLATFORM_SIGNALS: { platform: MarketplaceId; patterns: RegExp[] }[] = [
  { platform: "depop", patterns: [/\bdepop\.com\b/i, /\bdepop\b/i] },
  { platform: "poshmark", patterns: [/\bposhmark\.com\b/i, /\bposhmark\b/i, /\bposh\s+protect\b/i] },
  { platform: "mercari", patterns: [/\bmercari\.com\b/i, /\bmercari\b/i] },
  { platform: "vinted", patterns: [/\bvinted\.[a-z.]+\b/i, /\bvinted\b/i] },
  { platform: "grailed", patterns: [/\bgrailed\.com\b/i, /\bgrailed\b/i] },
  { platform: "ebay", patterns: [/\bebay\.[a-z.]+\b/i, /\bebay\b/i] },
  {
    platform: "facebook",
    patterns: [/\bfacebook\.com\b/i, /\bmarketplace\b.*\bfacebook\b/i, /\bfacebook\b/i],
  },
];

/**
 * Which label means which amount. Order matters and is load-bearing: "shipping
 * fee" must be read as shipping, not as a commission, so the shipping matchers
 * run before the fee ones. Within a group, longer/more specific phrases lead.
 */
const AMOUNT_LABELS: { field: Exclude<PayoutField, "platform" | "item" | "soldAt">; patterns: RegExp[] }[] = [
  {
    field: "net",
    patterns: [
      /\byour?\s+(?:total\s+)?earnings?\b/i,
      /\bnet\s+(?:earnings?|payout|proceeds|amount|total)\b/i,
      /\byou(?:'ll| will)?\s+(?:earn|receive|get)\b/i,
      /\byou\s+earned\b/i,
      /\btotal\s+payout\b/i,
      /\bpayout\s+amount\b/i,
      /\bamount\s+(?:credited|deposited)\b/i,
      /\bseller\s+earnings\b/i,
      /\bpayout\b/i,
    ],
  },
  {
    field: "shipping",
    patterns: [
      /\bshipping\s+(?:label|cost|charge|paid\s+by\s+you|deducted)\b/i,
      /\b(?:you\s+paid\s+for\s+)?postage\b/i,
      /\bdelivery\s+(?:cost|charge)\b/i,
      /\bshipping\s+fee\b/i,
      /\bshipping\b/i,
    ],
  },
  {
    field: "fee",
    patterns: [
      /\bfinal\s+value\s+fee\b/i,
      /\b(?:selling|seller|service|commission|transaction|processing|marketplace)\s+fees?\b/i,
      /\bposh(?:mark)?\s+fee\b/i,
      /\bdepop\s+fee\b/i,
      /\bcommission\b/i,
      /\bfees?\s+(?:charged|deducted|taken)\b/i,
      /\bfees?\b/i,
    ],
  },
  {
    field: "gross",
    patterns: [
      /\b(?:item|listing|sale|sold)\s+(?:price|total)\b/i,
      /\bsold\s+for\b/i,
      /\border\s+total\b/i,
      /\bsubtotal\b/i,
      /\bitem\s+subtotal\b/i,
      /\bprice\b/i,
    ],
  },
];

const CURRENCY_SYMBOLS: Record<string, string> = { $: "USD", "£": "GBP", "€": "EUR" };

/**
 * An amount anywhere in a line: "$12.34", "-$5.00", "USD 12.34", "12,345.67 €".
 * The leading sign is captured but ignored — a fee is a cost whether the email
 * writes it as "-$5.00" or "$5.00".
 */
const AMOUNT_RE =
  /(-|−)?\s*(?:(USD|GBP|EUR|CAD|AUD)\s*)?([$£€])?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s*([$£€])?\s*(USD|GBP|EUR|CAD|AUD)?/i;

const DATE_LABEL_RE =
  /\b(?:sold|purchased|order(?:ed)?|sale|payment)\s+(?:on|date|placed)?\b|\bdate\s+of\s+sale\b/i;

/** Cents from a matched amount, or null when the digits don't make sense. */
function toCents(raw: string): number | null {
  const value = Number.parseFloat(raw.replace(/,/g, ""));
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

function detectPlatform(text: string): MarketplaceId | null {
  for (const signal of PLATFORM_SIGNALS) {
    if (signal.patterns.some((p) => p.test(text))) return signal.platform;
  }
  return null;
}

function detectCurrency(text: string): string {
  const symbol = text.match(/[$£€]/)?.[0];
  if (symbol && CURRENCY_SYMBOLS[symbol]) return CURRENCY_SYMBOLS[symbol];
  const code = text.match(/\b(USD|GBP|EUR|CAD|AUD)\b/i)?.[1];
  return code ? code.toUpperCase() : "USD";
}

/**
 * Which labelled amount, if any, this line carries. Returns the first label
 * that matches, honouring AMOUNT_LABELS order so "shipping fee" is shipping.
 */
function classifyLine(line: string): Exclude<PayoutField, "platform" | "item" | "soldAt"> | null {
  for (const group of AMOUNT_LABELS) {
    if (group.patterns.some((p) => p.test(line))) return group.field;
  }
  return null;
}

/** The item name, from the handful of phrasings that reliably introduce it. */
function extractItemHint(lines: readonly string[]): string | null {
  const patterns = [
    /\b(?:item|listing|product)\s*[:\-–]\s*(.+)$/i,
    /\byour\s+(?:item|listing)\s+"([^"]+)"/i,
    /\b(?:sold|purchased)\s*[:\-–]\s*(.+)$/i,
    /^"([^"]{3,120})"\s+(?:sold|has sold)/i,
  ];
  for (const line of lines) {
    for (const p of patterns) {
      const m = line.match(p);
      const hint = m?.[1]?.trim().replace(/\s+/g, " ");
      // Guard against swallowing a money line that happens to follow a colon.
      if (hint && hint.length >= 2 && hint.length <= 140 && !/^[-−]?[$£€]?\d/.test(hint)) {
        return hint;
      }
    }
  }
  return null;
}

/** A sale date, only from an explicitly labelled line — never a bare date. */
function extractSoldAt(lines: readonly string[]): number | null {
  for (const line of lines) {
    if (!DATE_LABEL_RE.test(line)) continue;
    const m = line.match(
      /\b(\d{4}-\d{2}-\d{2}|[A-Z][a-z]{2,8}\s+\d{1,2},?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4})\b/,
    );
    if (!m) continue;
    const parsed = Date.parse(m[1]);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

/** Tolerance for the reconciliation check — a cent or two of rounding is fine. */
const RECONCILE_TOLERANCE_CENTS = 2;

/**
 * Parse a pasted payout email. Never throws: unrecognisable input comes back
 * as an all-null parse with zero confidence, which the UI shows as "couldn't
 * read that — fill it in below".
 */
export function parsePayoutEmail(raw: string): PayoutParse {
  const empty: PayoutParse = {
    platform: null,
    grossCents: null,
    feeCents: null,
    shippingCents: null,
    netCents: null,
    currency: "USD",
    itemHint: null,
    soldAtMs: null,
    found: [],
    confidence: 0,
    reconciliationWarning: null,
  };
  if (typeof raw !== "string" || !raw.trim()) return empty;

  const text = raw.replace(/ /g, " ");
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const found = new Set<PayoutField>();
  const platform = detectPlatform(text);
  if (platform) found.add("platform");

  const amounts: Partial<Record<"gross" | "fee" | "shipping" | "net", number>> = {};
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const field = classifyLine(line);
    if (!field || amounts[field] != null) continue;

    // Amount usually sits on the label's own line; HTML-to-text conversion
    // often pushes it onto the next one, so fall through to that.
    let match = line.match(AMOUNT_RE);
    if (!match && lines[i + 1] && !classifyLine(lines[i + 1])) {
      match = lines[i + 1].match(AMOUNT_RE);
    }
    if (!match) continue;

    const cents = toCents(match[4]);
    if (cents == null) continue;
    amounts[field] = cents;
    found.add(field);
  }

  const itemHint = extractItemHint(lines);
  if (itemHint) found.add("item");
  const soldAtMs = extractSoldAt(lines);
  if (soldAtMs != null) found.add("soldAt");

  const grossCents = amounts.gross ?? null;
  const feeCents = amounts.fee ?? null;
  const shippingCents = amounts.shipping ?? null;
  const netCents = amounts.net ?? null;

  // Does the arithmetic hold? Only checkable with a gross and a net.
  let reconciliationWarning: string | null = null;
  let reconciles = false;
  if (grossCents != null && netCents != null) {
    const expected = grossCents - (feeCents ?? 0) - (shippingCents ?? 0);
    const drift = Math.abs(expected - netCents);
    if (drift <= RECONCILE_TOLERANCE_CENTS) {
      reconciles = true;
    } else {
      reconciliationWarning = `Sale price minus fees comes to ${formatPlain(expected)}, but the email says ${formatPlain(netCents)}. Check the amounts below.`;
    }
  }

  let confidence = 0;
  if (platform) confidence += 0.3;
  if (grossCents != null) confidence += 0.3;
  if (netCents != null) confidence += 0.2;
  if (feeCents != null || shippingCents != null) confidence += 0.1;
  if (reconciles) confidence += 0.2;
  if (reconciliationWarning) confidence -= 0.25;

  return {
    platform,
    grossCents,
    feeCents,
    shippingCents,
    netCents,
    currency: detectCurrency(text),
    itemHint,
    soldAtMs,
    found: [...found],
    confidence: Math.max(0, Math.min(1, Number(confidence.toFixed(2)))),
    reconciliationWarning,
  };
}

/** Bare "12.34" for use inside a sentence, where the symbol is already implied. */
function formatPlain(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Fill the gaps a parse left behind. Where the email stated a net but no fee,
 * the fee is whatever's missing — that's arithmetic, not a guess, so it's
 * marked as derived rather than estimated.
 */
export function completePayoutParse(parse: PayoutParse): PayoutParse & { derived: PayoutField[] } {
  const derived: PayoutField[] = [];
  let { grossCents, feeCents, netCents } = parse;
  const shipping = parse.shippingCents ?? 0;

  if (grossCents != null && netCents != null && feeCents == null) {
    const implied = grossCents - netCents - shipping;
    if (implied >= 0) {
      feeCents = implied;
      derived.push("fee");
    }
  } else if (grossCents != null && feeCents != null && netCents == null) {
    netCents = grossCents - feeCents - shipping;
    derived.push("net");
  } else if (netCents != null && feeCents != null && grossCents == null) {
    grossCents = netCents + feeCents + shipping;
    derived.push("gross");
  }

  return { ...parse, grossCents, feeCents, netCents, derived };
}

/** Marketplace ids the parser can name, for the picker's "detected" state. */
export const PARSEABLE_PLATFORMS: readonly MarketplaceId[] = MARKETPLACES.map((m) => m.id);
