/**
 * One door for "prompt, maybe some images, give me words or JSON back".
 *
 * Behind it sit Gemini (hosted, the default, the only one production can
 * reach) and Ollama (a model on this machine, free and offline). Callers —
 * the garment classifier, the directive parser, the trip and style-note
 * parsers, the product searches — should not care which answered, so none of
 * them import a provider directly.
 *
 * Gemini stays the default deliberately. The deployed app has no laptop to
 * talk to, so anything that silently preferred a local model would work in
 * dev and fail in production, which is the worst of the available defaults.
 *
 * Scope: understanding only. Ghost-mannequin rendering is image *generation*
 * and goes through `ghostMannequin.ts`; no vision-language model replaces it.
 */
import { strEnv } from "../env";
import {
  geminiText,
  geminiTextConfigured,
  parseJsonLoose,
  type GeminiTextOptions,
} from "./gemini-text";
import { ollamaText, ollamaVisionModel, type OllamaTextOptions } from "./ollama-text";

export { parseJsonLoose };

export type VisionProvider = "gemini" | "ollama";

export type VisionImage = { buffer: Buffer; mime: string };

export type VisionTextOptions = {
  images?: VisionImage[];
  /** Overrides the provider's own default model. Provider-specific. */
  model?: string;
  timeoutMs?: number;
  json?: boolean;
  /** Force one provider for this call, ignoring the configured default. */
  provider?: VisionProvider;
};

/**
 * Configured provider. Anything unrecognised falls back to Gemini rather than
 * throwing: a typo in an env var should not take out every AI feature at once.
 */
export function visionProvider(): VisionProvider {
  return strEnv("VISION_PROVIDER", "gemini").trim().toLowerCase() === "ollama"
    ? "ollama"
    : "gemini";
}

/**
 * Whether the active provider can be called at all.
 *
 * For Gemini this is "is there a key". For Ollama there is nothing to check
 * without a network round trip, and selecting it is itself the assertion that
 * it is running — a failure then surfaces as a real error, which every caller
 * already degrades from, rather than silently reverting to stub data.
 */
export function visionTextConfigured(): boolean {
  return visionProvider() === "ollama" || geminiTextConfigured();
}

/** Model that will actually serve a call, for logging and cost attribution. */
export function visionModelLabel(): string {
  return visionProvider() === "ollama"
    ? ollamaVisionModel()
    : strEnv("GEMINI_TEXT_MODEL", "gemini-3.7-flash");
}

export async function visionText(prompt: string, opts: VisionTextOptions = {}): Promise<string> {
  const provider = opts.provider ?? visionProvider();
  const shared = { images: opts.images, model: opts.model, timeoutMs: opts.timeoutMs, json: opts.json };
  return provider === "ollama"
    ? ollamaText(prompt, shared satisfies OllamaTextOptions)
    : geminiText(prompt, shared satisfies GeminiTextOptions);
}

/** Structured call: prompt (plus optional images) in, parsed JSON out. */
export async function visionJson<T>(prompt: string, opts: VisionTextOptions = {}): Promise<T> {
  const text = await visionText(prompt, { ...opts, json: opts.json ?? true });
  const parsed = parseJsonLoose<T>(text);
  if (parsed === null) {
    throw new Error(
      `${visionModelLabel()} reply was not parseable JSON: ${text.slice(0, 200)}`,
    );
  }
  return parsed;
}
