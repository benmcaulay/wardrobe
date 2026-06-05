/**
 * Full local backup: zips the SQLite database and the uploads/ folder (the
 * actual image files) into one timestamped archive under backups/.
 *
 * Run with: pnpm db:backup
 *
 * The database only stores image *paths*; the bytes live in uploads/, so a
 * usable transfer needs both. Restore by unzipping into the project root,
 * which puts prisma/dev.db and uploads/ back where the app expects them.
 */
import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import archiver from "archiver";

const ROOT = process.cwd();
const DB_PATH = path.join(ROOT, "prisma", "dev.db");
const UPLOADS_DIR = path.join(ROOT, "uploads");
const OUT_DIR = path.join(ROOT, "backups");

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outPath = path.join(OUT_DIR, `wardrobe-full-${stamp}.zip`);

  const output = createWriteStream(outPath);
  const archive = archiver("zip", { zlib: { level: 6 } });

  const done = new Promise<void>((resolve, reject) => {
    output.on("close", () => resolve());
    archive.on("error", reject);
    archive.on("warning", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") console.warn(`Skipped (missing): ${err.message}`);
      else reject(err);
    });
  });

  archive.pipe(output);

  if (!(await exists(DB_PATH))) {
    console.error(`No database found at ${path.relative(ROOT, DB_PATH)}. Nothing to back up.`);
    process.exit(1);
  }
  archive.file(DB_PATH, { name: "prisma/dev.db" });

  if (await exists(UPLOADS_DIR)) {
    archive.directory(UPLOADS_DIR, "uploads");
  } else {
    console.warn("No uploads/ directory found — backing up the database only.");
  }

  await archive.finalize();
  await done;

  const { size } = await fs.stat(outPath);
  console.log(`\nBackup written: ${path.relative(ROOT, outPath)} (${(size / 1024 / 1024).toFixed(1)} MB)`);
  console.log("To restore on another machine: unzip this file into the project root,");
  console.log("then run `pnpm prisma generate` and start the app.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
