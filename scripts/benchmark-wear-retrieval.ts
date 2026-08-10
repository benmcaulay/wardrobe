/**
 * Can the on-device encoder actually re-identify a garment?
 * Run with: pnpm benchmark:wear-retrieval  (add DTYPES=q8,fp32 to compare)
 *
 * ── The question ────────────────────────────────────────────────────────────
 *
 * Camera-roll wear inference rests on one assumption: embed a picture of a
 * garment, and the right closet item comes back first. Pairwise similarity
 * statistics can't answer that — they say how *close* things are, not whether
 * ranking works. Top-1 retrieval accuracy does.
 *
 * ── The test pairs ──────────────────────────────────────────────────────────
 *
 * Items that have both an original photo and a ghost-mannequin render give free
 * positive pairs: the same physical garment, two genuinely different images
 * (different framing, lighting, background, and the ghost is model-regenerated).
 * Query with the ghost, search the originals, and see whether the correct item
 * ranks first.
 *
 * This is an *easier* task than the real one. A ghost render is still a clean
 * studio-style image of an isolated garment; a camera-roll photo has the
 * garment worn, creased, partly occluded, at an angle, under household light,
 * with a person in it. So this benchmark is an upper bound. If retrieval is
 * weak here, it cannot work there — which is exactly the thing worth knowing
 * before building a pipeline on top of it.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { AutoProcessor, CLIPVisionModelWithProjection, env, RawImage } from "@huggingface/transformers";
import { cosineSimilarity, normalizeEmbedding } from "../lib/wear/embedding";
import { UPLOADS_ROOT } from "../lib/storage";

const LOCAL_MODEL_ID = "mobileclip-s2";
const DTYPES = (process.env.DTYPES ?? "q8,fp32").split(",").map((d) => d.trim());
const LIMIT = Number(process.env.LIMIT ?? 136);

const prisma = new PrismaClient();

type Pair = { id: string; name: string; original: string; ghost: string };

async function loadPairs(): Promise<Pair[]> {
  const rows = await prisma.wardrobeItem.findMany({
    where: { isWishlist: false, ghostImagePath: { not: null } },
    select: { id: true, name: true, originalImagePath: true, ghostImagePath: true },
    take: LIMIT,
  });

  const out: Pair[] = [];
  for (const row of rows) {
    const original = path.join(UPLOADS_ROOT, row.originalImagePath);
    const ghost = path.join(UPLOADS_ROOT, row.ghostImagePath!);
    try {
      await fs.access(original);
      await fs.access(ghost);
      out.push({ id: row.id, name: row.name, original, ghost });
    } catch {
      // one of the files is gone; skip the pair rather than half-testing it
    }
  }
  return out;
}

async function benchmark(dtype: string, pairs: Pair[]) {
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = path.join(process.cwd(), "public", "models");

  const processor = await AutoProcessor.from_pretrained(LOCAL_MODEL_ID);
  const model = await CLIPVisionModelWithProjection.from_pretrained(LOCAL_MODEL_ID, {
    dtype: dtype as "q8" | "fp16" | "fp32",
  });

  const embed = async (file: string) => {
    const image = await RawImage.read(file);
    const inputs = await processor(image);
    const { image_embeds: embeds } = await model(inputs);
    return normalizeEmbedding(Float32Array.from(embeds.data as Iterable<number>));
  };

  const gallery: Float32Array[] = [];
  const queries: Float32Array[] = [];
  for (const pair of pairs) {
    gallery.push(await embed(pair.original));
    queries.push(await embed(pair.ghost));
  }

  let top1 = 0;
  let top5 = 0;
  let marginSum = 0;
  const misses: { name: string; got: string; trueScore: number; topScore: number }[] = [];

  for (let q = 0; q < queries.length; q += 1) {
    const scored = gallery
      .map((vector, index) => ({ index, score: cosineSimilarity(queries[q], vector) }))
      .sort((a, b) => b.score - a.score);

    const rank = scored.findIndex((s) => s.index === q);
    if (rank === 0) top1 += 1;
    if (rank < 5) top5 += 1;

    const trueScore = scored.find((s) => s.index === q)!.score;
    // Margin between the correct item and the best *wrong* one. Positive means
    // a threshold could separate them; negative means no threshold can.
    const bestWrong = scored.find((s) => s.index !== q)!.score;
    marginSum += trueScore - bestWrong;

    if (rank !== 0) {
      misses.push({
        name: pairs[q].name,
        got: pairs[scored[0].index].name,
        trueScore,
        topScore: scored[0].score,
      });
    }
  }

  const n = queries.length;
  console.log(`\n══ dtype: ${dtype} ══  (${n} garments)`);
  console.log(`  top-1 retrieval  ${((top1 / n) * 100).toFixed(1)}%   (${top1}/${n})`);
  console.log(`  top-5 retrieval  ${((top5 / n) * 100).toFixed(1)}%   (${top5}/${n})`);
  console.log(`  mean margin (correct − best wrong)  ${(marginSum / n).toFixed(4)}`);
  if (misses.length > 0) {
    console.log(`  sample misses:`);
    for (const miss of misses.slice(0, 5)) {
      console.log(
        `    "${miss.name}" → "${miss.got}" (${miss.topScore.toFixed(3)} vs true ${miss.trueScore.toFixed(3)})`,
      );
    }
  }
  return { dtype, top1: top1 / n, top5: top5 / n, margin: marginSum / n };
}

async function main() {
  const pairs = await loadPairs();
  console.log(`Loaded ${pairs.length} original/ghost pairs.`);
  if (pairs.length < 20) {
    console.log("Too few pairs to say anything.");
    return;
  }

  const results = [];
  for (const dtype of DTYPES) results.push(await benchmark(dtype, pairs));

  console.log(`\n══ summary ══`);
  for (const r of results) {
    console.log(
      `  ${r.dtype.padEnd(6)} top1 ${(r.top1 * 100).toFixed(1)}%  top5 ${(r.top5 * 100).toFixed(1)}%  margin ${r.margin.toFixed(4)}`,
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
