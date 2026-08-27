/**
 * What a generation actually costs, in one place.
 *
 * Every price here is per generated image, in US cents, at list price. They are
 * the numbers documented in .env.example — keep the two in step.
 *
 * Two things this is careful about:
 *
 *  - A **cache hit costs nothing.** The UI must be able to say $0.00 rather
 *    than quoting the list price for an image that was never generated.
 *  - Cents are integers. Fractional cents (a $0.067 render is 6.7¢) are held as
 *    tenths internally and only rounded when formatted, so a hundred renders
 *    sum to $6.70 rather than drifting to $7.00 one rounding at a time.
 */

/** Tenths of a US cent, so $0.067 is exactly 67 and nothing is lost to rounding. */
export type CostTenthCents = number;

const MODEL_COSTS: Record<string, CostTenthCents> = {
  // gemini image models (Google list price)
  "gemini-3.1-flash-image": 67, // Nano Banana 2 — default ($0.067)
  "gemini-3.1-flash-image-preview": 67,
  "gemini-3.1-flash-lite-image": 39,
  "gemini-2.5-flash-image": 39, // cheapest ($0.039)
  "gemini-3-pro-image": 134, // best quality ($0.134)
  "gemini-3-pro-image-preview": 134,
  // fal (footwear only)
  "fal-ai/bytedance/seedream/v4/edit": 30, // ~$0.03
  "fal-ai/seedream/v4/edit": 30,
  "fal-ai/flux-pro/kontext": 40,
  "fal-ai/flux-pro/kontext/max/multi": 80,
};

/** Charged when a model is not in the table, so an unknown model is never free. */
const UNKNOWN_MODEL_COST: CostTenthCents = 67;

export function costTenthCentsForModel(model: string | null | undefined): CostTenthCents {
  if (!model) return UNKNOWN_MODEL_COST;
  return MODEL_COSTS[model.trim()] ?? UNKNOWN_MODEL_COST;
}

export function isKnownModel(model: string | null | undefined): boolean {
  return Boolean(model && model.trim() in MODEL_COSTS);
}

/**
 * "$0.067" / "$1.34" / "$0.00". Sub-cent amounts keep three decimals because a
 * single render is 6.7¢ and "$0.07" would round away the difference between the
 * cheap and the default model — the comparison the number exists to support.
 */
export function formatTenthCents(tenths: CostTenthCents): string {
  const dollars = tenths / 1000;
  if (dollars === 0) return "$0.00";
  if (dollars < 0.01) return `$${dollars.toFixed(4)}`;
  if (dollars < 1) return `$${dollars.toFixed(3)}`;
  return `$${dollars.toFixed(2)}`;
}

/** Total for a list of generations, each already carrying its own cost. */
export function sumTenthCents(rows: Array<{ costTenthCents?: number | null }>): CostTenthCents {
  return rows.reduce((total, r) => total + (r.costTenthCents ?? 0), 0);
}

export type SpendByModel = {
  model: string;
  generations: number;
  tenthCents: CostTenthCents;
};

/** Per-model breakdown, most expensive first. */
export function groupSpendByModel(
  rows: Array<{ model?: string | null; costTenthCents?: number | null }>,
): SpendByModel[] {
  const byModel = new Map<string, SpendByModel>();
  for (const row of rows) {
    const model = row.model?.trim() || "unknown";
    const entry = byModel.get(model) ?? { model, generations: 0, tenthCents: 0 };
    entry.generations += 1;
    entry.tenthCents += row.costTenthCents ?? 0;
    byModel.set(model, entry);
  }
  return [...byModel.values()].sort((a, b) => b.tenthCents - a.tenthCents);
}

// -----------------------------------------------------------------------------
// Current configuration → what the next generation will cost
// -----------------------------------------------------------------------------

/**
 * Per-generation cost under the current env, for showing on a generate button
 * before the user commits. Reads env, so call it from a server component and
 * pass the result down — the value is a plain string, so it crosses the
 * client boundary safely.
 *
 * Footwear is priced separately because it is the one category still routed to
 * fal, which is cheaper than the gemini default.
 */
export function currentGenerationCost(kind: "footwear" | "apparel"): {
  tenthCents: number;
  label: string;
  free: boolean;
} {
  const real = (process.env.USE_REAL_GHOST_MANNEQUIN ?? "").trim().toLowerCase() === "true";
  if (!real) return { tenthCents: 0, label: "free in stub mode", free: true };

  const falAvailable = Boolean((process.env.FAL_KEY ?? "").trim());
  const forced = (process.env.GHOST_PROVIDER ?? "").trim().toLowerCase();
  const usesFal = forced === "fal" || (kind === "footwear" && falAvailable && forced !== "gemini");

  const model = usesFal
    ? (process.env.FAL_GHOST_MODEL ?? "").trim() || "fal-ai/bytedance/seedream/v4/edit"
    : (process.env.GEMINI_IMAGE_MODEL ?? "").trim() || "gemini-3.1-flash-image";

  const tenthCents = costTenthCentsForModel(model);
  return { tenthCents, label: formatTenthCents(tenthCents), free: false };
}
