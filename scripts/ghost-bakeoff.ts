/**
 * Offline fal.ai ghost-prompt bakeoff.
 *
 * Runs each fixture × variant through fal, optionally applies local post-process,
 * and writes a side-by-side HTML gallery + manifest for visual scoring.
 *
 * Usage:
 *   pnpm ghost:bakeoff -- --fixtures=./fixtures/ghost --config=./scripts/ghost-bakeoff.variants.example.json
 *   pnpm ghost:bakeoff -- --fixtures=./fixtures/ghost --config=./my-variants.json --out=./tmp/ghost-bakeoff --dry-run
 *
 * Requires FAL_KEY in .env (unless --dry-run).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fal } from "@fal-ai/client";
import sharp from "sharp";
import { buildPrompt } from "../lib/services/ghostMannequin";
import type { GhostMannequinCategory } from "../lib/services/ghost-mannequin-shared";
import { fetchFalResultBuffer } from "../lib/services/fal-result-fetch";
import { whitenBackground } from "../lib/services/whiten-background";
import { centerCatalogImage } from "../lib/services/center-catalog-image";
import { softenCatalogShadows } from "../lib/services/flatten-catalog-lighting";
import { removeNeckPost } from "../lib/services/remove-neck-post";

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const CATEGORIES: GhostMannequinCategory[] = [
  "upperbody",
  "lowerbody",
  "footwear",
  "dress",
  "full",
];
const BASE_WIDTH = 1024;
const BASE_HEIGHT = 1366;

type PostProcessMode = "none" | "whiten" | "full";
type EnhanceMode = "fast" | "standard";

type VariantDefaults = {
  model?: string;
  enhancePromptMode?: EnhanceMode;
  postProcess?: PostProcessMode;
  runs?: number;
  compositionHint?: "default" | "rear";
  instructions?: string;
};

type VariantConfig = VariantDefaults & {
  id: string;
  label?: string;
  /** Use production buildPrompt(), or supply `prompt` / `promptFile`. */
  promptSource?: "production" | "custom";
  prompt?: string;
  promptFile?: string;
};

type BakeoffConfig = {
  defaults?: VariantDefaults;
  variants: VariantConfig[];
};

type FixtureMeta = {
  id: string;
  filePath: string;
  category: GhostMannequinCategory;
  compositionHint: "default" | "rear";
  instructions?: string;
};

type CellResult = {
  fixtureId: string;
  variantId: string;
  run: number;
  ok: boolean;
  ms?: number;
  error?: string;
  model?: string;
  enhancePromptMode?: string;
  postProcess?: string;
  promptPath?: string;
  imagePath?: string;
  rawPath?: string;
};

function argValue(flag: string): string | undefined {
  const argv = process.argv.slice(2);
  const eq = argv.find((a) => a.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1);
  const i = argv.indexOf(flag);
  if (i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith("--")) return argv[i + 1];
  return undefined;
}

function hasFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function parseCategory(raw: string | undefined, fallback: GhostMannequinCategory): GhostMannequinCategory {
  if (!raw) return fallback;
  const c = raw.trim().toLowerCase() as GhostMannequinCategory;
  return CATEGORIES.includes(c) ? c : fallback;
}

function mimeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

async function loadConfig(configPath: string): Promise<BakeoffConfig> {
  const raw = await fs.readFile(configPath, "utf8");
  const parsed = JSON.parse(raw) as BakeoffConfig;
  if (!Array.isArray(parsed.variants) || parsed.variants.length === 0) {
    throw new Error("Config must include a non-empty variants[] array");
  }
  return parsed;
}

async function loadFixtures(fixturesDir: string): Promise<FixtureMeta[]> {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(fixturesDir);
  } catch {
    throw new Error(
      `Fixtures dir not found: ${fixturesDir}. Create it and add images (see fixtures/ghost/README.md).`,
    );
  }
  const files = entries
    .filter((f) => IMAGE_EXT.has(path.extname(f).toLowerCase()))
    .filter((f) => !f.startsWith("."))
    .sort((a, b) => a.localeCompare(b));

  if (files.length === 0) return [];

  const fixtures: FixtureMeta[] = [];
  for (const file of files) {
    const filePath = path.join(fixturesDir, file);
    const base = path.basename(file, path.extname(file));
    const metaPath = path.join(fixturesDir, `${base}.meta.json`);

    let category: GhostMannequinCategory = "full";
    let compositionHint: "default" | "rear" = "default";
    let instructions: string | undefined;

    const prefix = CATEGORIES.find((c) => base.toLowerCase().startsWith(`${c}__`));
    if (prefix) category = prefix;

    try {
      const metaRaw = await fs.readFile(metaPath, "utf8");
      const meta = JSON.parse(metaRaw) as {
        category?: string;
        compositionHint?: "default" | "rear";
        instructions?: string;
      };
      category = parseCategory(meta.category, category);
      if (meta.compositionHint === "rear" || meta.compositionHint === "default") {
        compositionHint = meta.compositionHint;
      }
      if (meta.instructions?.trim()) instructions = meta.instructions.trim();
    } catch {
      /* no sidecar */
    }

    fixtures.push({
      id: slug(base),
      filePath,
      category,
      compositionHint,
      instructions,
    });
  }
  return fixtures;
}

function resolveVariant(
  v: VariantConfig,
  defaults: VariantDefaults,
): Required<
  Pick<VariantConfig, "id" | "model" | "enhancePromptMode" | "postProcess" | "runs" | "compositionHint">
> &
  VariantConfig {
  return {
    ...defaults,
    ...v,
    id: v.id,
    model: v.model ?? defaults.model ?? "fal-ai/bytedance/seedream/v4/edit",
    enhancePromptMode: v.enhancePromptMode ?? defaults.enhancePromptMode ?? "fast",
    postProcess: v.postProcess ?? defaults.postProcess ?? "none",
    runs: Math.max(1, v.runs ?? defaults.runs ?? 1),
    compositionHint: v.compositionHint ?? defaults.compositionHint ?? "default",
  };
}

async function resolvePrompt(
  variant: VariantConfig,
  fixture: FixtureMeta,
  configDir: string,
  defaults: VariantDefaults,
): Promise<string> {
  if (variant.prompt?.trim()) return variant.prompt.trim();
  if (variant.promptFile) {
    const p = path.isAbsolute(variant.promptFile)
      ? variant.promptFile
      : path.join(configDir, variant.promptFile);
    return (await fs.readFile(p, "utf8")).trim();
  }
  const source = variant.promptSource ?? (variant.prompt || variant.promptFile ? "custom" : "production");
  if (source === "production") {
    const hint = variant.compositionHint ?? defaults.compositionHint ?? fixture.compositionHint;
    const instructions = variant.instructions ?? defaults.instructions ?? fixture.instructions;
    return buildPrompt(fixture.category, instructions, hint);
  }
  throw new Error(`Variant "${variant.id}" needs prompt, promptFile, or promptSource:"production"`);
}

async function uploadBufferToFal(buf: Buffer, name: string, mime: string): Promise<string> {
  const file = new File([new Uint8Array(buf)], name, { type: mime });
  return fal.storage.upload(file);
}

async function callFal(opts: {
  model: string;
  prompt: string;
  imageUrls: string[];
  enhancePromptMode: EnhanceMode;
}): Promise<string> {
  const response = await fal.subscribe(opts.model, {
    input: {
      prompt: opts.prompt,
      image_urls: opts.imageUrls,
      num_images: 1,
      enhance_prompt_mode: opts.enhancePromptMode,
    },
    logs: false,
  });
  const data = response?.data as
    | { images?: Array<{ url?: string }>; image?: { url?: string } }
    | undefined;
  const url = data?.images?.[0]?.url ?? data?.image?.url ?? "";
  if (!url) throw new Error("fal.ai returned no image url");
  return url;
}

async function applyPostProcess(
  raw: Buffer,
  category: GhostMannequinCategory,
  mode: PostProcessMode,
): Promise<Buffer> {
  if (mode === "none") {
    return sharp(raw)
      .rotate()
      .resize({ width: BASE_WIDTH, height: BASE_HEIGHT, fit: "inside", withoutEnlargement: false })
      .jpeg({ quality: 88 })
      .toBuffer();
  }

  const normalised = await sharp(raw)
    .rotate()
    .resize({ width: BASE_WIDTH, height: BASE_HEIGHT, fit: "inside", withoutEnlargement: false })
    .png()
    .toBuffer();

  const { flattened, cutout } = await whitenBackground(normalised);
  if (mode === "whiten") {
    return sharp(flattened).jpeg({ quality: 88 }).toBuffer();
  }

  const deNecked = await removeNeckPost(flattened, cutout, { skip: category === "footwear" });
  const centered = await centerCatalogImage(deNecked.cutout, {
    width: BASE_WIDTH,
    height: BASE_HEIGHT,
  });
  return softenCatalogShadows(centered.flattened, centered.cutout);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildGalleryHtml(opts: {
  fixtures: FixtureMeta[];
  variants: ReturnType<typeof resolveVariant>[];
  cells: CellResult[];
  startedAt: string;
}): string {
  const { fixtures, variants, cells, startedAt } = opts;
  const cellMap = new Map<string, CellResult[]>();
  for (const c of cells) {
    const key = `${c.fixtureId}::${c.variantId}`;
    const list = cellMap.get(key) ?? [];
    list.push(c);
    cellMap.set(key, list);
  }

  const header = variants
    .map(
      (v) =>
        `<th><div class="vid">${escapeHtml(v.id)}</div><div class="label">${escapeHtml(v.label ?? "")}</div><div class="meta">${escapeHtml(v.model)} · ${escapeHtml(v.postProcess)} · enhance=${escapeHtml(v.enhancePromptMode)}</div></th>`,
    )
    .join("");

  const rows = fixtures
    .map((f) => {
      const cellsHtml = variants
        .map((v) => {
          const runs = cellMap.get(`${f.id}::${v.id}`) ?? [];
            const imgs = runs
            .map((r) => {
              if (!r.ok || !r.imagePath) {
                return `<div class="fail">${escapeHtml(r.error ?? "failed")}</div>`;
              }
              const href = `${escapeHtml(v.id)}/${escapeHtml(path.basename(r.imagePath))}`;
              return `<a href="${href}" target="_blank"><img src="${href}" alt="${escapeHtml(v.id)}" /></a><div class="ms">${r.ms ?? "?"}ms</div>`;
            })
            .join("");
          return `<td>${imgs || '<div class="fail">missing</div>'}</td>`;
        })
        .join("");
      return `<tr><th class="fix"><div class="fid">${escapeHtml(f.id)}</div><div class="meta">${escapeHtml(f.category)} · ${escapeHtml(f.compositionHint)}</div><div class="src"><img src="fixtures/${escapeHtml(path.basename(f.filePath))}" alt="source" /></div></th>${cellsHtml}</tr>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Ghost bakeoff ${escapeHtml(startedAt)}</title>
  <style>
    :root { color-scheme: light; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { margin: 1.5rem; background: #f4f1ea; color: #1a1613; }
    h1 { font-size: 1.4rem; margin: 0 0 0.25rem; }
    .sub { color: #6b625c; font-size: 0.85rem; margin-bottom: 1.25rem; }
    table { border-collapse: collapse; width: 100%; background: #fff; }
    th, td { border: 1px solid #ddd4c8; padding: 0.6rem; vertical-align: top; }
    th { background: #faf8f5; font-weight: 600; font-size: 0.75rem; }
    th.fix { position: sticky; left: 0; z-index: 1; min-width: 140px; background: #f3ede4; }
    .vid { font-family: ui-monospace, monospace; }
    .label { margin-top: 0.2rem; font-weight: 500; }
    .meta { color: #6b625c; font-weight: 400; margin-top: 0.25rem; font-size: 0.68rem; }
    img { display: block; width: 160px; height: auto; background: #fff; border: 1px solid #eee; }
    .src img { width: 100px; }
    .ms { font-size: 0.65rem; color: #6b625c; margin-top: 0.25rem; }
    .fail { color: #b42318; font-size: 0.7rem; max-width: 160px; }
    .score { margin-top: 0.4rem; font-size: 0.7rem; color: #6b625c; }
  </style>
</head>
<body>
  <h1>Ghost bakeoff</h1>
  <p class="sub">${escapeHtml(startedAt)} · ${fixtures.length} fixtures × ${variants.length} variants · score lining / natural shape / arms / white bg / no shadows / straight-on</p>
  <table>
    <thead><tr><th class="fix">Fixture</th>${header}</tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>
`;
}

async function main() {
  const fixturesDir = path.resolve(argValue("--fixtures") ?? "./fixtures/ghost");
  const configPath = path.resolve(
    argValue("--config") ?? "./scripts/ghost-bakeoff.variants.example.json",
  );
  const outDir = path.resolve(argValue("--out") ?? "./tmp/ghost-bakeoff");
  const dryRun = hasFlag("--dry-run");
  const limit = Number(argValue("--limit") ?? "0") || 0;
  const concurrency = Math.max(1, Number(argValue("--concurrency") ?? "1") || 1);

  const falKey = process.env.FAL_KEY?.trim();
  if (!dryRun && !falKey) {
    throw new Error("FAL_KEY is not set. Add it to .env or pass --dry-run.");
  }
  if (!dryRun) fal.config({ credentials: falKey! });

  const config = await loadConfig(configPath);
  const defaults = config.defaults ?? {};
  const variants = config.variants.map((v) => resolveVariant(v, defaults));
  let fixtures = await loadFixtures(fixturesDir);
  if (limit > 0) fixtures = fixtures.slice(0, limit);

  if (fixtures.length === 0) {
    if (!dryRun) {
      throw new Error(
        `No images in ${fixturesDir}. Add .jpg/.png fixtures (see fixtures/ghost/README.md).`,
      );
    }
    fixtures = [
      {
        id: "sample-item",
        filePath: "(no file — dry-run)",
        category: "full",
        compositionHint: "default",
      },
    ];
    console.log("No fixtures found — dry-run will preview prompts with an untyped (full) sample item.");
  }

  const totalCalls = fixtures.reduce(
    (sum, _f) => sum + variants.reduce((s, v) => s + v.runs, 0),
    0,
  );
  console.log(`Fixtures: ${fixtures.length}`);
  console.log(`Variants: ${variants.map((v) => v.id).join(", ")}`);
  console.log(`Planned fal calls: ${totalCalls}${dryRun ? " (dry-run)" : ""}`);
  console.log(`Output: ${outDir}`);

  if (dryRun) {
    for (const f of fixtures) {
      for (const v of variants) {
        const prompt = await resolvePrompt(v, f, path.dirname(configPath), defaults);
        console.log(`\n[${f.id} × ${v.id}] model=${v.model} post=${v.postProcess}`);
        console.log(prompt.slice(0, 240).replace(/\n/g, " ") + (prompt.length > 240 ? "…" : ""));
      }
    }
    return;
  }

  const startedAt = new Date().toISOString();
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });
  await fs.mkdir(path.join(outDir, "fixtures"), { recursive: true });
  await fs.mkdir(path.join(outDir, "prompts"), { recursive: true });

  for (const f of fixtures) {
    await fs.copyFile(f.filePath, path.join(outDir, "fixtures", path.basename(f.filePath)));
  }

  const cells: CellResult[] = [];
  const jobs: Array<() => Promise<void>> = [];

  for (const fixture of fixtures) {
    for (const variant of variants) {
      await fs.mkdir(path.join(outDir, variant.id), { recursive: true });
      for (let run = 1; run <= variant.runs; run++) {
        jobs.push(async () => {
          const t0 = Date.now();
          const prompt = await resolvePrompt(variant, fixture, path.dirname(configPath), defaults);
          const promptPath = path.join(
            outDir,
            "prompts",
            `${variant.id}__${fixture.id}.txt`,
          );
          await fs.writeFile(promptPath, prompt, "utf8");

          const cell: CellResult = {
            fixtureId: fixture.id,
            variantId: variant.id,
            run,
            ok: false,
            model: variant.model,
            enhancePromptMode: variant.enhancePromptMode,
            postProcess: variant.postProcess,
            promptPath: path.relative(outDir, promptPath),
          };

          try {
            const srcBuf = await fs.readFile(fixture.filePath);
            const imageUrl = await uploadBufferToFal(
              srcBuf,
              path.basename(fixture.filePath),
              mimeFor(fixture.filePath),
            );
            const resultUrl = await callFal({
              model: variant.model,
              prompt,
              imageUrls: [imageUrl],
              enhancePromptMode: variant.enhancePromptMode,
            });
            const rawBuf = await fetchFalResultBuffer(resultUrl);
            const rawPath = path.join(
              outDir,
              variant.id,
              `${fixture.id}-r${run}-raw.jpg`,
            );
            await sharp(rawBuf).jpeg({ quality: 90 }).toFile(rawPath);

            const outBuf = await applyPostProcess(
              rawBuf,
              fixture.category,
              variant.postProcess,
            );
            const imagePath = path.join(outDir, variant.id, `${fixture.id}-r${run}.jpg`);
            await fs.writeFile(imagePath, outBuf);

            cell.ok = true;
            cell.ms = Date.now() - t0;
            cell.imagePath = path.relative(outDir, imagePath);
            cell.rawPath = path.relative(outDir, rawPath);
            console.log(`OK  ${fixture.id} × ${variant.id} r${run} (${cell.ms}ms)`);
          } catch (err) {
            cell.error = (err as Error).message;
            cell.ms = Date.now() - t0;
            console.error(`FAIL ${fixture.id} × ${variant.id} r${run}: ${cell.error}`);
          }
          cells.push(cell);
        });
      }
    }
  }

  // Simple pool
  let i = 0;
  async function worker() {
    while (i < jobs.length) {
      const job = jobs[i++]!;
      await job();
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const manifest = {
    startedAt,
    finishedAt: new Date().toISOString(),
    fixturesDir,
    configPath,
    fixtures: fixtures.map((f) => ({
      id: f.id,
      file: path.basename(f.filePath),
      category: f.category,
      compositionHint: f.compositionHint,
    })),
    variants: variants.map((v) => ({
      id: v.id,
      label: v.label ?? null,
      model: v.model,
      enhancePromptMode: v.enhancePromptMode,
      postProcess: v.postProcess,
      runs: v.runs,
      promptSource: v.promptSource ?? (v.prompt || v.promptFile ? "custom" : "production"),
    })),
    results: cells,
    ok: cells.filter((c) => c.ok).length,
    failed: cells.filter((c) => !c.ok).length,
  };

  await fs.writeFile(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  await fs.writeFile(
    path.join(outDir, "index.html"),
    buildGalleryHtml({ fixtures, variants, cells, startedAt }),
  );

  console.log(`\nDone. ${manifest.ok} ok / ${manifest.failed} failed`);
  console.log(`Gallery: ${path.join(outDir, "index.html")}`);
  console.log(`Manifest: ${path.join(outDir, "manifest.json")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
