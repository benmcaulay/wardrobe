import type { Color } from "./json";
import { isNoneCategoryStored } from "./categories";

/** Lifecycle of an item in the swipe-to-sell deck. */
export type SaleStatus = "for_sale" | "skipped" | "listed" | "sold";

export const SALE_STATUS_LABELS: Record<SaleStatus, string> = {
  for_sale: "For sale",
  skipped: "Keeping",
  listed: "Listed",
  sold: "Sold",
};

export function isSaleStatus(value: string): value is SaleStatus {
  return value === "for_sale" || value === "skipped" || value === "listed" || value === "sold";
}

/** Item condition, ordered best → worst. Values match common marketplace tiers. */
export type ItemCondition = "new_with_tags" | "like_new" | "good" | "fair";

export const CONDITION_OPTIONS: { value: ItemCondition; label: string; resaleFactor: number }[] = [
  { value: "new_with_tags", label: "New with tags", resaleFactor: 0.6 },
  { value: "like_new", label: "Like new", resaleFactor: 0.5 },
  { value: "good", label: "Good", resaleFactor: 0.35 },
  { value: "fair", label: "Fair", resaleFactor: 0.2 },
];

const CONDITION_BY_VALUE = new Map(CONDITION_OPTIONS.map((c) => [c.value, c]));

export function conditionLabel(value: string | null | undefined): string {
  if (!value) return "";
  return CONDITION_BY_VALUE.get(value as ItemCondition)?.label ?? "";
}

export function isItemCondition(value: string): value is ItemCondition {
  return CONDITION_BY_VALUE.has(value as ItemCondition);
}

export function formatCents(cents: number | null | undefined, currency = "USD"): string {
  if (cents == null) return "";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.length === 3 ? currency : "USD",
      maximumFractionDigits: 0,
    }).format(cents / 100);
  } catch {
    return `$${Math.round(cents / 100)}`;
  }
}

/**
 * Rough resale estimate from the item's retail price and condition. Returns
 * null when we have no retail price to anchor on. Rounded to a whole dollar
 * (charm-priced to .99 once it clears $10), with a $3 floor.
 */
export function suggestedAskingCents(
  retailCents: number | null | undefined,
  condition: ItemCondition | null | undefined,
): number | null {
  if (!retailCents || retailCents <= 0) return null;
  const factor = (condition && CONDITION_BY_VALUE.get(condition)?.resaleFactor) || 0.35;
  const raw = retailCents * factor;
  const dollars = Math.max(3, Math.round(raw / 100));
  return dollars >= 10 ? dollars * 100 - 1 : dollars * 100;
}

/** Minimal item shape needed to draft a listing (works on client and server). */
export type ListingItemInput = {
  name: string;
  brand?: string | null;
  category: string;
  subcategory?: string | null;
  colors?: Color[];
  material?: string | null;
  pattern?: string | null;
  styleTags?: string[];
};

export type ListingDraft = {
  title: string;
  description: string;
  hashtags: string[];
};

const TITLE_MAX = 80;

function titleCase(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function toHashtag(value: string): string | null {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return cleaned ? `#${cleaned}` : null;
}

/**
 * Build a copy-ready listing title, description, and hashtag set from an item.
 * Template-based (no AI) so it's instant and deterministic.
 */
export function buildListingDraft(
  item: ListingItemInput,
  opts: { condition?: ItemCondition | null; askingCents?: number | null; currency?: string } = {},
): ListingDraft {
  const brand = item.brand?.trim() ?? "";
  const name = item.name.trim();
  const category = isNoneCategoryStored(item.category) ? "" : item.category.trim();
  const subcategory = item.subcategory?.trim() ?? "";
  const descriptor = subcategory || category;
  const colors = (item.colors ?? []).map((c) => c.name).filter(Boolean);
  const material = item.material?.trim() ?? "";
  const pattern = item.pattern?.trim() ?? "";
  const condition = opts.condition ? conditionLabel(opts.condition) : "";

  // --- Title: "Brand Name – Descriptor", trimmed to the marketplace cap.
  let title = [brand, name].filter(Boolean).join(" ").trim() || name || "Item";
  if (descriptor && !title.toLowerCase().includes(descriptor.toLowerCase())) {
    title = `${title} – ${titleCase(descriptor)}`;
  }
  if (title.length > TITLE_MAX) title = `${title.slice(0, TITLE_MAX - 1).trimEnd()}…`;

  // --- Description: friendly lead-in + bulleted details + closing.
  const lead = brand
    ? `${brand} ${descriptor ? titleCase(descriptor).toLowerCase() : "piece"}${
        name && !name.toLowerCase().includes(brand.toLowerCase()) ? ` — ${name}.` : "."
      }`
    : `${name}.`;

  const details: string[] = [];
  if (condition) details.push(`Condition: ${condition}`);
  if (colors.length) details.push(`Color: ${colors.join(", ")}`);
  if (material) details.push(`Material: ${material}`);
  if (pattern) details.push(`Pattern: ${pattern}`);
  if (descriptor) details.push(`Type: ${titleCase(descriptor)}`);

  const hashtags = buildHashtags({ brand, category, subcategory, colors, material, styleTags: item.styleTags });

  const description = [
    lead,
    details.length ? "" : null,
    ...details.map((d) => `• ${d}`),
    "",
    "From a smoke-free closet. Bundle to save on shipping — message me with any questions!",
    hashtags.length ? "" : null,
    hashtags.length ? hashtags.join(" ") : null,
  ]
    .filter((l) => l !== null)
    .join("\n");

  return { title, description, hashtags };
}

function buildHashtags(input: {
  brand: string;
  category: string;
  subcategory: string;
  colors: string[];
  material: string;
  styleTags?: string[];
}): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (value: string) => {
    const tag = toHashtag(value);
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      out.push(tag);
    }
  };
  push(input.brand);
  for (const t of input.styleTags ?? []) push(t);
  push(input.subcategory);
  push(input.category);
  for (const c of input.colors) push(c);
  push(input.material);
  return out.slice(0, 12);
}
