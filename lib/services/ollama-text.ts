/**
 * Ollama text + vision calls, shaped exactly like `gemini-text.ts`.
 *
 * Same contract on purpose — prompt (optionally with images) in, text or JSON
 * out — so `vision-text.ts` can pick between them without any caller knowing
 * which one answered.
 *
 * This runs a model on the machine the Node process is on. That makes it free
 * and private, and also means it does not exist in production: the deployed
 * app cannot reach a laptop's Ollama. It is an opt-in for local work, not a
 * second deployment target.
 *
 * Only understanding, never generation. Ollama serves language and
 * vision-language models; the ghost-mannequin renders go through an image
 * model and are untouched by anything here.
 */
import { strEnv } from "../env";

/**
 * Vision-language default. 8B is the largest that leaves room to work
 * alongside a dev server on 24GB; `qwen3-vl:4b-instruct` is the faster swap
 * and `qwen3-vl:32b-instruct` the sharper one, both via OLLAMA_VISION_MODEL.
 *
 * `-instruct` and not the bare `qwen3-vl:8b`: the bare tag is the *thinking*
 * variant, which reasons its way to the answer and then puts it somewhere the
 * caller has to go looking for (see the thinking fallback below). Every use
 * here wants one JSON object, so the non-reasoning tag is both correct and
 * cheaper.
 */
export const DEFAULT_OLLAMA_VISION_MODEL = "qwen3-vl:8b-instruct";

/** 127.0.0.1 rather than localhost: avoids an IPv6-first DNS stall on macOS. */
export const DEFAULT_OLLAMA_HOST = "http://127.0.0.1:11434";

/**
 * Generous next to Gemini's 60s, because the first call after a cold start
 * pays to load several GB of weights before it generates a token.
 */
const DEFAULT_TIMEOUT_MS = 180_000;

export type OllamaImage = { buffer: Buffer; mime: string };

export type OllamaTextOptions = {
  images?: OllamaImage[];
  model?: string;
  timeoutMs?: number;
  /** Ask for JSON and let the runtime constrain decoding. Defaults to true. */
  json?: boolean;
};

type ChatResponse = {
  message?: { content?: string; thinking?: string };
  error?: string;
};

export function ollamaHost(): string {
  return strEnv("OLLAMA_HOST", DEFAULT_OLLAMA_HOST).replace(/\/+$/, "");
}

export function ollamaVisionModel(): string {
  return strEnv("OLLAMA_VISION_MODEL", DEFAULT_OLLAMA_VISION_MODEL);
}

/** Whether the daemon is up and the configured model is actually pulled. */
export async function ollamaReady(model = ollamaVisionModel()): Promise<boolean> {
  try {
    const res = await fetch(`${ollamaHost()}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { models?: Array<{ name?: string }> };
    const names = (body.models ?? []).map((m) => m.name ?? "");
    // A bare "qwen3-vl:8b" is listed as-is, but a caller may reasonably write
    // the model without its tag.
    return names.some((n) => n === model || n.split(":")[0] === model);
  } catch {
    return false;
  }
}

/** Raw text completion. Throws on transport, HTTP, or empty-reply failures. */
export async function ollamaText(prompt: string, opts: OllamaTextOptions = {}): Promise<string> {
  const model = opts.model?.trim() || ollamaVisionModel();
  const images = opts.images ?? [];

  const body = JSON.stringify({
    model,
    messages: [
      {
        role: "user",
        content: prompt,
        // Ollama takes bare base64 and sniffs the type itself, so the mime
        // travelling alongside each buffer is not sent.
        ...(images.length > 0 ? { images: images.map((i) => i.buffer.toString("base64")) } : {}),
      },
    ],
    stream: false,
    // The -thinking variants otherwise spend their budget reasoning about a
    // classification that wants one JSON object back.
    think: false,
    ...(opts.json === false ? {} : { format: "json" }),
    options: { temperature: 0 },
  });

  let response: Response;
  try {
    response = await fetch(`${ollamaHost()}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    // No retry ladder here. Ollama is a local process: it is either running or
    // it is not, and the 429/503 congestion that makes retrying a hosted API
    // worthwhile has no equivalent.
    throw new Error(
      `Could not reach Ollama at ${ollamaHost()}. Is it running? (${(err as Error).message})`,
    );
  }

  const raw = await response.text();
  let parsed: ChatResponse;
  try {
    parsed = JSON.parse(raw) as ChatResponse;
  } catch {
    throw new Error(`Ollama returned non-JSON (HTTP ${response.status}): ${raw.slice(0, 200)}`);
  }
  if (!response.ok || parsed.error) {
    throw new Error(
      `Ollama request failed (HTTP ${response.status}): ${parsed.error ?? raw.slice(0, 200)}`,
    );
  }

  /*
   * A thinking model puts its reply in `thinking` and leaves `content` empty
   * — and `think: false` above does not reliably stop it: qwen3-vl:8b ignores
   * the flag outright. Reading the fallback beats failing on a reply that did
   * arrive, and beats silently returning "" to a JSON parser.
   */
  const text = parsed.message?.content?.trim() || parsed.message?.thinking?.trim() || "";
  if (!text) {
    throw new Error(`Ollama (${model}) returned no text.`);
  }
  return text;
}
