/**
 * Helpers for training and using a ghost-mannequin edit LoRA.
 *
 * ── Why a LoRA ──────────────────────────────────────────────────────────────
 *
 * The prompt has been through several rounds of "no wrinkles, no creases, no
 * puckering" and the renders still come back creased. Negation is the weakest
 * control surface these models expose — Seedream's own guidance says the model
 * is literal and prefers description over exclusion, and Seedream 5.0 Lite
 * dropped negative prompting entirely.
 *
 * An edit LoRA sidesteps the argument. Train on before/after pairs — the messy
 * source photo and the render we actually wanted — and the transformation is
 * learned from examples instead of described in adjectives. One training run
 * costs about as much as 300 generations and does not need to be re-argued
 * every time the prompt is edited.
 *
 * Schemas below come from the endpoint OpenAPI, not guesses:
 *   trainer:   fal-ai/flux-2-trainer/edit
 *   inference: fal-ai/flux-2/lora/edit
 */

/** Trains an edit LoRA from before/after pairs. */
export const LORA_TRAINER_ENDPOINT = "fal-ai/flux-2-trainer/edit";

/** Runs FLUX.2 [dev] editing with trained LoRAs applied. */
export const LORA_EDIT_ENDPOINT = "fal-ai/flux-2/lora/edit";

/**
 * `image_urls` on the LoRA edit endpoint accepts at most 4 entries. Ghost
 * generation passes the garment plus every selected source image, which can
 * exceed that — silently 400ing the request — so callers must cap first.
 */
export const MAX_EDIT_IMAGE_URLS = 4;

/** At most 3 LoRAs may be stacked per request. */
export const MAX_LORAS = 3;

/** Below this the LoRA generalises poorly; the trainer docs ask for 15+. */
export const MIN_PAIRS = 15;

/** More pairs keep helping, but past this the marginal gain drops off. */
export const RECOMMENDED_MAX_PAIRS = 50;

/** Trainer requires both sides of a pair to be at least this on each edge. */
export const MIN_PAIR_EDGE = 1024;

/** Trainer default; 100–10000 in steps of 100. */
export const DEFAULT_STEPS = 1000;

/** Trainer default learning rate. */
export const DEFAULT_LEARNING_RATE = 0.00005;

/**
 * Cost multiplier by number of reference images per pair. Straight from the
 * trainer's published pricing table — not interpolated.
 */
const REFERENCE_MULTIPLIER: Record<number, number> = {
  1: 2.11,
  2: 3.44,
  3: 5.09,
  4: 6.95,
};

/** Per-step base rate for the edit trainer. */
const COST_PER_STEP = 0.0056;

/**
 * Estimated USD cost of a training run: 0.0056 × steps × reference_multiplier.
 * `referenceImages` is the number of *input* images per pair (1 = just _start).
 */
export function estimateTrainingCost(steps: number, referenceImages = 1): number {
  const multiplier = REFERENCE_MULTIPLIER[referenceImages];
  if (multiplier === undefined) {
    throw new Error(
      `referenceImages must be 1-4 (got ${referenceImages}); the trainer accepts at most 4 per pair.`,
    );
  }
  return COST_PER_STEP * steps * multiplier;
}

/**
 * Filenames for pair `index`, following the trainer's required convention:
 * a shared root with `_start` / `_end` suffixes, plus an optional `.txt`
 * holding the edit instruction for that pair.
 */
export function pairFileNames(index: number, ext = "png"): {
  root: string;
  start: string;
  end: string;
  caption: string;
} {
  const root = String(index).padStart(4, "0");
  return {
    root,
    start: `${root}_start.${ext}`,
    end: `${root}_end.${ext}`,
    caption: `${root}.txt`,
  };
}

export type DatasetPair = {
  /** Stable id for tracing a pair back to its source item. */
  id: string;
  startBytes: number;
  endBytes: number;
  startWidth: number;
  startHeight: number;
  endWidth: number;
  endHeight: number;
};

export type DatasetValidation = {
  ok: boolean;
  /** Blocking problems — training would fail or waste money. */
  errors: string[];
  /** Non-blocking, but worth reading before spending. */
  warnings: string[];
};

/**
 * Check a dataset before paying for a run. Training is billed per step
 * regardless of whether the data was any good, so every problem worth catching
 * should be caught here rather than after $12 of compute.
 */
export function validateDataset(pairs: DatasetPair[]): DatasetValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (pairs.length < MIN_PAIRS) {
    errors.push(
      `Only ${pairs.length} pair(s); the trainer wants at least ${MIN_PAIRS}. ` +
        `Add more approved renders before spending on a run.`,
    );
  }
  if (pairs.length > RECOMMENDED_MAX_PAIRS) {
    warnings.push(
      `${pairs.length} pairs exceeds the recommended ${RECOMMENDED_MAX_PAIRS}; ` +
        `extra pairs add cost without much gain.`,
    );
  }

  for (const p of pairs) {
    if (p.startBytes === 0 || p.endBytes === 0) {
      errors.push(`Pair ${p.id} has an empty image.`);
      continue;
    }
    const tooSmall = [
      ["start", p.startWidth, p.startHeight],
      ["end", p.endWidth, p.endHeight],
    ].filter(([, w, h]) => (w as number) < MIN_PAIR_EDGE || (h as number) < MIN_PAIR_EDGE);
    for (const [side, w, h] of tooSmall) {
      warnings.push(
        `Pair ${p.id} ${side} is ${w}×${h}, below the ${MIN_PAIR_EDGE}px minimum — it will be upscaled.`,
      );
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Trim `image_urls` to the endpoint maximum, keeping the primary garment first.
 * Order is load-bearing: the first image drives pose, so extras are what get
 * dropped, never the garment.
 */
export function capEditImageUrls(urls: string[], max = MAX_EDIT_IMAGE_URLS): string[] {
  return urls.slice(0, max);
}

export type LoraRef = { path: string; scale: number };

/**
 * Build the `loras` input. Scale is clamped to the endpoint's 0–4 range;
 * 1 is the trained strength and a good default.
 */
export function loraInput(url: string, scale = 1): LoraRef[] {
  if (!url.trim()) return [];
  return [{ path: url.trim(), scale: Math.min(4, Math.max(0, scale)) }];
}

/**
 * Default instruction written into each pair's `.txt`. The LoRA learns the
 * transformation from the images; this only needs to name it consistently so
 * the same phrasing can be used at inference.
 */
export const DEFAULT_EDIT_CAPTION =
  "Convert this garment photo into a floating ghost-mannequin catalog render: " +
  "upright, fully unfolded, smooth and freshly pressed, correctly exposed, " +
  "centered on a pure white background with no shadows.";
