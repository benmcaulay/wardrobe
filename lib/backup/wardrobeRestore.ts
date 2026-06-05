import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import AdmZip from "adm-zip";
import sharp from "sharp";
import { prisma } from "@/lib/db";
import { resolveUploadPath, UPLOADS_ROOT, THUMB_EDGE_PX } from "@/lib/uploads";
import { thumbnailPathFor, cutoutPathFor } from "@/lib/image-paths";
import { decode, encode } from "@/lib/json";
import type { WardrobeBackupItem, WardrobeBackupManifest } from "./wardrobeZip";

export type RestoreResult =
  | { ok: true; imported: number; skipped: number; warnings: string[] }
  | { ok: false; error: string };

type GhostView = { label?: string; imagePath?: string; mirror?: boolean; thumbZoom?: number };

/**
 * Recreate a user's wardrobe from a backup zip produced by
 * appendWardrobeBackupToArchiver. Images are written into the importing user's
 * uploads/ folder under fresh names and all stored paths are remapped, so the
 * archive is portable across machines and accounts. Items already present
 * (same name + createdAt) are skipped, making re-imports idempotent.
 */
export async function restoreWardrobeFromZip(buffer: Buffer, userId: string): Promise<RestoreResult> {
  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    return { ok: false, error: "That doesn't look like a valid .zip file." };
  }

  const manifestEntry = zip.getEntry("manifest.json");
  if (!manifestEntry) {
    return { ok: false, error: "No manifest.json found — is this a wardrobe backup?" };
  }
  let manifest: WardrobeBackupManifest;
  try {
    manifest = JSON.parse(manifestEntry.getData().toString("utf8")) as WardrobeBackupManifest;
  } catch {
    return { ok: false, error: "The backup's manifest.json is corrupt." };
  }
  if (!Array.isArray(manifest.items)) {
    return { ok: false, error: "The backup has no items to import." };
  }

  await fs.mkdir(path.join(UPLOADS_ROOT, userId), { recursive: true });

  const warnings: string[] = [];
  let imported = 0;
  let skipped = 0;

  const readBytes = (zipPath: string): Buffer | null => {
    const entry = zip.getEntry(zipPath);
    return entry ? entry.getData() : null;
  };
  const freshRel = (ext: string): string =>
    path.posix.join(userId, `${crypto.randomUUID()}${ext || ".jpg"}`);
  const writeRel = async (rel: string, bytes: Buffer): Promise<void> => {
    const abs = resolveUploadPath(rel);
    if (!abs) throw new Error("invalid upload path");
    await fs.writeFile(abs, bytes);
  };

  for (const item of manifest.items) {
    try {
      const restored = await restoreItem(item, userId, { readBytes, freshRel, writeRel });
      if (restored === "skipped") skipped++;
      else imported++;
    } catch (err) {
      warnings.push(`Couldn't import "${item.name}": ${(err as Error).message}`);
      skipped++;
    }
  }

  return { ok: true, imported, skipped, warnings };
}

async function restoreItem(
  item: WardrobeBackupItem,
  userId: string,
  io: {
    readBytes: (zipPath: string) => Buffer | null;
    freshRel: (ext: string) => string;
    writeRel: (rel: string, bytes: Buffer) => Promise<void>;
  },
): Promise<"imported" | "skipped"> {
  const { readBytes, freshRel, writeRel } = io;

  // Idempotency: same name + original timestamp already imported.
  const existing = await prisma.wardrobeItem.findFirst({
    where: { userId, name: item.name, createdAt: new Date(item.createdAt) },
    select: { id: true },
  });
  if (existing) return "skipped";

  const byRole = (role: string) => item.files.filter((f) => f.role === role);

  // --- Original (required) + its thumbnail.
  const original = byRole("original")[0];
  const origBytes = original ? readBytes(original.zipPath) : null;
  if (!original || !origBytes) {
    throw new Error("original image is missing from the archive");
  }
  const originalNew = freshRel(path.extname(original.zipPath));
  await writeRel(originalNew, origBytes);

  const thumbFile = byRole("thumbnail")[0];
  const thumbBytes = thumbFile ? readBytes(thumbFile.zipPath) : null;
  const thumbNew = thumbnailPathFor(originalNew);
  if (thumbBytes) {
    await writeRel(thumbNew, thumbBytes);
  } else {
    // Regenerate a thumbnail if the backup didn't carry one.
    try {
      const generated = await sharp(origBytes)
        .rotate()
        .resize({ width: THUMB_EDGE_PX, height: THUMB_EDGE_PX, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 78 })
        .toBuffer();
      await writeRel(thumbNew, generated);
    } catch {
      /* non-fatal: tile will fall back to the original */
    }
  }

  // --- Ghost images: remap old path -> new path, then their cutouts.
  const ghostMap = new Map<string, string>();
  for (const gf of [...byRole("ghost_primary"), ...byRole("ghost_view")]) {
    if (ghostMap.has(gf.dbPath)) continue;
    const bytes = readBytes(gf.zipPath);
    if (!bytes) continue;
    const ghostNew = freshRel(path.extname(gf.zipPath));
    await writeRel(ghostNew, bytes);
    ghostMap.set(gf.dbPath, ghostNew);
  }
  for (const cf of byRole("cutout")) {
    if (!cf.forGhostPath) continue;
    const ghostNew = ghostMap.get(cf.forGhostPath);
    const bytes = readBytes(cf.zipPath);
    if (!ghostNew || !bytes) continue;
    await writeRel(cutoutPathFor(ghostNew), bytes);
  }

  // --- Extras (preserve order).
  const extraNew: string[] = [];
  for (const ex of byRole("extra").sort((a, b) => (a.index ?? 0) - (b.index ?? 0))) {
    const bytes = readBytes(ex.zipPath);
    if (!bytes) continue;
    const rel = freshRel(path.extname(ex.zipPath));
    await writeRel(rel, bytes);
    extraNew.push(rel);
  }

  const data = item.data;

  // Remap ghost primary + ghost views to the freshly written paths.
  let ghostImageNew: string | null = data?.ghostImagePath
    ? (ghostMap.get(data.ghostImagePath) ?? null)
    : null;
  if (!ghostImageNew && byRole("ghost_primary")[0]) {
    ghostImageNew = ghostMap.get(byRole("ghost_primary")[0]!.dbPath) ?? null;
  }

  let ghostViewsNew: string | null = null;
  if (data?.ghostViews) {
    const views = decode<GhostView[]>(data.ghostViews, []);
    const remapped = views
      .map((v) => (v.imagePath ? { ...v, imagePath: ghostMap.get(v.imagePath) } : v))
      .filter((v): v is GhostView => !!v.imagePath);
    ghostViewsNew = remapped.length ? encode(remapped) : null;
  }

  await prisma.wardrobeItem.create({
    data: {
      userId,
      name: item.name,
      brand: item.brand,
      category: item.category,
      subcategory: item.subcategory,
      colors: data?.colors ?? "[]",
      priceCents: data?.priceCents ?? null,
      currency: data?.currency ?? "USD",
      retailer: data?.retailer ?? null,
      productUrl: data?.productUrl ?? null,
      material: data?.material ?? null,
      pattern: data?.pattern ?? null,
      styleTags: data?.styleTags ?? "[]",
      season: data?.season ?? "[]",
      originalImagePath: originalNew,
      originalThumbZoom: data?.originalThumbZoom ?? 1,
      originalMirror: data?.originalMirror ?? false,
      ghostImagePath: ghostImageNew,
      ghostViews: ghostViewsNew,
      extraImagePaths: extraNew.length ? encode(extraNew) : null,
      isWishlist: data?.isWishlist ?? false,
      timesWorn: data?.timesWorn ?? 0,
      lastWornAt: data?.lastWornAt ? new Date(data.lastWornAt) : null,
      notes: data?.notes ?? null,
      weightGrams: data?.weightGrams ?? null,
      volumeLiters: data?.volumeLiters ?? null,
      createdAt: new Date(item.createdAt),
    },
  });

  return "imported";
}
