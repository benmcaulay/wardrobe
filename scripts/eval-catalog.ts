/**
 * Score generated catalog images objectively.
 * Run with: pnpm eval:catalog [--dir tmp/ghost-bakeoff] [--db] [--images a.jpg b.jpg]
 *                             (JSON=1 for machine-readable output)
 *
 * ── The question ────────────────────────────────────────────────────────────
 *
 * "Still too wrinkly" and "too bright" have been the review signal for ghost
 * mannequin quality. That works once; it does not survive four prompt
 * iterations, a model swap and a LoRA, because nothing records whether pass N+1
 * actually beat pass N or just moved the failure somewhere else.
 *
 * This turns the review into numbers. Point it at a bakeoff output directory and
 * it ranks the variants; point it at the database and it grades the catalog you
 * already shipped.
 *
 * lib/eval/catalog-image.ts holds the metrics, pure and unit-tested. This file
 * is only image decoding and reporting.
 *
 * ── Reading the output ──────────────────────────────────────────────────────
 *
 * `penalty` is a weighted total where 1.0 on a term means "exactly at the
 * quality gate", so a term at 3.0 is three times over the line. Lower is
 * better. Flags are the hard gate failures.
 *
 * Caveat carried from the metrics module: wrinkle energy counts any
 * high-frequency luma detail inside the garment, so a bold print raises it the
 * same way a crease does. Compare renders *of the same garment*; across
 * different garments only the exposure and background terms are portable.
 */

import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { PrismaClient } from "@prisma/client";
import {
  flagsFor,
  penaltyScore,
  scoreCatalogImage,
  type CatalogImageReport,
  type Flag,
  type RgbImage,
} from "@/lib/eval/catalog-image";

const AS_JSON = process.env.JSON === "1";
/**
 * Metrics are resolution-sensitive — a 4K render has finer detail per pixel
 * than a 1K one, so wrinkle energy is only comparable at a fixed working size.
 */
const WORK_EDGE = 512;

type Scored = {
  label: string;
  file: string;
  report: CatalogImageReport;
  flags: Flag[];
  penalty: number;
  terms: Record<string, number>;
};

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function argValues(flag: string): string[] {
  const i = process.argv.indexOf(flag);
  if (i < 0) return [];
  const out: string[] = [];
  for (let j = i + 1; j < process.argv.length; j++) {
    const v = process.argv[j]!;
    if (v.startsWith("--")) break;
    out.push(v);
  }
  return out;
}

/** Decode to flat RGB at a fixed working size. Alpha is flattened onto white
 *  so transparent cutout PNGs are graded the same way as catalog JPEGs. */
async function loadRgb(buf: Buffer): Promise<RgbImage> {
  const { data, info } = await sharp(buf)
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({ width: WORK_EDGE, height: WORK_EDGE, fit: "inside" })
    .raw()
    .toColourspace("srgb")
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 3) {
    throw new Error(`Expected 3 channels after flatten, got ${info.channels}`);
  }
  return { data: new Uint8Array(data), width: info.width, height: info.height };
}

async function scoreFile(label: string, file: string): Promise<Scored | null> {
  try {
    const buf = await fs.readFile(file);
    const img = await loadRgb(buf);
    const report = scoreCatalogImage(img);
    const { total, terms } = penaltyScore(report);
    return { label, file, report, flags: flagsFor(report), penalty: total, terms };
  } catch (err) {
    console.error(`  ! ${path.basename(file)}: ${(err as Error).message}`);
    return null;
  }
}

/** Bakeoff manifests carry variant ids, which is what we want to rank by. */
type BakeoffManifest = {
  cells?: Array<{ variantId?: string; imagePath?: string; fixtureId?: string }>;
};

async function collectFromDir(dir: string): Promise<Array<{ label: string; file: string }>> {
  const manifestPath = path.join(dir, "manifest.json");
  const out: Array<{ label: string; file: string }> = [];
  try {
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as BakeoffManifest;
    for (const cell of manifest.cells ?? []) {
      if (!cell.imagePath) continue;
      out.push({
        label: cell.variantId ?? "unknown",
        file: path.join(dir, cell.imagePath),
      });
    }
    if (out.length > 0) return out;
  } catch {
    // No manifest — fall back to walking for images.
  }

  async function walk(d: string) {
    for (const entry of await fs.readdir(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (/\.(jpe?g|png|webp)$/i.test(entry.name)) {
        out.push({ label: path.relative(dir, path.dirname(full)) || ".", file: full });
      }
    }
  }
  await walk(dir);
  return out;
}

async function collectFromDb(limit: number): Promise<Array<{ label: string; file: string }>> {
  const prisma = new PrismaClient();
  try {
    const items = await prisma.wardrobeItem.findMany({
      where: { ghostImagePath: { not: null } },
      select: { id: true, name: true, ghostImagePath: true },
      take: limit,
      orderBy: { createdAt: "desc" },
    });
    const root = process.env.UPLOAD_DIR ?? "uploads";
    return items
      .filter((i): i is typeof i & { ghostImagePath: string } => Boolean(i.ghostImagePath))
      .map((i) => ({
        label: "catalog",
        file: path.resolve(root, i.ghostImagePath),
      }));
  } finally {
    await prisma.$disconnect();
  }
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function fmt(n: number, digits = 4): string {
  return n.toFixed(digits).padStart(digits + 3);
}

function reportGroup(label: string, rows: Scored[]) {
  const flagCounts = new Map<Flag, number>();
  for (const r of rows) for (const f of r.flags) flagCounts.set(f, (flagCounts.get(f) ?? 0) + 1);

  console.log(`\n${label}  (n=${rows.length})`);
  console.log(`  penalty        ${fmt(mean(rows.map((r) => r.penalty)), 3)}   (lower is better)`);
  console.log(`  wrinkle mean   ${fmt(mean(rows.map((r) => r.report.wrinkle.mean)))}`);
  console.log(`  wrinkle p90    ${fmt(mean(rows.map((r) => r.report.wrinkle.p90)))}`);
  console.log(`  garment luma   ${fmt(mean(rows.map((r) => r.report.exposure.meanLuma)), 1)}`);
  console.log(`  clipped px     ${fmt(mean(rows.map((r) => r.report.exposure.clippedRatio)))}`);
  console.log(`  saturation     ${fmt(mean(rows.map((r) => r.report.exposure.meanSaturation)), 1)}`);
  console.log(`  bg off-white   ${fmt(mean(rows.map((r) => r.report.background.offWhiteRatio)))}`);
  console.log(`  symmetry       ${fmt(mean(rows.map((r) => r.report.framing.symmetry)))}`);
  console.log(`  coverage       ${fmt(mean(rows.map((r) => r.report.coverage)))}`);
  if (flagCounts.size > 0) {
    const parts = [...flagCounts.entries()].map(([f, c]) => `${f}×${c}`);
    console.log(`  flags          ${parts.join("  ")}`);
  } else {
    console.log(`  flags          none`);
  }
}

async function main() {
  const dir = argValue("--dir");
  const images = argValues("--images");
  const useDb = process.argv.includes("--db");
  const limit = Number(argValue("--limit") ?? 40);

  let targets: Array<{ label: string; file: string }> = [];
  if (dir) targets = targets.concat(await collectFromDir(path.resolve(dir)));
  if (images.length > 0) {
    targets = targets.concat(images.map((f) => ({ label: "image", file: path.resolve(f) })));
  }
  if (useDb) targets = targets.concat(await collectFromDb(limit));

  if (targets.length === 0) {
    console.error(
      "Nothing to score. Pass --dir <bakeoff output>, --images <files...>, or --db.\n" +
        "  pnpm eval:catalog --dir tmp/ghost-bakeoff\n" +
        "  pnpm eval:catalog --db --limit 20\n" +
        "  pnpm eval:catalog --images a.jpg b.jpg",
    );
    process.exitCode = 1;
    return;
  }

  const scored: Scored[] = [];
  for (const t of targets) {
    const s = await scoreFile(t.label, t.file);
    if (s) scored.push(s);
  }

  if (scored.length === 0) {
    console.error("Every image failed to decode — nothing to report.");
    process.exitCode = 1;
    return;
  }

  if (AS_JSON) {
    console.log(
      JSON.stringify(
        {
          workEdge: WORK_EDGE,
          count: scored.length,
          images: scored.map((s) => ({
            label: s.label,
            file: s.file,
            penalty: s.penalty,
            flags: s.flags,
            terms: s.terms,
            report: s.report,
          })),
        },
        null,
        2,
      ),
    );
    return;
  }

  const groups = new Map<string, Scored[]>();
  for (const s of scored) {
    const list = groups.get(s.label) ?? [];
    list.push(s);
    groups.set(s.label, list);
  }

  console.log(`Scored ${scored.length} image(s) at ${WORK_EDGE}px working size.`);

  const ranked = [...groups.entries()].sort(
    (a, b) => mean(a[1].map((r) => r.penalty)) - mean(b[1].map((r) => r.penalty)),
  );
  for (const [label, rows] of ranked) reportGroup(label, rows);

  if (ranked.length > 1) {
    console.log(`\nRanking by mean penalty (best first):`);
    ranked.forEach(([label, rows], i) => {
      console.log(`  ${i + 1}. ${label}  ${mean(rows.map((r) => r.penalty)).toFixed(3)}`);
    });
  }

  const worst = [...scored].sort((a, b) => b.penalty - a.penalty).slice(0, 5);
  console.log(`\nWorst individual images:`);
  for (const w of worst) {
    const flags = w.flags.length > 0 ? w.flags.join(",") : "—";
    console.log(`  ${w.penalty.toFixed(2).padStart(7)}  ${flags.padEnd(28)} ${w.file}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
