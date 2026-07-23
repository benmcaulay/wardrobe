import {
  buildListingDraft,
  isItemCondition,
  listingClipboardText,
  type ItemCondition,
  type ListingItemInput,
} from "@/lib/sale-listing";
import type { Color } from "@/lib/json";

/** Folder / filename slug for a listing export. */
export function listingExportSlug(input: {
  title?: string | null;
  brand?: string | null;
  name?: string | null;
  itemId: string;
}): string {
  const raw = (input.title || [input.brand, input.name].filter(Boolean).join(" ") || "item")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const base = raw || "item";
  const shortId = input.itemId.slice(-6).toLowerCase().replace(/[^a-z0-9]/g, "");
  return shortId ? `${base}-${shortId}` : base;
}

export type ListingExportCopyInput = {
  title: string;
  description: string;
  askingCents: number | null;
  currency?: string;
  condition?: string | null;
  item: ListingItemInput;
};

/** Paste-ready listing text for `listing.txt` inside an export zip. */
export function listingExportClipboardText(input: ListingExportCopyInput): string {
  const condition: ItemCondition | null =
    input.condition && isItemCondition(input.condition) ? input.condition : null;
  const hashtags = buildListingDraft(input.item, { condition }).hashtags;
  return listingClipboardText({
    title: input.title,
    description: input.description,
    askingCents: input.askingCents,
    currency: input.currency ?? "USD",
    condition,
    hashtags,
  });
}

export type ListingExportPhotoRole =
  | "primary"
  | "ghost_view"
  | "extra"
  | "original";

export type ListingExportPhoto = {
  /** Filename relative to the listing folder. */
  file: string;
  role: ListingExportPhotoRole;
  label: string;
  /** True for the catalog thumbnail (ghost primary when available). */
  isThumbnail: boolean;
  /** Where this bytes came from in Wardrobe storage. */
  source: "ghost" | "ghost_view" | "extra" | "original";
};

export type ListingExportItemMeta = {
  name: string;
  brand: string | null;
  category: string;
  subcategory: string | null;
  colors: Color[];
  material: string | null;
  pattern: string | null;
  styleTags: string[];
  season: string[];
  notes: string | null;
  retailCents: number | null;
  retailCurrency: string;
  retailer: string | null;
  productUrl: string | null;
  timesWorn: number;
  isWishlist: boolean;
};

export type ListingExportListingMeta = {
  status: string;
  title: string;
  description: string;
  askingCents: number | null;
  soldPriceCents: number | null;
  currency: string;
  condition: ItemCondition | null;
  marketplaces: string[];
  /** Same body as listing.txt — paste-ready. */
  clipboard: string;
};

/** Per-folder structured metadata (`meta.json`). */
export type ListingExportFolderMeta = {
  version: 2;
  itemId: string;
  folder: string;
  exportedAt: string;
  /**
   * Filename of the thumbnail image inside this folder.
   * Empty string when no photos were available.
   */
  thumbnail: string;
  item: ListingExportItemMeta;
  listing: ListingExportListingMeta;
  photos: ListingExportPhoto[];
};

export type ListingExportManifestItem = {
  itemId: string;
  folder: string;
  title: string;
  askingCents: number | null;
  currency: string;
  condition: string | null;
  /** Thumbnail filename relative to `folder/`. */
  thumbnail: string;
  imageCount: number;
  files: string[];
};

export type ListingExportManifest = {
  version: 2;
  exportedAt: string;
  note: string;
  listings: ListingExportManifestItem[];
  skippedMissing: Array<{ dbPath: string; reason: string }>;
};

export function buildListingExportFolderMeta(input: {
  itemId: string;
  folder: string;
  exportedAt: string;
  item: ListingExportItemMeta;
  listing: ListingExportListingMeta;
  photos: ListingExportPhoto[];
}): ListingExportFolderMeta {
  const thumb =
    input.photos.find((p) => p.isThumbnail)?.file ?? input.photos[0]?.file ?? "";
  return {
    version: 2,
    itemId: input.itemId,
    folder: input.folder,
    exportedAt: input.exportedAt,
    thumbnail: thumb,
    item: input.item,
    listing: input.listing,
    photos: input.photos.map((p) => ({
      ...p,
      isThumbnail: p.file === thumb,
    })),
  };
}

export const LISTING_EXPORT_README = `Wardrobe listing export
=======================

Each folder is one for-sale listing, ready to paste into Depop, Poshmark,
Mercari, eBay, etc.

  listing.txt     — title, price, condition, description (paste this)
  meta.json       — full item + listing metadata, photo index, thumbnail
  thumbnail.txt   — filename of the catalog thumbnail (one line)
  01-*.jpg …      — photos (01 is usually the thumbnail / primary)

meta.json fields of note:
  thumbnail       — e.g. "01-primary.jpg"
  photos[]        — file, role, label, isThumbnail, source
  item            — name, brand, category, colors, material, tags, …
  listing         — title, description, askingCents, condition, marketplaces

Upload the numbered photos (start with the thumbnail), then paste listing.txt
into the marketplace form. Wardrobe cannot post for you — no marketplace
exposes a public create-listing API.
`;
