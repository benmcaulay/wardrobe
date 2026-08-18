/**
 * Gemini image-editing provider for catalog generation.
 *
 * ── Why ─────────────────────────────────────────────────────────────────────
 *
 * A second vendor behind the same contract — buffers in, edited image buffer out
 * — so a fal outage or a drained fal balance does not stop catalog work.
 *
 * NOT a free lane, despite widespread claims otherwise. Google's pricing page
 * lists Free Tier "Not available" for every image model, and the API confirms it
 * with `limit: 0` on `generate_content_free_tier_requests`. Billing must be
 * enabled on the Google project. Standard rates as of Aug 2026:
 *   gemini-2.5-flash-image      $0.039/image  (flat)
 *   gemini-3.1-flash-lite-image $0.0336/1K
 *   gemini-3.1-flash-image      $0.067/1K, $0.101/2K, $0.151/4K
 *   gemini-3-pro-image          $0.134/1K-2K, $0.24/4K
 * For reference, fal Seedream v4 edit is ~$0.03, so this is redundancy and a
 * quality option, not a cost saving.
 *
 * ── API shape ───────────────────────────────────────────────────────────────
 *
 * Uses the Interactions API, which is *not* the older
 * `generateContent`/`contents`/`parts` form:
 *
 *   POST https://generativelanguage.googleapis.com/v1beta/interactions
 *   header: x-goog-api-key
 *   body:   { model, input: [{type:"image", mime_type, data}, {type:"text", text}] }
 *   out:    { status, output_image: { data, mime_type }, steps: [...] }
 *
 * Called over plain fetch rather than adding an SDK dependency — it is one
 * request, and the schema is pinned by the types below.
 */

const INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";

/**
 * Nano Banana 2 — current flash-image flagship, best prompt adherence of the
 * flash tier. Override with GEMINI_IMAGE_MODEL: `gemini-2.5-flash-image` is the
 * cheapest at a flat $0.039, `gemini-3-pro-image` the highest quality.
 */
export const DEFAULT_GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image";

export type GeminiImageInput = {
  buffer: Buffer;
  mime: string;
};

type InteractionContent = {
  type?: string;
  text?: string;
  data?: string;
  mime_type?: string;
};

type InteractionResponse = {
  status?: string;
  output_image?: InteractionContent;
  output_text?: string;
  steps?: Array<{ type?: string; content?: InteractionContent[] }>;
  error?: { message?: string; status?: string };
};

/**
 * Pull the generated image out of a response.
 *
 * Prefers the `output_image` convenience field and falls back to scanning
 * `steps[].content[]`, because a response that used tools or emitted commentary
 * can carry the image deeper while leaving the convenience field unset.
 */
export function extractImage(
  body: InteractionResponse,
): { data: string; mime: string } | null {
  const direct = body.output_image;
  if (direct?.data) {
    return { data: direct.data, mime: direct.mime_type ?? "image/png" };
  }
  for (const step of body.steps ?? []) {
    for (const content of step.content ?? []) {
      if (content.type === "image" && content.data) {
        return { data: content.data, mime: content.mime_type ?? "image/png" };
      }
    }
  }
  return null;
}

/**
 * Build the request body. Images go before the text so the first image is the
 * one the model anchors on — same ordering contract as the fal path, where the
 * first reference drives pose.
 */
export function buildInteractionBody(
  model: string,
  prompt: string,
  images: GeminiImageInput[],
): Record<string, unknown> {
  return {
    model,
    input: [
      ...images.map((img) => ({
        type: "image",
        mime_type: img.mime,
        data: img.buffer.toString("base64"),
      })),
      { type: "text", text: prompt },
    ],
  };
}

/** Statuses that mean "no image is coming", so we fail loudly rather than hang. */
const TERMINAL_FAILURES = new Set([
  "failed",
  "cancelled",
  "incomplete",
  "budget_exceeded",
]);

export function describeFailure(body: InteractionResponse): string | null {
  if (body.error?.message) return body.error.message;
  const status = body.status?.toLowerCase();
  if (status && TERMINAL_FAILURES.has(status)) {
    return `Gemini returned status "${body.status}"${
      body.output_text ? `: ${body.output_text}` : ""
    }`;
  }
  return null;
}

export type GeminiEditOptions = {
  model?: string;
  apiKey?: string;
  /** Abort the request after this many ms. */
  timeoutMs?: number;
};

/**
 * Edit `images` according to `prompt` and return the resulting image bytes.
 * Throws on any outcome that is not an image, so callers can fall back.
 */
export async function geminiEditImage(
  prompt: string,
  images: GeminiImageInput[],
  opts: GeminiEditOptions = {},
): Promise<Buffer> {
  const apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY ?? "";
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set. Get a key from Google AI Studio and add it to .env.",
    );
  }
  if (images.length === 0) {
    throw new Error("geminiEditImage needs at least one input image.");
  }

  const model = opts.model ?? process.env.GEMINI_IMAGE_MODEL ?? DEFAULT_GEMINI_IMAGE_MODEL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 120_000);

  let response: Response;
  try {
    response = await fetch(INTERACTIONS_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(buildInteractionBody(model, prompt, images)),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  const raw = await response.text();
  let body: InteractionResponse;
  try {
    body = JSON.parse(raw) as InteractionResponse;
  } catch {
    throw new Error(
      `Gemini returned non-JSON (HTTP ${response.status}): ${raw.slice(0, 300)}`,
    );
  }

  if (!response.ok) {
    const detail = body.error?.message ?? raw.slice(0, 300);
    // 429 is the free-tier daily cap, which is worth naming explicitly rather
    // than surfacing as a generic HTTP error.
    if (response.status === 429) {
      throw new Error(
        `Gemini rate limit / daily free quota reached (HTTP 429): ${detail}`,
      );
    }
    throw new Error(`Gemini request failed (HTTP ${response.status}): ${detail}`);
  }

  const failure = describeFailure(body);
  if (failure) throw new Error(failure);

  const image = extractImage(body);
  if (!image) {
    throw new Error(
      `Gemini returned no image${body.output_text ? `: ${body.output_text.slice(0, 200)}` : ""}`,
    );
  }
  return Buffer.from(image.data, "base64");
}
