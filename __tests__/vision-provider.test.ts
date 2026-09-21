import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import {
  visionJson,
  visionModelLabel,
  visionProvider,
  visionText,
  visionTextConfigured,
} from "@/lib/services/vision-text";
import { ollamaReady, ollamaText, DEFAULT_OLLAMA_VISION_MODEL } from "@/lib/services/ollama-text";

const ENV = { ...process.env };
const realFetch = globalThis.fetch;

beforeEach(() => {
  process.env.GEMINI_API_KEY = "test-key";
  delete process.env.VISION_PROVIDER;
  delete process.env.OLLAMA_VISION_MODEL;
  delete process.env.OLLAMA_HOST;
});
afterEach(() => {
  process.env = { ...ENV };
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

/** Capture what was sent, and reply with `body`. */
function captureFetch(body: unknown, status = 200) {
  const seen: { url: string; init: RequestInit | undefined }[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    seen.push({ url: String(url), init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return seen;
}

const ollamaReply = (content: string) => ({ message: { content } });

describe("visionProvider", () => {
  it("defaults to the only provider production can reach", () => {
    expect(visionProvider()).toBe("gemini");
  });

  it("switches on the env var, case and padding forgiven", () => {
    process.env.VISION_PROVIDER = "  Ollama ";
    expect(visionProvider()).toBe("ollama");
  });

  it("falls back to Gemini on a typo instead of taking every AI feature down", () => {
    process.env.VISION_PROVIDER = "olama";
    expect(visionProvider()).toBe("gemini");
  });
});

describe("visionTextConfigured", () => {
  it("needs a key for Gemini", () => {
    process.env.GEMINI_API_KEY = "";
    expect(visionTextConfigured()).toBe(false);
  });

  it("needs no key for Ollama — selecting it is the assertion", () => {
    process.env.GEMINI_API_KEY = "";
    process.env.VISION_PROVIDER = "ollama";
    expect(visionTextConfigured()).toBe(true);
  });
});

describe("visionModelLabel", () => {
  it("names whichever model will actually answer", () => {
    expect(visionModelLabel()).toContain("gemini");
    process.env.VISION_PROVIDER = "ollama";
    expect(visionModelLabel()).toBe(DEFAULT_OLLAMA_VISION_MODEL);
    process.env.OLLAMA_VISION_MODEL = "qwen3-vl:32b";
    expect(visionModelLabel()).toBe("qwen3-vl:32b");
  });
});

describe("routing", () => {
  it("sends a Gemini-shaped request by default", async () => {
    const seen = captureFetch({ candidates: [{ content: { parts: [{ text: "hi" }] } }] });
    await visionText("prompt");
    expect(seen[0]!.url).toContain("generativelanguage.googleapis.com");
  });

  it("sends an Ollama-shaped request when selected", async () => {
    process.env.VISION_PROVIDER = "ollama";
    const seen = captureFetch(ollamaReply("hi"));
    await visionText("prompt");
    expect(seen[0]!.url).toBe("http://127.0.0.1:11434/api/chat");
    const body = JSON.parse(String(seen[0]!.init?.body));
    expect(body.model).toBe(DEFAULT_OLLAMA_VISION_MODEL);
    expect(body.stream).toBe(false);
    expect(body.format).toBe("json");
    // A thinking variant would otherwise burn its budget reasoning about a
    // request that wants one JSON object.
    expect(body.think).toBe(false);
  });

  it("a per-call provider beats the configured one", async () => {
    const seen = captureFetch(ollamaReply("hi"));
    await visionText("prompt", { provider: "ollama" });
    expect(seen[0]!.url).toContain("11434");
  });

  it("honours a custom host without doubling the slash", async () => {
    process.env.VISION_PROVIDER = "ollama";
    process.env.OLLAMA_HOST = "http://gpu-box:11434/";
    const seen = captureFetch(ollamaReply("hi"));
    await visionText("prompt");
    expect(seen[0]!.url).toBe("http://gpu-box:11434/api/chat");
  });
});

describe("ollamaText images", () => {
  it("sends bare base64, with no data-url prefix or mime alongside", async () => {
    const seen = captureFetch(ollamaReply("{}"));
    const buffer = Buffer.from("PNGDATA");
    await ollamaText("describe", { images: [{ buffer, mime: "image/png" }] });
    const body = JSON.parse(String(seen[0]!.init?.body));
    expect(body.messages[0].images).toEqual([buffer.toString("base64")]);
    expect(String(seen[0]!.init?.body)).not.toContain("image/png");
  });

  it("omits the images key entirely for a text-only call", async () => {
    const seen = captureFetch(ollamaReply("{}"));
    await ollamaText("just words");
    const body = JSON.parse(String(seen[0]!.init?.body));
    expect(body.messages[0]).not.toHaveProperty("images");
  });
});

describe("ollamaText failures", () => {
  it("explains a dead daemon rather than leaking a fetch error", async () => {
    globalThis.fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    await expect(ollamaText("x")).rejects.toThrow(/Could not reach Ollama/);
  });

  it("surfaces an error field even on a 200", async () => {
    captureFetch({ error: "model 'qwen3-vl:8b' not found" });
    await expect(ollamaText("x")).rejects.toThrow(/not found/);
  });

  it("treats an empty reply as a failure, not as empty JSON", async () => {
    captureFetch(ollamaReply("   "));
    await expect(ollamaText("x")).rejects.toThrow(/returned no text/);
  });
});

describe("visionJson", () => {
  it("unwraps fenced JSON from a local model", async () => {
    process.env.VISION_PROVIDER = "ollama";
    captureFetch(ollamaReply('```json\n{"category":"top"}\n```'));
    await expect(visionJson("x")).resolves.toEqual({ category: "top" });
  });

  it("names the model that produced unparseable output", async () => {
    process.env.VISION_PROVIDER = "ollama";
    process.env.OLLAMA_VISION_MODEL = "qwen3-vl:4b";
    captureFetch(ollamaReply("sorry, I cannot"));
    await expect(visionJson("x")).rejects.toThrow(/qwen3-vl:4b/);
  });
});

describe("ollamaReady", () => {
  it("is true when the tag list holds the model", async () => {
    captureFetch({ models: [{ name: "qwen3-vl:8b" }, { name: "qwen3:14b" }] });
    await expect(ollamaReady("qwen3-vl:8b")).resolves.toBe(true);
  });

  it("matches an untagged name against the pulled tag", async () => {
    captureFetch({ models: [{ name: "qwen3-vl:8b" }] });
    await expect(ollamaReady("qwen3-vl")).resolves.toBe(true);
  });

  it("is false when the model is not pulled, and when nothing answers", async () => {
    captureFetch({ models: [{ name: "qwen3:14b" }] });
    await expect(ollamaReady("qwen3-vl:8b")).resolves.toBe(false);
    globalThis.fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    await expect(ollamaReady("qwen3-vl:8b")).resolves.toBe(false);
  });
});

describe("thinking models", () => {
  it("reads a reply the model filed under `thinking` instead of `content`", async () => {
    // qwen3-vl:8b (the bare, non-instruct tag) ignores `think: false` and
    // answers here, leaving content empty.
    captureFetch({ message: { content: "", thinking: '{"ok":true}' } });
    await expect(ollamaText("x")).resolves.toBe('{"ok":true}');
  });

  it("still prefers content when both are present", async () => {
    captureFetch({ message: { content: "real", thinking: "musing" } });
    await expect(ollamaText("x")).resolves.toBe("real");
  });

  it("fails when both are blank", async () => {
    captureFetch({ message: { content: "  ", thinking: "" } });
    await expect(ollamaText("x")).rejects.toThrow(/returned no text/);
  });
});
