/**
 * Measure the similarity distribution of a real closet, and derive the
 * thresholds that camera-roll wear matching runs on.
 * Run with: pnpm calibrate:wear-match
 *
 * ── Why this has to be measured ─────────────────────────────────────────────
 *
 * CLIP-family cosine similarity is not calibrated in absolute terms. Two
 * completely unrelated garment photos do not score near 0 — they score high,
 * because they are both "a photo of a piece of clothing on a white background",
 * and that shared structure dominates the embedding. A threshold picked by
 * intuition (0.5 feels like "quite similar") would match every item in the
 * closet against every photo.
 *
 * So the only meaningful question is *relative*: how far above the
 * closet's own background similarity does a candidate sit? This script
 * measures that background — the full distribution of pairwise similarities
 * between distinct items the user owns — and reports the percentiles that
 * lib/wear/photo-match.ts uses as its floor.
 *
 * Re-run after changing the encoder or its dtype. Both move the distribution,
 * and a threshold calibrated against the old one is silently wrong.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { AutoProcessor, CLIPVisionModelWithProjection, env, RawImage } from "@huggingface/transformers";
import { cosineSimilarity, normalizeEmbedding } from "../lib/wear/embedding";
import { UPLOADS_ROOT } from "../lib/storage";

const LOCAL_MODEL_ID = "mobileclip-s2";
const SAMPLE_LIMIT = Number(process.env.CALIBRATE_LIMIT ?? 160);

const prisma = new PrismaClient();

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[index];
}

async function main() {
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = path.join(process.cwd(), "public", "models");

  const items = await prisma.wardrobeItem.findMany({
    where: { isWishlist: false },
    select: { id: true, name: true, category: true, originalImagePath: true, ghostImagePath: true },
    take: SAMPLE_LIMIT,
  });
  console.log(`Embedding ${items.length} closet items …`);

  const processor = await AutoProcessor.from_pretrained(LOCAL_MODEL_ID);
  const model = await CLIPVisionModelWithProjection.from_pretrained(LOCAL_MODEL_ID, { dtype: "fp16" });

  const embedded: { id: string; name: string; category: string; vector: Float32Array }[] = [];
  for (const item of items) {
    const relative = item.ghostImagePath ?? item.originalImagePath;
    const file = path.join(UPLOADS_ROOT, relative);
    try {
      await fs.access(file);
    } catch {
      continue; // image gone; skip rather than abort the whole run
    }
    try {
      const image = await RawImage.read(file);
      const inputs = await processor(image);
      const { image_embeds: embeds } = await model(inputs);
      embedded.push({
        id: item.id,
        name: item.name,
        category: item.category,
        vector: normalizeEmbedding(Float32Array.from(embeds.data as Iterable<number>)),
      });
    } catch {
      continue;
    }
    if (embedded.length % 25 === 0) console.log(`  ${embedded.length}/${items.length}`);
  }

  if (embedded.length < 10) {
    console.log("Not enough images to calibrate.");
    return;
  }

  const all: number[] = [];
  const sameCategory: number[] = [];
  let nearestSum = 0;
  const nearest: { a: string; b: string; score: number }[] = [];

  for (let i = 0; i < embedded.length; i += 1) {
    let best = -1;
    let bestName = "";
    for (let j = 0; j < embedded.length; j += 1) {
      if (i === j) continue;
      const score = cosineSimilarity(embedded[i].vector, embedded[j].vector);
      if (j > i) {
        all.push(score);
        if (embedded[i].category === embedded[j].category) sameCategory.push(score);
      }
      if (score > best) {
        best = score;
        bestName = embedded[j].name;
      }
    }
    nearestSum += best;
    nearest.push({ a: embedded[i].name, b: bestName, score: best });
  }

  all.sort((x, y) => x - y);
  sameCategory.sort((x, y) => x - y);
  nearest.sort((x, y) => y.score - x.score);

  const mean = all.reduce((s, x) => s + x, 0) / all.length;

  console.log(`\n── Pairwise similarity between DISTINCT items (n=${all.length}) ──`);
  console.log(`  mean    ${mean.toFixed(4)}`);
  for (const p of [50, 75, 90, 95, 99, 99.9]) {
    console.log(`  p${String(p).padEnd(5)} ${percentile(all, p).toFixed(4)}`);
  }
  console.log(`  max     ${all[all.length - 1].toFixed(4)}`);

  console.log(`\n── Same-category pairs only (n=${sameCategory.length}) ──`);
  console.log(`  mean    ${(sameCategory.reduce((s, x) => s + x, 0) / sameCategory.length).toFixed(4)}`);
  console.log(`  p95     ${percentile(sameCategory, 95).toFixed(4)}`);

  console.log(`\n── Nearest neighbour per item ──`);
  console.log(`  mean    ${(nearestSum / embedded.length).toFixed(4)}`);
  console.log(`  Closest confusable pairs (these are what a matcher will mix up):`);
  for (const pair of nearest.slice(0, 6)) {
    console.log(`    ${pair.score.toFixed(4)}  ${pair.a}  ~  ${pair.b}`);
  }

  console.log(`\n── Suggested constants for lib/wear/photo-match.ts ──`);
  console.log(`  BACKGROUND_SIMILARITY = ${percentile(all, 50).toFixed(3)}   // median distinct-item pair`);
  console.log(`  MATCH_FLOOR           = ${percentile(all, 99).toFixed(3)}   // p99 of distinct pairs`);
  console.log(
    `\n  A crop must beat MATCH_FLOOR to be considered at all: at p99, ~1% of\n` +
      `  unrelated closet pairs already score that high, so anything lower is\n` +
      `  indistinguishable from noise on this wardrobe.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
