import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { comfyHost, comfyReady, qwenEditImage } from "@/lib/services/ghost-provider-qwen";
import { costTenthCentsForModel } from "@/lib/ai-costs";

const ENV = { ...process.env };
const realFetch = globalThis.fetch;

beforeEach(() => {
  delete process.env.COMFYUI_HOST;
  delete process.env.QWEN_GHOST_STEPS;
  delete process.env.QWEN_GHOST_UNET;
});
afterEach(() => {
  process.env = { ...ENV };
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

const image = () => ({ buffer: Buffer.from("JPEGBYTES"), mime: "image/jpeg" });
/** The real 2s poll would add 18s to the suite; the interval is not under test. */
const FAST = { pollIntervalMs: 1 };

/**
 * Stand in for ComfyUI: accepts an upload, queues, reports done once, serves
 * a PNG. Records every request so the graph can be asserted on.
 */
function stubComfy(opts: { history?: unknown; queue?: unknown; queueStatus?: number } = {}) {
  const seen: { url: string; body?: unknown }[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    const entry: { url: string; body?: unknown } = { url: u };
    if (typeof init?.body === "string") entry.body = JSON.parse(init.body);
    seen.push(entry);

    if (u.includes("/upload/image")) {
      return new Response(JSON.stringify({ name: "wardrobe-ref-1.jpg", subfolder: "" }));
    }
    if (u.includes("/prompt")) {
      return new Response(JSON.stringify(opts.queue ?? { prompt_id: "p1" }), {
        status: opts.queueStatus ?? 200,
      });
    }
    if (u.includes("/history/")) {
      return new Response(
        JSON.stringify(
          opts.history ?? {
            p1: {
              status: { status_str: "success", completed: true },
              outputs: { "8": { images: [{ filename: "g.png", subfolder: "", type: "output" }] } },
            },
          },
        ),
      );
    }
    if (u.includes("/view")) return new Response(new Uint8Array([137, 80, 78, 71]));
    if (u.includes("/object_info")) {
      return new Response(
        JSON.stringify({
          UNETLoader: {
            input: { required: { unet_name: [["qwen_image_2.1_int8_convrot.safetensors"]] } },
          },
        }),
      );
    }
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
  return seen;
}

const graphOf = (seen: { url: string; body?: unknown }[]) =>
  (seen.find((s) => s.url.includes("/prompt"))!.body as { prompt: Record<string, { class_type: string; inputs: Record<string, unknown> }> }).prompt;

describe("comfyHost", () => {
  it("defaults to local and trims a trailing slash", () => {
    expect(comfyHost()).toBe("http://127.0.0.1:8188");
    process.env.COMFYUI_HOST = "http://gpu-box:8188/";
    expect(comfyHost()).toBe("http://gpu-box:8188");
  });
});

describe("the graph it submits", () => {
  it("namespaces references under the dotted autogrow key", async () => {
    // The trap this guards: a bare `images` list and a list of {image: link}
    // both queue with no node_errors and are then silently ignored, so the
    // render succeeds having never seen the photo. Only the dotted key binds.
    const seen = stubComfy();
    await qwenEditImage("make a ghost", [image()], FAST);
    const encode = graphOf(seen)["5"]!;
    expect(encode.class_type).toBe("TextEncodeQwenImage21");
    expect(encode.inputs["images.image_1"]).toEqual(["10", 0]);
    expect(encode.inputs).not.toHaveProperty("images");
    expect(encode.inputs).not.toHaveProperty("image_1");
  });

  it("gives every reference its own loader and its own numbered key", async () => {
    const seen = stubComfy();
    await qwenEditImage("p", [image(), image(), image()], FAST);
    const g = graphOf(seen);
    expect(g["5"]!.inputs["images.image_1"]).toEqual(["10", 0]);
    expect(g["5"]!.inputs["images.image_2"]).toEqual(["11", 0]);
    expect(g["5"]!.inputs["images.image_3"]).toEqual(["12", 0]);
    expect(g["10"]!.class_type).toBe("LoadImage");
    expect(g["12"]!.class_type).toBe("LoadImage");
  });

  it("keeps cfg at 1, the official Qwen-Image-2.1 path", async () => {
    const seen = stubComfy();
    await qwenEditImage("p", [image()], FAST);
    expect(graphOf(seen)["6"]!.inputs.cfg).toBe(1.0);
    expect(graphOf(seen)["6"]!.inputs.sampler_name).toBe("euler");
  });

  it("takes the seed from the caller so a retry differs", async () => {
    const seen = stubComfy();
    await qwenEditImage("p", [image()], { ...FAST, seed: 7 });
    expect(graphOf(seen)["6"]!.inputs.seed).toBe(7);
  });

  it("honours QWEN_GHOST_STEPS, ignoring nonsense", async () => {
    process.env.QWEN_GHOST_STEPS = "40";
    let seen = stubComfy();
    await qwenEditImage("p", [image()], FAST);
    expect(graphOf(seen)["6"]!.inputs.steps).toBe(40);

    process.env.QWEN_GHOST_STEPS = "not-a-number";
    seen = stubComfy();
    await qwenEditImage("p", [image()], FAST);
    expect(graphOf(seen)["6"]!.inputs.steps).toBe(25);
  });
});

describe("failures", () => {
  it("refuses an empty reference list rather than rendering from nothing", async () => {
    stubComfy();
    await expect(qwenEditImage("p", [])).rejects.toThrow(/at least one image/);
  });

  it("explains a ComfyUI that is not running", async () => {
    globalThis.fetch = (async (url: string) => {
      if (String(url).includes("/upload")) return new Response(JSON.stringify({ name: "a.jpg" }));
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    await expect(qwenEditImage("p", [image()], FAST)).rejects.toThrow(/Could not reach ComfyUI/);
  });

  it("surfaces node_errors when the graph is rejected", async () => {
    stubComfy({ queueStatus: 400, queue: { node_errors: { "1": "no such model file" } } });
    await expect(qwenEditImage("p", [image()], FAST)).rejects.toThrow(/no such model file/);
  });

  it("does not hang when the run errored", async () => {
    stubComfy({ history: { p1: { status: { status_str: "error", completed: true } } } });
    await expect(qwenEditImage("p", [image()], FAST)).rejects.toThrow(/reported an error/);
  });

  it("does not hang when it completed with no image", async () => {
    stubComfy({ history: { p1: { status: { status_str: "success", completed: true }, outputs: {} } } });
    await expect(qwenEditImage("p", [image()], FAST)).rejects.toThrow(/without producing an image/);
  });

  it("gives up rather than polling forever", async () => {
    stubComfy({ history: {} });
    await expect(qwenEditImage("p", [image()], { ...FAST, timeoutMs: 1 })).rejects.toThrow(/did not finish/);
  });
});

describe("comfyReady", () => {
  it("is true when the configured model file is loadable", async () => {
    stubComfy();
    await expect(comfyReady()).resolves.toBe(true);
  });

  it("is false when the file is missing, and when nothing answers", async () => {
    process.env.QWEN_GHOST_UNET = "something-else.safetensors";
    stubComfy();
    await expect(comfyReady()).resolves.toBe(false);
    globalThis.fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    await expect(comfyReady()).resolves.toBe(false);
  });
});

describe("cost", () => {
  it("a local render is free, not billed at the unknown-model rate", () => {
    // UNKNOWN_MODEL_COST is 67 tenth-cents, so a missing table entry would
    // silently invoice every local render as if it were a Gemini one.
    expect(costTenthCentsForModel("qwen-image-2.1-local")).toBe(0);
  });
});
