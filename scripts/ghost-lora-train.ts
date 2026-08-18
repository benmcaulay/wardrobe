/**
 * Train the ghost-mannequin edit LoRA on fal.
 * Run with: pnpm ghost:lora:train --dataset tmp/ghost-lora/dataset.zip [--steps 1000] --yes
 *
 * This is the only script here that spends money. It refuses to start without
 * `--yes` and prints the estimated cost first, because the trainer bills per
 * step whether or not the dataset was any good — build and eyeball the contact
 * sheet from ghost-lora-build.ts before running it.
 *
 * Endpoint: fal-ai/flux-2-trainer/edit
 *   in  → image_data_url (zip), steps, learning_rate, default_caption
 *   out → diffusers_lora_file.url, config_file.url
 *
 * The resulting url goes into FAL_GHOST_LORA_URL, which switches generation to
 * fal-ai/flux-2/lora/edit with the LoRA applied.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fal } from "@fal-ai/client";
import {
  DEFAULT_EDIT_CAPTION,
  DEFAULT_LEARNING_RATE,
  DEFAULT_STEPS,
  estimateTrainingCost,
  LORA_TRAINER_ENDPOINT,
} from "@/lib/services/ghost-lora";

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const datasetArg = argValue("--dataset") ?? "tmp/ghost-lora/dataset.zip";
  const datasetPath = path.resolve(datasetArg);
  const steps = Number(argValue("--steps") ?? DEFAULT_STEPS);
  const learningRate = Number(argValue("--learning-rate") ?? DEFAULT_LEARNING_RATE);
  const confirmed = process.argv.includes("--yes");

  if (!Number.isInteger(steps) || steps < 100 || steps > 10_000 || steps % 100 !== 0) {
    console.error(`--steps must be an integer 100-10000 in increments of 100 (got ${steps}).`);
    process.exitCode = 1;
    return;
  }

  const key = process.env.FAL_KEY;
  if (!key) {
    console.error("FAL_KEY is not set. Add it to .env.");
    process.exitCode = 1;
    return;
  }

  let stat;
  try {
    stat = await fs.stat(datasetPath);
  } catch {
    console.error(
      `No dataset at ${datasetPath}.\n  Build one first: pnpm ghost:lora:build`,
    );
    process.exitCode = 1;
    return;
  }

  const cost = estimateTrainingCost(steps, 1);
  console.log(`Dataset:  ${datasetPath}  (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
  console.log(`Endpoint: ${LORA_TRAINER_ENDPOINT}`);
  console.log(`Steps:    ${steps}   Learning rate: ${learningRate}`);
  console.log(`Estimated cost: $${cost.toFixed(2)}`);

  if (!confirmed) {
    console.log(`\nDry run — nothing spent. Re-run with --yes to start training.`);
    return;
  }

  fal.config({ credentials: key });

  console.log(`\nUploading dataset…`);
  const buf = await fs.readFile(datasetPath);
  const file = new File([new Uint8Array(buf)], path.basename(datasetPath), {
    type: "application/zip",
  });
  const imageDataUrl = await fal.storage.upload(file);
  console.log(`  uploaded: ${imageDataUrl}`);

  console.log(`\nTraining (this takes a while; logs stream below)…`);
  const startedAt = Date.now();
  const result = await fal.subscribe(LORA_TRAINER_ENDPOINT, {
    input: {
      image_data_url: imageDataUrl,
      steps,
      learning_rate: learningRate,
      default_caption: DEFAULT_EDIT_CAPTION,
      output_lora_format: "fal",
    },
    logs: true,
    onQueueUpdate: (update) => {
      const logs = (update as { logs?: Array<{ message?: string }> }).logs ?? [];
      for (const l of logs) if (l.message) console.log(`  ${l.message}`);
    },
  });

  const data = result?.data as
    | { diffusers_lora_file?: { url?: string }; config_file?: { url?: string } }
    | undefined;
  const loraUrl = data?.diffusers_lora_file?.url;
  const configUrl = data?.config_file?.url;
  const mins = ((Date.now() - startedAt) / 60000).toFixed(1);

  if (!loraUrl) {
    console.error(`\nTraining finished in ${mins}m but returned no LoRA url.`);
    console.error(JSON.stringify(result?.data, null, 2));
    process.exitCode = 1;
    return;
  }

  console.log(`\nDone in ${mins}m.`);
  console.log(`LoRA:   ${loraUrl}`);
  if (configUrl) console.log(`Config: ${configUrl}`);
  console.log(`\nTo use it, add to .env:`);
  console.log(`  FAL_GHOST_LORA_URL="${loraUrl}"`);
  console.log(`\nThen A/B it against the current pipeline:`);
  console.log(`  pnpm ghost:bakeoff && pnpm eval:catalog --dir tmp/ghost-bakeoff`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
