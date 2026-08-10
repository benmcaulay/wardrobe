/**
 * Integration check for the on-device encoder's staged artefacts.
 * Run with: pnpm test:embedding   (needs `pnpm embedding:fetch` first)
 *
 * The unit tests cover the codec and the maths; they cannot tell you whether
 * the *weights in /public* are the model the code was written against. This
 * loads them for real and checks the things that would otherwise only fail in
 * a browser, on a user's machine, at the end of a 72 MB download:
 *
 *   - the staged files are a loadable fp16 vision tower
 *   - output width is EMBEDDING_DIMS (512) — the number lib/wear/embedding.ts,
 *     the DB column default, and the sync action all hard-code
 *   - embeddings are deterministic and finite
 *
 * ── This is a smoke test, not a quality gate ────────────────────────────────
 *
 * An earlier version of this file checked that different garments were
 * "distinguishable" (cosine well under 1) and passed happily on a q8 model that
 * scored 0.7% top-1 retrieval — chance. Separation in a handful of pairs says
 * nothing about whether ranking works across a whole closet.
 *
 * The real gate is `pnpm benchmark:wear-retrieval`, which measures top-1/top-5
 * retrieval over the actual wardrobe. Run that after any encoder or dtype
 * change; this file only catches a missing or corrupt artefact.
 *
 * Runs through onnxruntime-node rather than the browser's WASM/WebGPU build.
 * Backends differ in speed, not in weights, so this validates the artefact.
 */
import path from "node:path";
import { AutoProcessor, CLIPVisionModelWithProjection, env, RawImage } from "@huggingface/transformers";
import { cosineSimilarity, EMBEDDING_DIMS, normalizeEmbedding } from "../lib/wear/embedding";

const LOCAL_MODEL_ID = "mobileclip-s2";
const FIXTURES = [
  "fixtures/ghost/IMG_7427.jpeg",
  "fixtures/ghost/IMG_7431.jpeg",
  "fixtures/ghost/IMG_7407.jpeg",
];

const assert = (cond: unknown, msg: string) => {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  ok: ${msg}`);
};

async function main() {
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = path.join(process.cwd(), "public", "models");

  console.log(`Loading ${LOCAL_MODEL_ID} from public/models …`);
  const started = Date.now();
  const processor = await AutoProcessor.from_pretrained(LOCAL_MODEL_ID);
  const model = await CLIPVisionModelWithProjection.from_pretrained(LOCAL_MODEL_ID, {
    dtype: "fp16",
  });
  console.log(`  loaded in ${Date.now() - started}ms`);

  const embed = async (file: string) => {
    const image = await RawImage.read(path.join(process.cwd(), file));
    const inputs = await processor(image);
    const { image_embeds: embeds } = await model(inputs);
    return normalizeEmbedding(Float32Array.from(embeds.data as Iterable<number>));
  };

  const first = await embed(FIXTURES[0]);
  assert(first.length === EMBEDDING_DIMS, `output width is ${EMBEDDING_DIMS} (got ${first.length})`);
  assert(first.every((v) => Number.isFinite(v)), "no NaN/Inf in the output");

  const norm = Math.sqrt(first.reduce((sum, v) => sum + v * v, 0));
  assert(Math.abs(norm - 1) < 1e-5, `unit length after normalize (got ${norm.toFixed(6)})`);

  const again = await embed(FIXTURES[0]);
  assert(cosineSimilarity(first, again) > 0.9999, "same image embeds deterministically");

  const others = [];
  for (const file of FIXTURES.slice(1)) others.push(await embed(file));

  for (const [i, other] of others.entries()) {
    const similarity = cosineSimilarity(first, other);
    console.log(`  cos(${FIXTURES[0]}, ${FIXTURES[i + 1]}) = ${similarity.toFixed(4)}`);
    // Weak by design — see the header. Only catches a totally degenerate space.
    assert(similarity < 0.98, "different garments are not collapsed (cos < 0.98)");
  }

  console.log("\nEncoder artefacts verified.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
