/**
 * Build a training dataset for the ghost-mannequin edit LoRA.
 * Run with: pnpm ghost:lora:build [--out tmp/ghost-lora] [--max-penalty 2] [--limit 60]
 *
 * ── What a pair is ──────────────────────────────────────────────────────────
 *
 * _start = the original listing photo (folded on a chair, bad light, whatever)
 * _end   = a catalog render we were happy with
 *
 * The LoRA learns that transformation directly, which is the point: several
 * rounds of "no wrinkles, no creases" in the prompt did not stop the creases,
 * because negation is the weakest lever these models expose. Examples are not
 * negotiable in the same way.
 *
 * ── Which renders become targets ────────────────────────────────────────────
 *
 * Training on mediocre renders teaches mediocre renders. So every candidate end
 * image is scored with lib/eval/catalog-image.ts and anything above
 * `--max-penalty` is rejected, with the reason printed. The dataset is
 * therefore "the cleanest renders this catalog has produced", selected by the
 * same metrics used to grade new ones.
 *
 * Nothing here spends money. It writes a zip plus a contact sheet so the pairs
 * can be eyeballed before ghost-lora-train.ts is run.
 */

import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import archiver from "archiver";
import sharp from "sharp";
import { PrismaClient } from "@prisma/client";
import { getObject } from "@/lib/storage";
import {
  flagsFor,
  penaltyScore,
  scoreCatalogImage,
  type RgbImage,
} from "@/lib/eval/catalog-image";
import {
  DEFAULT_EDIT_CAPTION,
  DEFAULT_STEPS,
  estimateTrainingCost,
  MIN_PAIR_EDGE,
  pairFileNames,
  validateDataset,
  type DatasetPair,
} from "@/lib/services/ghost-lora";

const prisma = new PrismaClient();

/** Matches the generator's 3:4 portrait canvas. */
const OUT_WIDTH = 1024;
const OUT_HEIGHT = 1366;
const SCORE_EDGE = 512;

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function toRgbForScoring(buf: Buffer): Promise<RgbImage> {
  const { data, info } = await sharp(buf)
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({ width: SCORE_EDGE, height: SCORE_EDGE, fit: "inside" })
    .raw()
    .toColourspace("srgb")
    .toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
}

/** Normalise to the training canvas: contained, padded white, at least 1024px. */
async function toTrainingPng(buf: Buffer): Promise<Buffer> {
  return sharp(buf)
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({
      width: OUT_WIDTH,
      height: OUT_HEIGHT,
      fit: "contain",
      background: "#ffffff",
      withoutEnlargement: false,
    })
    .png()
    .toBuffer();
}

type Candidate = {
  itemId: string;
  name: string;
  originalPath: string;
  ghostPath: string;
};

async function main() {
  const outDir = path.resolve(argValue("--out") ?? "tmp/ghost-lora");
  const maxPenalty = Number(argValue("--max-penalty") ?? 2);
  const limit = Number(argValue("--limit") ?? 60);
  const steps = Number(argValue("--steps") ?? DEFAULT_STEPS);

  const rows = await prisma.wardrobeItem.findMany({
    where: { ghostImagePath: { not: null } },
    select: { id: true, name: true, originalImagePath: true, ghostImagePath: true },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  const candidates: Candidate[] = rows
    .filter((r): r is typeof r & { ghostImagePath: string } => Boolean(r.ghostImagePath))
    .map((r) => ({
      itemId: r.id,
      name: r.name,
      originalPath: r.originalImagePath,
      ghostPath: r.ghostImagePath,
    }));

  if (candidates.length === 0) {
    console.error(
      "No items have a catalog view yet. Generate some good renders first — " +
        "this trains on your own approved output.",
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Found ${candidates.length} item(s) with a catalog view.`);
  console.log(`Rejecting any render with penalty > ${maxPenalty}.\n`);

  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(path.join(outDir, "dataset"), { recursive: true });

  const accepted: DatasetPair[] = [];
  const sheet: Array<{ start: string; end: string; label: string; penalty: number }> = [];
  let rejected = 0;

  for (const c of candidates) {
    const [origBuf, ghostBuf] = await Promise.all([
      getObject(c.originalPath),
      getObject(c.ghostPath),
    ]);
    if (!origBuf || !ghostBuf) {
      console.log(`  skip  ${c.name}: missing image file`);
      rejected++;
      continue;
    }

    // Grade the end image — it is about to become a training target.
    const report = scoreCatalogImage(await toRgbForScoring(ghostBuf));
    const { total } = penaltyScore(report);
    const flags = flagsFor(report);
    if (total > maxPenalty) {
      console.log(
        `  skip  ${c.name}: penalty ${total.toFixed(2)}` +
          (flags.length > 0 ? ` (${flags.join(",")})` : ""),
      );
      rejected++;
      continue;
    }

    const index = accepted.length;
    const names = pairFileNames(index);
    const [startPng, endPng] = await Promise.all([
      toTrainingPng(origBuf),
      toTrainingPng(ghostBuf),
    ]);
    const dir = path.join(outDir, "dataset");
    await Promise.all([
      fs.writeFile(path.join(dir, names.start), startPng),
      fs.writeFile(path.join(dir, names.end), endPng),
      fs.writeFile(path.join(dir, names.caption), DEFAULT_EDIT_CAPTION, "utf8"),
    ]);

    accepted.push({
      id: `${names.root}:${c.name}`,
      startBytes: startPng.length,
      endBytes: endPng.length,
      startWidth: OUT_WIDTH,
      startHeight: OUT_HEIGHT,
      endWidth: OUT_WIDTH,
      endHeight: OUT_HEIGHT,
    });
    sheet.push({
      start: `dataset/${names.start}`,
      end: `dataset/${names.end}`,
      label: c.name,
      penalty: total,
    });
    console.log(`  keep  ${c.name}: penalty ${total.toFixed(2)} → ${names.root}`);
  }

  console.log(`\nAccepted ${accepted.length}, rejected ${rejected}.`);

  const validation = validateDataset(accepted);
  for (const w of validation.warnings) console.log(`  warn  ${w}`);
  for (const e of validation.errors) console.log(`  ERROR ${e}`);

  // Contact sheet — cheaper to spot a bad pair here than after a paid run.
  const html = `<!doctype html>
<meta charset="utf-8">
<title>Ghost LoRA dataset (${accepted.length} pairs)</title>
<style>
  body{font:13px/1.5 -apple-system,system-ui,sans-serif;background:#faf8f5;color:#1a1613;padding:24px}
  h1{font:600 20px/1.3 Georgia,serif}
  .row{display:flex;gap:12px;align-items:center;margin:0 0 14px;padding:10px;background:#fff;border:1px solid #eee;border-radius:12px}
  img{width:150px;height:200px;object-fit:contain;background:#fff;border:1px solid #eee;border-radius:8px}
  .meta{font-size:12px;color:#666}
  .arrow{font-size:20px;color:#999}
</style>
<h1>Ghost LoRA dataset — ${accepted.length} pairs</h1>
<p class="meta">Left = _start (source photo). Right = _end (target render). Reject anything whose
right-hand image you would not want the model to imitate.</p>
${sheet
  .map(
    (s) => `<div class="row">
  <img src="${s.start}" alt="start"><span class="arrow">&rarr;</span><img src="${s.end}" alt="end">
  <div><strong>${s.label}</strong><div class="meta">penalty ${s.penalty.toFixed(2)}</div></div>
</div>`,
  )
  .join("\n")}
`;
  await fs.writeFile(path.join(outDir, "index.html"), html, "utf8");

  // Zip only the dataset dir — the trainer expects pairs at the archive root.
  const zipPath = path.join(outDir, "dataset.zip");
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", () => resolve());
    archive.on("error", reject);
    archive.pipe(output);
    archive.directory(path.join(outDir, "dataset"), false);
    void archive.finalize();
  });

  const zipStat = await fs.stat(zipPath);
  console.log(`\nDataset:      ${zipPath}  (${(zipStat.size / 1024 / 1024).toFixed(1)} MB)`);
  console.log(`Contact sheet: ${path.join(outDir, "index.html")}`);
  console.log(
    `Pairs are ${OUT_WIDTH}×${OUT_HEIGHT} (trainer minimum is ${MIN_PAIR_EDGE}px per edge).`,
  );
  console.log(
    `\nEstimated training cost at ${steps} steps: $${estimateTrainingCost(steps, 1).toFixed(2)}`,
  );
  if (!validation.ok) {
    console.log(`\nNot ready to train — fix the errors above first.`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nReview the contact sheet, then:`);
  console.log(`  pnpm ghost:lora:train --dataset ${zipPath} --steps ${steps} --yes`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
