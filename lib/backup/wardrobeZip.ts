import path from "node:path";
import type { Archiver } from "archiver";
import { prisma } from "@/lib/db";
import { cutoutPathFor, thumbnailPathFor } from "@/lib/image-paths";
import { decode, parseStringArray } from "@/lib/json";
import { getObject, objectExists } from "@/lib/storage";

type GhostViewRow = { label?: string; imagePath?: string };

export type WardrobeBackupManifest = {
  version: 1;
  exportedAt: string;
  note: string;
  items: Array<{
    id: string;
    name: string;
    brand: string | null;
    category: string;
    subcategory: string | null;
    createdAt: string;
    files: Array<{
      role: string;
      dbPath: string;
      zipPath: string;
      label?: string;
      index?: number;
      forGhostPath?: string;
    }>;
  }>;
  skippedMissing: Array<{ dbPath: string; reason: string }>;
};

function safeLabel(s: string, max = 28): string {
  return (
    s
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, max) || "file"
  );
}

async function keyOk(rel: string): Promise<boolean> {
  return objectExists(rel);
}

/**
 * Appends manifest.json (first) then all wardrobe image files for the user.
 * Caller must pipe `archive` to the response stream, then call `archive.finalize()`.
 */
export async function appendWardrobeBackupToArchiver(
  archive: Archiver,
  userId: string,
): Promise<void> {
  const items = await prisma.wardrobeItem.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      brand: true,
      category: true,
      subcategory: true,
      createdAt: true,
      originalImagePath: true,
      ghostImagePath: true,
      ghostViews: true,
      extraImagePaths: true,
    },
  });

  const skippedMissing: WardrobeBackupManifest["skippedMissing"] = [];
  const packedDbPaths = new Set<string>();
  const manifestItems: WardrobeBackupManifest["items"] = [];
  const fileJobs: Array<{ key: string; zipPath: string }> = [];

  function skip(dbPath: string, reason: string) {
    skippedMissing.push({ dbPath, reason });
  }

  for (const item of items) {
    const prefix = path.posix.join("items", item.id);
    const files: WardrobeBackupManifest["items"][number]["files"] = [];

    async function add(rel: string, zipPath: string, meta: (typeof files)[number]): Promise<void> {
      if (packedDbPaths.has(rel)) return;
      if (!(await keyOk(rel))) {
        skip(rel, "missing_or_invalid");
        return;
      }
      packedDbPaths.add(rel);
      fileJobs.push({ key: rel, zipPath });
      files.push(meta);
    }

    const orig = item.originalImagePath;
    const origExt = path.extname(orig) || ".jpg";
    await add(orig, path.posix.join(prefix, `original${origExt}`), {
      role: "original",
      dbPath: orig,
      zipPath: path.posix.join(prefix, `original${origExt}`),
    });

    const thumbRel = thumbnailPathFor(orig);
    const thumbExt = path.extname(thumbRel) || ".jpg";
    await add(thumbRel, path.posix.join(prefix, `thumbnail${thumbExt}`), {
      role: "thumbnail",
      dbPath: thumbRel,
      zipPath: path.posix.join(prefix, `thumbnail${thumbExt}`),
    });

    const extras = parseStringArray(item.extraImagePaths);
    for (let i = 0; i < extras.length; i++) {
      const rel = extras[i]!;
      const ext = path.extname(rel) || ".jpg";
      const zp = path.posix.join(prefix, `extra-${i}${ext}`);
      await add(rel, zp, { role: "extra", dbPath: rel, zipPath: zp, index: i });
    }

    const ghostViews = decode<GhostViewRow[]>(item.ghostViews, []);
    for (let i = 0; i < ghostViews.length; i++) {
      const v = ghostViews[i]!;
      if (!v.imagePath) continue;
      const slug = safeLabel(v.label ?? `view-${i}`);
      const ext = path.extname(v.imagePath) || ".jpg";
      const zp = path.posix.join(prefix, `ghost-view-${i}-${slug}${ext}`);
      await add(v.imagePath, zp, {
        role: "ghost_view",
        dbPath: v.imagePath,
        zipPath: zp,
        label: v.label,
      });
    }

    if (item.ghostImagePath && !packedDbPaths.has(item.ghostImagePath)) {
      const ext = path.extname(item.ghostImagePath) || ".jpg";
      const zp = path.posix.join(prefix, `ghost-primary${ext}`);
      await add(item.ghostImagePath, zp, {
        role: "ghost_primary",
        dbPath: item.ghostImagePath,
        zipPath: zp,
      });
    }

    const ghostForCutout = new Set<string>();
    for (const v of ghostViews) {
      if (v.imagePath) ghostForCutout.add(v.imagePath);
    }
    if (item.ghostImagePath) ghostForCutout.add(item.ghostImagePath);

    let cutIdx = 0;
    for (const gh of ghostForCutout) {
      const cutRel = cutoutPathFor(gh);
      if (packedDbPaths.has(cutRel)) continue;
      const slug = safeLabel(path.basename(gh, path.extname(gh)), 20);
      const zp = path.posix.join(prefix, `cutout-${cutIdx}-${slug}.png`);
      await add(cutRel, zp, {
        role: "cutout",
        dbPath: cutRel,
        zipPath: zp,
        forGhostPath: gh,
      });
      cutIdx++;
    }

    manifestItems.push({
      id: item.id,
      name: item.name,
      brand: item.brand,
      category: item.category,
      subcategory: item.subcategory,
      createdAt: item.createdAt.toISOString(),
      files,
    });
  }

  const manifest: WardrobeBackupManifest = {
    version: 1,
    exportedAt: new Date().toISOString(),
    note:
      "Images from your Wardrobe closet (originals, thumbnails, extras, ghost views, cutouts when present). Try-on generations and person photos are not included.",
    items: manifestItems,
    skippedMissing,
  };

  archive.append(Buffer.from(JSON.stringify(manifest, null, 2), "utf8"), { name: "manifest.json" });

  for (const job of fileJobs) {
    const data = await getObject(job.key);
    if (data) archive.append(data, { name: job.zipPath });
  }
}
