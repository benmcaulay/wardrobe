/**
 * Gemini text + vision calls, for everything that needs words or JSON back
 * rather than an image.
 *
 * The sibling `ghost-provider-gemini.ts` covers image→image edits through the
 * Interactions API. This module covers the ordinary generateContent endpoint,
 * which is what the garment classifier, the trip parser, and the style-note
 * parser need: a prompt (optionally with images) in, structured JSON out.
 *
 * One module rather than a call per service so the model default, the timeout,
 * the JSON-mode plumbing, and the "model returned prose around the JSON"
 * recovery live in exactly one place.
 */
import { strEnv } from "../env";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

/** Newest flash tier — cheap, fast, and vision-capable. */
export const DEFAULT_GEMINI_TEXT_MODEL = "gemini-3.7-flash";

export type GeminiImage = { buffer: Buffer; mime: string };

export type GeminiTextOptions = {
  images?: GeminiImage[];
  model?: string;
  apiKey?: string;
  timeoutMs?: number;
  /** Ask for application/json and parse it. Defaults to true for geminiJson. */
  json?: boolean;
};

type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

type GenerateContentResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
};

/**
 * HTTP statuses worth trying again.
 *
 * 503 is the common one — the flash models return "experiencing high demand"
 * under load, and it is explicitly temporary. 429 is rate limiting. Retrying
 * these matters more here than it looks: every caller degrades to an empty
 * result or a keyword fallback, so without a retry a transient spike silently
 * looks like "the feature found nothing" rather than "try again in a second".
 */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
/** Base for exponential backoff; attempt N waits BACKOFF_MS * 2^(N-1). */
const BACKOFF_MS = 400;

class RetryableGeminiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function geminiTextConfigured(): boolean {
  return Boolean(strEnv("GEMINI_API_KEY"));
}

function buildParts(prompt: string, images: GeminiImage[]): Part[] {
  return [
    { text: prompt },
    ...images.map((img) => ({
      inline_data: { mime_type: img.mime, data: img.buffer.toString("base64") },
    })),
  ];
}

/** Raw text completion. Throws on transport, HTTP, or safety-block failures. */
export async function geminiText(prompt: string, opts: GeminiTextOptions = {}): Promise<string> {
  const apiKey = opts.apiKey?.trim() || strEnv("GEMINI_API_KEY", "");
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set. Get a key from Google AI Studio and add it to .env.");
  }
  const model = opts.model?.trim() || strEnv("GEMINI_TEXT_MODEL", DEFAULT_GEMINI_TEXT_MODEL);

  const body = JSON.stringify({
    contents: [{ role: "user", parts: buildParts(prompt, opts.images ?? []) }],
    generationConfig: {
      ...(opts.json === false ? {} : { responseMimeType: "application/json" }),
      temperature: 0,
    },
  });

  for (let attempt = 1; ; attempt++) {
    try {
      return await attemptRequest(model, apiKey, body, opts.timeoutMs ?? 60_000);
    } catch (err) {
      const retryable = err instanceof RetryableGeminiError;
      if (!retryable || attempt >= MAX_ATTEMPTS) throw err;
      await sleep(BACKOFF_MS * 2 ** (attempt - 1));
    }
  }
}

async function attemptRequest(
  model: string,
  apiKey: string,
  body: string,
  timeoutMs: number,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  const raw = await response.text();
  let parsed: GenerateContentResponse;
  try {
    parsed = JSON.parse(raw) as GenerateContentResponse;
  } catch {
    if (RETRYABLE_STATUS.has(response.status)) {
      throw new RetryableGeminiError(response.status, `Gemini returned non-JSON (HTTP ${response.status})`);
    }
    throw new Error(`Gemini returned non-JSON (HTTP ${response.status}): ${raw.slice(0, 200)}`);
  }
  if (!response.ok) {
    const message = `Gemini request failed (HTTP ${response.status}): ${parsed.error?.message ?? raw.slice(0, 200)}`;
    if (RETRYABLE_STATUS.has(response.status)) {
      throw new RetryableGeminiError(response.status, message);
    }
    throw new Error(message);
  }
  if (parsed.promptFeedback?.blockReason) {
    throw new Error(`Gemini blocked the prompt: ${parsed.promptFeedback.blockReason}`);
  }
  const text = parsed.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text.trim()) {
    throw new Error(
      `Gemini returned no text (finishReason: ${parsed.candidates?.[0]?.finishReason ?? "unknown"})`,
    );
  }
  return text;
}

/**
 * Strip the fences a model adds even in JSON mode, then parse. Kept separate
 * from the request so callers with a cached response can reuse it.
 */
export function parseJsonLoose<T>(text: string): T | null {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Fall back to the outermost {...} or [...] block, for prose-wrapped replies.
    const match = cleaned.match(/[[{][\s\S]*[\]}]/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as T;
    } catch {
      return null;
    }
  }
}

/** Structured call: prompt (plus optional images) in, parsed JSON out. */
export async function geminiJson<T>(prompt: string, opts: GeminiTextOptions = {}): Promise<T> {
  const text = await geminiText(prompt, { ...opts, json: opts.json ?? true });
  const parsed = parseJsonLoose<T>(text);
  if (parsed === null) {
    throw new Error(`Gemini reply was not parseable JSON: ${text.slice(0, 200)}`);
  }
  return parsed;
}
