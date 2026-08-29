/**
 * Export photos from the macOS Photos library and enqueue wardrobe camera-roll scans.
 *
 * Requires osxphotos (https://github.com/RhetTbull/osxphotos):
 *   pip install osxphotos
 *
 * Grant Terminal (or iTerm) Photos access in System Settings → Privacy → Photos.
 *
 * Usage:
 *   WARDROBE_USER_EMAIL=you@example.com pnpm mac-photos:scan
 *   pnpm mac-photos:scan -- --email you@example.com --limit 200 --from-date 2023-01-01
 *   pnpm mac-photos:scan -- --dry-run
 *
 * Run `pnpm worker` (or your production worker) so scan jobs process in the background.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { MAX_SCAN_PHOTOS } from "../lib/camera-roll-scan-limits";
import { kickJobDrain } from "../lib/jobs/kick-drain";
import { enqueueJob } from "../lib/jobs/queue";
import { parseScanSceneType, type ScanSceneType } from "../lib/scan-scene";
import { saveImageBuffer } from "../lib/uploads";

const prisma = new PrismaClient();

type OsxPhoto = {
  uuid: string;
  original_filename?: string;
  filename?: string;
};

type CliOptions = {
  email?: string;
  limit?: number;
  fromDate?: string;
  toDate?: string;
  album?: string;
  scene: ScanSceneType;
  dryRun: boolean;
};

function parseArgs(): CliOptions {
  const argv = process.argv.slice(2);
  // A Photos-library export is mostly life photos, so "worn" is the honest
  // default here — the flat-lay prompt would discard exactly those.
  const opts: CliOptions = { dryRun: false, scene: "worn" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--email") opts.email = argv[++i];
    else if (arg === "--limit") opts.limit = Number(argv[++i]);
    else if (arg === "--from-date") opts.fromDate = argv[++i];
    else if (arg === "--to-date") opts.toDate = argv[++i];
    else if (arg === "--album") opts.album = argv[++i];
    else if (arg === "--scene") opts.scene = parseScanSceneType(argv[++i]);
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: pnpm mac-photos:scan -- [options]

Options:
  --email <addr>       Wardrobe account email (or set WARDROBE_USER_EMAIL)
  --limit <n>          Max photos to export (default: all matching)
  --from-date <YYYY-MM-DD>
  --to-date <YYYY-MM-DD>
  --album <name>       Only photos in this album
  --scene <worn|flatlay>  What the photos are (default: worn)
  --dry-run            List matching photos without uploading
  --help               Show this help
`);
      process.exit(0);
    }
  }
  return opts;
}

function requireOsxphotos(): void {
  const check = spawnSync("osxphotos", ["--version"], { encoding: "utf8" });
  if (check.status !== 0) {
    console.error(
      "osxphotos is not installed or not on PATH.\nInstall: pip install osxphotos",
    );
    process.exit(1);
  }
  console.log(`[mac-photos] ${check.stdout.trim() || "osxphotos ready"}`);
}

function queryPhotos(opts: CliOptions): OsxPhoto[] {
  const args = ["query", "--json"];
  if (opts.fromDate) args.push("--from-date", opts.fromDate);
  if (opts.toDate) args.push("--to-date", opts.toDate);
  if (opts.album) args.push("--album", opts.album);
  if (opts.limit && opts.limit > 0) args.push("--limit", String(opts.limit));

  const out = execFileSync("osxphotos", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (!out.trim()) return [];
  const parsed = JSON.parse(out) as OsxPhoto[] | OsxPhoto;
  return Array.isArray(parsed) ? parsed : [parsed];
}

function exportBatch(uuids: string[], exportDir: string): string[] {
  if (uuids.length === 0) return [];
  fs.mkdirSync(exportDir, { recursive: true });
  const args = [
    "export",
    exportDir,
    "--update",
    "--convert-to",
    "jpeg",
    "--filename",
    "{uuid}.{ext}",
    ...uuids.flatMap((uuid) => ["--uuid", uuid]),
  ];
  execFileSync("osxphotos", args, { stdio: "inherit" });

  const files: string[] = [];
  for (const uuid of uuids) {
    const matches = fs
      .readdirSync(exportDir)
      .filter((name) => name.startsWith(`${uuid}.`))
      .map((name) => path.join(exportDir, name));
    files.push(...matches);
  }
  return files.sort();
}

async function uploadExportedFiles(userId: string, filePaths: string[]): Promise<string[]> {
  const storageKeys: string[] = [];
  for (const filePath of filePaths) {
    const buffer = fs.readFileSync(filePath);
    const saved = await saveImageBuffer(buffer, userId);
    storageKeys.push(saved.originalImagePath);
    console.log(`  uploaded ${path.basename(filePath)} → ${saved.originalImagePath}`);
  }
  return storageKeys;
}

async function main() {
  const opts = parseArgs();
  const email = opts.email ?? process.env.WARDROBE_USER_EMAIL;
  if (!email) {
    console.error("Set WARDROBE_USER_EMAIL or pass --email you@example.com");
    process.exit(1);
  }

  requireOsxphotos();

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No wardrobe user found for ${email}`);
    process.exit(1);
  }

  console.log(`[mac-photos] Querying Photos library…`);
  const photos = queryPhotos(opts);
  console.log(`[mac-photos] ${photos.length} photo(s) matched`);

  if (photos.length === 0) {
    console.log("Nothing to scan.");
    return;
  }

  if (opts.dryRun) {
    for (const photo of photos.slice(0, 20)) {
      console.log(`  ${photo.uuid}  ${photo.original_filename ?? photo.filename ?? ""}`);
    }
    if (photos.length > 20) console.log(`  … and ${photos.length - 20} more`);
    return;
  }

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wardrobe-photos-"));
  const jobIds: string[] = [];

  try {
    for (let offset = 0; offset < photos.length; offset += MAX_SCAN_PHOTOS) {
      const chunk = photos.slice(offset, offset + MAX_SCAN_PHOTOS);
      const batchDir = path.join(tmpRoot, `batch-${offset / MAX_SCAN_PHOTOS + 1}`);
      const uuids = chunk.map((p) => p.uuid);

      console.log(
        `[mac-photos] Exporting batch ${Math.floor(offset / MAX_SCAN_PHOTOS) + 1} (${chunk.length} photos)…`,
      );
      const exported = exportBatch(uuids, batchDir);
      if (exported.length === 0) {
        console.warn("[mac-photos] Export returned no files for this batch — skipping");
        continue;
      }

      console.log(`[mac-photos] Uploading ${exported.length} file(s)…`);
      const paths = await uploadExportedFiles(user.id, exported);
      if (paths.length === 0) continue;

      const jobId = await enqueueJob(user.id, "camera_roll_scan", {
        photoPaths: paths,
        sceneType: opts.scene,
      });
      jobIds.push(jobId);
      kickJobDrain(paths.length);
      console.log(`[mac-photos] Enqueued scan job ${jobId} (${paths.length} photos)`);
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  if (jobIds.length === 0) {
    console.error("[mac-photos] No scan jobs were created.");
    process.exit(1);
  }

  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  console.log("\n[mac-photos] Done. Open the scan page to review when jobs finish:");
  for (const jobId of jobIds) {
    console.log(`  ${baseUrl}/closet/scan  (job ${jobId})`);
  }
  console.log("\nMake sure `pnpm worker` is running to process jobs.");
}

main()
  .catch((err) => {
    console.error("[mac-photos] fatal:", err);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
