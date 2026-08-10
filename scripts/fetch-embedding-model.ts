/**
 * Stage the on-device embedding model and its ONNX runtime into /public.
 * Run with: pnpm embedding:fetch   (wired into `build`, and idempotent)
 *
 * Everything the encoder needs is served from our own origin — no CDN at
 * runtime. That is not tidiness: a third-party fetch would undo the privacy
 * property the whole on-device decision was made for (a CDN request leaks that
 * this user is scanning, and when), and it breaks under a strict CSP or offline.
 *
 * Only the *vision* tower is staged. The text tower was briefly needed for a
 * global style prompt; that was replaced by structured note rules (§9), which
 * need no embedding at all — so ~256 MB of text weights and tokenizer come out.
 *
 * The artefacts are gitignored rather than committed. 37 MB of binary in git
 * history is permanent and would be re-downloaded by every clone forever;
 * fetching on build is cheap and cacheable. Deploys must therefore run this,
 * which is why it hangs off `build` rather than living in a README step.
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const HF_REPO = "Xenova/mobileclip_s2";
const HF_REVISION = "main";

/** Mirrors CURRENT_EMBEDDING_MODEL in lib/wear/embedding.ts. */
const LOCAL_MODEL_ID = "mobileclip-s2";

const PUBLIC_DIR = path.join(process.cwd(), "public");
const MODEL_DIR = path.join(PUBLIC_DIR, "models", LOCAL_MODEL_ID);
const ORT_DIR = path.join(PUBLIC_DIR, "ort");

/**
 * fp16, with fp32 staged as a fallback.
 *
 * This started as q8 (36.7 MB) to keep the download small. That was wrong, and
 * measurably so: `pnpm benchmark:wear-retrieval` on 136 real garments scores
 * q8 at **0.7% top-1 retrieval** — one correct match out of 136, i.e. chance —
 * with a *negative* mean margin, meaning the correct garment typically scores
 * below the best wrong one. int8 quantization destroys this model's embedding
 * geometry. fp16 and fp32 both score 69.9% top-1 / 85.3% top-5.
 *
 * fp16 is the primary because it matches fp32 exactly here at half the bytes.
 * fp32 is staged too because the WASM backend's fp16 support is version- and
 * platform-dependent, and lib/wear/encoder.ts falls back to it if the fp16
 * session won't build. Only one is ever downloaded by a given client.
 *
 * The lesson worth keeping: a "does it still discriminate?" sanity check passed
 * happily on the q8 model. Only a ranking benchmark caught it.
 */
const MODEL_FILES = [
  "config.json",
  "preprocessor_config.json",
  "onnx/vision_model_fp16.onnx",
  "onnx/vision_model.onnx",
];

/**
 * Every `ort-wasm-*` artefact, matched rather than listed.
 *
 * ORT picks its loader at runtime from what the browser supports, and the
 * naming differs across builds — this one reaches for the *asyncify* variant on
 * WebGPU, not the `jsep` one an explicit list would have guessed. A missing
 * file surfaces as "no available backend found", which points nowhere near the
 * cause. They are a few MB and only the one the browser needs is ever fetched.
 */
const ORT_FILE_PATTERN = /^ort-wasm-.*\.(wasm|mjs)$/;

async function exists(file: string): Promise<boolean> {
  try {
    const stat = await fs.stat(file);
    return stat.size > 0;
  } catch {
    return false;
  }
}

async function download(file: string): Promise<void> {
  const dest = path.join(MODEL_DIR, file);
  if (await exists(dest)) {
    console.log(`  cached  ${file}`);
    return;
  }

  const url = `https://huggingface.co/${HF_REPO}/resolve/${HF_REVISION}/${file}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} fetching ${url}`);
  }
  const body = Buffer.from(await response.arrayBuffer());

  await fs.mkdir(path.dirname(dest), { recursive: true });
  // Write to a temp path and rename: a build interrupted mid-download would
  // otherwise leave a truncated .onnx that `exists()` happily treats as cached,
  // and the failure surfaces later as an inscrutable ORT parse error.
  const temp = `${dest}.partial`;
  await fs.writeFile(temp, body);
  await fs.rename(temp, dest);

  const digest = createHash("sha256").update(body).digest("hex").slice(0, 12);
  console.log(`  fetched ${file} (${(body.length / 1e6).toFixed(1)} MB, sha256:${digest})`);
}

/**
 * Find onnxruntime-web's dist directory.
 *
 * It is a transitive dependency of transformers.js, so where it lands depends
 * on the package manager: hoisted at the root under npm/yarn, a sibling inside
 * the virtual store under pnpm. This repo carries both lockfiles, so both are
 * live possibilities. `require.resolve` is no help — transformers.js has an
 * `exports` map that refuses `./package.json`.
 *
 * The version must be whatever transformers.js is pinned to. A .wasm from a
 * different ORT release than the loader it is paired with fails at init with a
 * message that points nowhere near the real cause.
 */
async function resolveOrtDist(): Promise<string> {
  const linked = path.join(process.cwd(), "node_modules", "@huggingface", "transformers");
  const candidates: string[] = [];

  try {
    // .../.pnpm/<pkg>/node_modules/@huggingface/transformers → up two to the
    // virtual store's node_modules, where onnxruntime-web sits as a sibling.
    const real = await fs.realpath(linked);
    candidates.push(path.join(real, "..", "..", "onnxruntime-web", "dist"));
  } catch {
    // not installed via a symlinked store; the hoisted candidates still apply
  }
  candidates.push(path.join(linked, "node_modules", "onnxruntime-web", "dist"));
  candidates.push(path.join(process.cwd(), "node_modules", "onnxruntime-web", "dist"));

  for (const candidate of candidates) {
    try {
      const entries = await fs.readdir(candidate);
      if (entries.some((entry) => ORT_FILE_PATTERN.test(entry))) return candidate;
    } catch {
      // not this one
    }
  }
  throw new Error(
    `Could not locate onnxruntime-web/dist. Tried:\n  ${candidates.join("\n  ")}\nRun \`pnpm install\` first.`,
  );
}

async function copyRuntime(): Promise<void> {
  const distDir = await resolveOrtDist();

  await fs.mkdir(ORT_DIR, { recursive: true });
  const files = (await fs.readdir(distDir)).filter((entry) => ORT_FILE_PATTERN.test(entry));
  if (files.length === 0) throw new Error(`No ort-wasm-* artefacts in ${distDir}`);

  for (const file of files) {
    const source = path.join(distDir, file);
    const dest = path.join(ORT_DIR, file);
    if (await exists(dest)) {
      console.log(`  cached  ort/${file}`);
      continue;
    }
    await fs.copyFile(source, dest);
    console.log(`  copied  ort/${file}`);
  }
}

async function main() {
  console.log(`Staging ${HF_REPO} → public/models/${LOCAL_MODEL_ID}`);
  await fs.mkdir(MODEL_DIR, { recursive: true });
  for (const file of MODEL_FILES) await download(file);

  console.log("Staging onnxruntime-web → public/ort");
  await copyRuntime();

  console.log("Done.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
