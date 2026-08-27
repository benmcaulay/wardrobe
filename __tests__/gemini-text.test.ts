import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { geminiJson, geminiText, geminiTextConfigured, parseJsonLoose } from "@/lib/services/gemini-text";

const ENV = { ...process.env };
const realFetch = globalThis.fetch;

beforeEach(() => {
  process.env.GEMINI_API_KEY = "test-key";
});
afterEach(() => {
  process.env = { ...ENV };
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function textResponse(text: string, status = 200) {
  return new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }),
    { status },
  );
}

function errorResponse(status: number, message = "boom") {
  return new Response(JSON.stringify({ error: { message } }), { status });
}

/** Stub fetch with a queue of responses; returns the call counter. */
function stubFetch(responses: Array<() => Response>) {
  const state = { calls: 0 };
  globalThis.fetch = (async () => {
    const make = responses[Math.min(state.calls, responses.length - 1)]!;
    state.calls += 1;
    return make();
  }) as typeof fetch;
  return state;
}

describe("geminiTextConfigured", () => {
  it("is false for an empty key, not just a missing one", () => {
    process.env.GEMINI_API_KEY = "";
    expect(geminiTextConfigured()).toBe(false);
    process.env.GEMINI_API_KEY = "k";
    expect(geminiTextConfigured()).toBe(true);
  });
});

describe("transient failure retry", () => {
  /**
   * Regression: the flash models return 503 "experiencing high demand" under
   * load. Observed in the dev log three times in a row on product search, where
   * every caller degrades to an empty result — so a spike looked like "found
   * nothing" instead of "try again".
   */
  it("retries a 503 and succeeds on the next attempt", async () => {
    const state = stubFetch([() => errorResponse(503, "high demand"), () => textResponse('{"ok":true}')]);
    await expect(geminiText("hi")).resolves.toContain('"ok"');
    expect(state.calls).toBe(2);
  });

  it("gives up after three attempts on a persistent 503", async () => {
    const state = stubFetch([() => errorResponse(503)]);
    await expect(geminiText("hi")).rejects.toThrow(/HTTP 503/);
    expect(state.calls).toBe(3);
  });

  it("retries 429 and the 5xx family", async () => {
    for (const status of [429, 500, 502, 504]) {
      const state = stubFetch([() => errorResponse(status), () => textResponse("{}")]);
      await geminiText("hi");
      expect(state.calls, `status ${status} should retry`).toBe(2);
    }
  });

  it("does not retry a client error — waiting will not fix a bad request", async () => {
    const state = stubFetch([() => errorResponse(400, "bad model")]);
    await expect(geminiText("hi")).rejects.toThrow(/HTTP 400/);
    expect(state.calls).toBe(1);
  });

  it("does not retry a safety block", async () => {
    const state = stubFetch([
      () => new Response(JSON.stringify({ promptFeedback: { blockReason: "SAFETY" } }), { status: 200 }),
    ]);
    await expect(geminiText("hi")).rejects.toThrow(/blocked/i);
    expect(state.calls).toBe(1);
  });
});

describe("failure messages", () => {
  it("names a missing key rather than failing at the transport", async () => {
    process.env.GEMINI_API_KEY = "";
    await expect(geminiText("hi")).rejects.toThrow(/GEMINI_API_KEY is not set/);
  });

  it("reports an empty completion with its finish reason", async () => {
    stubFetch([
      () => new Response(JSON.stringify({ candidates: [{ finishReason: "MAX_TOKENS" }] }), { status: 200 }),
    ]);
    await expect(geminiText("hi")).rejects.toThrow(/MAX_TOKENS/);
  });
});

describe("parseJsonLoose", () => {
  it("parses plain JSON", () => {
    expect(parseJsonLoose('{"a":1}')).toEqual({ a: 1 });
  });

  it("strips the code fences models add even in JSON mode", () => {
    expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonLoose('```\n[1,2]\n```')).toEqual([1, 2]);
  });

  it("recovers JSON wrapped in prose", () => {
    expect(parseJsonLoose('Sure! Here you go: {"a":1} Hope that helps.')).toEqual({ a: 1 });
  });

  it("returns null rather than throwing on unparseable text", () => {
    expect(parseJsonLoose("no json here")).toBeNull();
    expect(parseJsonLoose("")).toBeNull();
  });
});

describe("geminiJson", () => {
  it("throws when the reply is not JSON, so callers can fall back", async () => {
    stubFetch([() => textResponse("I'm afraid I can't do that")]);
    await expect(geminiJson("hi")).rejects.toThrow(/not parseable JSON/);
  });

  it("returns the parsed object", async () => {
    stubFetch([() => textResponse('{"activities":["beach"]}')]);
    await expect(geminiJson("hi")).resolves.toEqual({ activities: ["beach"] });
  });
});
