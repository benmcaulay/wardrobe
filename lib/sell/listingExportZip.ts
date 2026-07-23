import path from "node:path";
import type { Archiver } from "archiver";
import { prisma } from "@/lib/db";
import { decode, parseColors, parseStringArray } from "@/lib/json";
import { sanitizeMarketplaceIds } from "@/lib/marketplaces";
import { buildListingDraft, isItemCondition, type ItemCondition } from "@/lib/sale-listing";
import { getObject, objectExists } from "@/lib/storage";
import {
  LISTING_EXPORT_README,
  buildListingExportFolderMeta,
  listingExportClipboardText,
  listingExportSlug,
  type ListingExportFolderMeta,
  type ListingExportManifest,
  type ListingExportManifestItem,
  type ListingExportPhoto,
  type ListingExportPhotoRole,
} from "./listing-export";

type GhostViewRow = { label?: string; imagePath?: string };

const MAX_IDS = 50;

function extOf(rel: string): string {
  const e = path.extname(rel).toLowerCase();
  return e === ".jpeg" || e === ".jpg" || e === ".png" || e === ".webp" ? e : ".jpg";
}

function safePhotoLabel(label: string | undefined, fallback: string): string {
  const raw = (label ?? fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return raw || fallback;
}

type QueuedPhoto = {
  key: string;
  role: ListingExportPhotoRole;
  label: string;
  source: ListingExportPhoto["source"];
  /** Preferred catalog thumbnail (ghost primary, else first available). */
  isThumbnail: boolean;
};

/**
 * Packs selected for-sale listings into a zip: paste-ready listing.txt,
 * in-folder meta.json (item + listing + thumbnail), and catalog photos.
 * Caller pipes `archive` and calls `finalize()`.
 */
export async function appendListingExportToArchiver(
  archive: Archiver,
  userId: string,
  itemIds: string[],
): Promise<{ count: number }> {
  const uniqueIds = [...new Set(itemIds.map((id) => id.trim()).filter(Boolean))].slice(0, MAX_IDS);
  if (uniqueIds.length === 0) {
    throw new Error("No listings selected");
  }

  const rows = await prisma.saleListing.findMany({
    where: {
      userId,
      itemId: { in: uniqueIds },
      status: { in: ["for_sale", "listed", "sold"] },
    },
    select: {
      itemId: true,
      status: true,
      askingCents: true,
      soldPriceCents: true,
      currency: true,
      condition: true,
      title: true,
      description: true,
      marketplaces: true,
      item: {
        select: {
          name: true,
          brand: true,
          category: true,
          subcategory: true,
          colors: true,
          material: true,
          pattern: true,
          styleTags: true,
          season: true,
          notes: true,
          priceCents: true,
          currency: true,
          retailer: true,
          productUrl: true,
          timesWorn: true,
          isWishlist: true,
          originalImagePath: true,
          ghostImagePath: true,
          ghostViews: true,
          extraImagePaths: true,
        },
      },
    },
  });

  if (rows.length === 0) {
    throw new Error("No matching listings found");
  }

  // Preserve caller selection order when possible.
  const byId = new Map(rows.map((r) => [r.itemId, r]));
  const ordered = uniqueIds.map((id) => byId.get(id)).filter(Boolean) as typeof rows;

  const skippedMissing: ListingExportManifest["skippedMissing"] = [];
  const manifestListings: ListingExportManifestItem[] = [];
  const fileJobs: Array<{ key: string; zipPath: string }> = [];
  const usedFolders = new Set<string>();
  const exportedAt = new Date().toISOString();

  for (const row of ordered) {
    const condition: ItemCondition | null =
      row.condition && isItemCondition(row.condition) ? row.condition : null;
    const colors = parseColors(row.item.colors);
    const styleTags = parseStringArray(row.item.styleTags);
    const season = parseStringArray(row.item.season);
    const marketplaces = sanitizeMarketplaceIds(parseStringArray(row.marketplaces));

    const itemInput = {
      name: row.item.name,
      brand: row.item.brand,
      category: row.item.category,
      subcategory: row.item.subcategory,
      colors,
      material: row.item.material,
      pattern: row.item.pattern,
      styleTags,
    };
    const draft = buildListingDraft(itemInput, { condition });
    const title = row.title ?? draft.title;
    const description = row.description ?? draft.description;
    const currency = row.currency || "USD";

    let folder = listingExportSlug({
      title,
      brand: row.item.brand,
      name: row.item.name,
      itemId: row.itemId,
    });
    if (usedFolders.has(folder)) {
      folder = `${folder}-${row.itemId.slice(0, 4).toLowerCase()}`;
    }
    usedFolders.add(folder);

    const clipboard = listingExportClipboardText({
      title,
      description,
      askingCents: row.askingCents,
      currency,
      condition,
      item: itemInput,
    });

    // Photo order: thumbnail/primary first, then other ghost views, extras, original.
    const photoQueue: QueuedPhoto[] = [];
    const seen = new Set<string>();

    function enqueue(photo: Omit<QueuedPhoto, "isThumbnail"> & { isThumbnail?: boolean }) {
      if (!photo.key || seen.has(photo.key)) return;
      seen.add(photo.key);
      photoQueue.push({
        ...photo,
        isThumbnail: !!photo.isThumbnail,
      });
    }

    const primaryKey = row.item.ghostImagePath ?? row.item.originalImagePath;
    const primarySource: ListingExportPhoto["source"] = row.item.ghostImagePath
      ? "ghost"
      : "original";
    enqueue({
      key: primaryKey,
      role: "primary",
      label: "primary",
      source: primarySource,
      isThumbnail: true,
    });

    const ghostViews = decode<GhostViewRow[]>(row.item.ghostViews, []);
    for (let i = 0; i < ghostViews.length; i++) {
      const v = ghostViews[i]!;
      if (!v.imagePath) continue;
      enqueue({
        key: v.imagePath,
        role: "ghost_view",
        label: safePhotoLabel(v.label, `view-${i + 1}`),
        source: "ghost_view",
      });
    }

    for (const extra of parseStringArray(row.item.extraImagePaths)) {
      enqueue({ key: extra, role: "extra", label: "extra", source: "extra" });
    }

    if (row.item.originalImagePath !== primaryKey) {
      enqueue({
        key: row.item.originalImagePath,
        role: "original",
        label: "original",
        source: "original",
      });
    }

    // If the preferred thumbnail file is missing, promote the first present photo.
    let thumbnailAssigned = false;
    const photos: ListingExportPhoto[] = [];
    const folderFiles: string[] = ["listing.txt", "meta.json", "thumbnail.txt"];

    let photoIndex = 0;
    for (const photo of photoQueue) {
      if (!(await objectExists(photo.key))) {
        skippedMissing.push({ dbPath: photo.key, reason: "missing_or_invalid" });
        continue;
      }
      photoIndex += 1;
      const pad = String(photoIndex).padStart(2, "0");
      const zipName = `${pad}-${photo.label}${extOf(photo.key)}`;
      const zipPath = path.posix.join(folder, zipName);
      fileJobs.push({ key: photo.key, zipPath });
      folderFiles.push(zipName);

      const isThumbnail = photo.isThumbnail && !thumbnailAssigned;
      if (isThumbnail) thumbnailAssigned = true;

      photos.push({
        file: zipName,
        role: photo.role,
        label: photo.label,
        isThumbnail,
        source: photo.source,
      });
    }

    if (!thumbnailAssigned && photos[0]) {
      photos[0] = { ...photos[0], isThumbnail: true };
      thumbnailAssigned = true;
    }

    const meta: ListingExportFolderMeta = buildListingExportFolderMeta({
      itemId: row.itemId,
      folder,
      exportedAt,
      item: {
        name: row.item.name,
        brand: row.item.brand,
        category: row.item.category,
        subcategory: row.item.subcategory,
        colors,
        material: row.item.material,
        pattern: row.item.pattern,
        styleTags,
        season,
        notes: row.item.notes,
        retailCents: row.item.priceCents,
        retailCurrency: row.item.currency || "USD",
        retailer: row.item.retailer,
        productUrl: row.item.productUrl,
        timesWorn: row.item.timesWorn,
        isWishlist: row.item.isWishlist,
      },
      listing: {
        status: row.status,
        title,
        description,
        askingCents: row.askingCents,
        soldPriceCents: row.soldPriceCents,
        currency,
        condition,
        marketplaces,
        clipboard,
      },
      photos,
    });

    archive.append(Buffer.from(clipboard, "utf8"), {
      name: path.posix.join(folder, "listing.txt"),
    });
    archive.append(Buffer.from(JSON.stringify(meta, null, 2), "utf8"), {
      name: path.posix.join(folder, "meta.json"),
    });
    archive.append(Buffer.from(`${meta.thumbnail}\n`, "utf8"), {
      name: path.posix.join(folder, "thumbnail.txt"),
    });

    manifestListings.push({
      itemId: row.itemId,
      folder,
      title,
      askingCents: row.askingCents,
      currency,
      condition,
      thumbnail: meta.thumbnail,
      imageCount: photos.length,
      files: folderFiles,
    });
  }

  const manifest: ListingExportManifest = {
    version: 2,
    exportedAt,
    note: "Per-folder meta.json encodes item + listing fields and which file is the thumbnail.",
    listings: manifestListings,
    skippedMissing,
  };

  archive.append(Buffer.from(LISTING_EXPORT_README, "utf8"), { name: "README.txt" });
  archive.append(Buffer.from(JSON.stringify(manifest, null, 2), "utf8"), { name: "manifest.json" });

  for (const job of fileJobs) {
    const data = await getObject(job.key);
    if (data) archive.append(data, { name: job.zipPath });
  }

  return { count: manifestListings.length };
}

export { MAX_IDS as LISTING_EXPORT_MAX_IDS };
