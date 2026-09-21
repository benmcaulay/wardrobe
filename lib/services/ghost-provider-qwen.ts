/**
 * Ghost-mannequin rendering on a local Qwen-Image-2.1, served by ComfyUI.
 *
 * Sibling of `ghost-provider-gemini.ts`: same job, same shape — prompt plus
 * reference images in, one image buffer out — so `ghostMannequin.ts` can pick
 * between them and everything downstream (blank-frame retry, coverage check,
 * post-processing, caching) is unchanged.
 *
 * ComfyUI rather than a Python library because Qwen ships day-zero support for
 * it and it already exposes an HTTP API. The three-step dance below (upload,
 * queue, poll) is that API, not a design choice.
 *
 * LICENSING: Qwen-Image-2.1 is released under the Qwen Research License —
 * non-commercial use only, with commercial use requiring a separate agreement.
 * This provider is off by default and must be selected explicitly. If this app
 * ever earns money, this has to be licensed or switched to one of the
 * Apache-2.0 Qwen-Image releases.
 */
import { log } from "../log";
import { strEnv } from "../env";

/** The autogrow input's id; reference keys are namespaced under it. */
const AUTOGROW_INPUT = "images";

export const DEFAULT_COMFY_HOST = "http://127.0.0.1:8188";

/** Label used for logs, cache keys and the cost ledger. */
export const QWEN_GHOST_MODEL = "qwen-image-2.1-local";

/*
 * Defaults lifted from ComfyUI's own Qwen-Image-2.1 edit template.
 *
 * cfg stays at 1: the official path is cfg-free, and raising it only makes
 * sense alongside a negative prompt. 25 steps is the template's starting
 * point — the reference pipeline uses 40-50, so this trades some fidelity for
 * a render that finishes.
 */
const CFG = 1.0;
const SAMPLER = "euler";
const SCHEDULER = "simple";
const DEFAULT_STEPS = 25;

/*
 * Why there is no img2img path for revisions.
 *
 * `TextEncodeQwenImage21` returns an *empty* latent: the reference reaches the
 * model purely as conditioning. The obvious fix for "change one thing" is to
 * VAEEncode the reference into the latent and sample at denoise < 1 — tried,
 * at 0.62, and the output came back dark, noisy and with the white background
 * destroyed. This pipeline's conditioning expects its own latent, and feeding
 * it an encoded one corrupts the result rather than anchoring it.
 *
 * So a revision is a full re-render that is *told* what to preserve, not a
 * surgical edit. It reliably fixes what you asked for and can still drift on
 * something you did not mention, which is why buildRevisionPrompt lists what
 * must survive and the UI suggests naming anything you care about.
 */

/**
 * Pixel budget the references are resized to, at multiples of 32, aspect
 * preserved. 0 keeps each reference at its own size.
 *
 * A budget rather than a width: small printed type is where this shows up, and
 * a wordmark that is 20px tall in the source has too little to go on.
 */
const DEFAULT_RESOLUTION = 0;

function resolution(): number {
  const raw = Number(strEnv("QWEN_GHOST_RESOLUTION", ""));
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : DEFAULT_RESOLUTION;
}

/** A local render has no rate limit but is minutes, not seconds, on a laptop. */
const DEFAULT_TIMEOUT_MS = 900_000;
const POLL_INTERVAL_MS = 2000;

export type QwenImage = { buffer: Buffer; mime: string };

export function comfyHost(): string {
  return strEnv("COMFYUI_HOST", DEFAULT_COMFY_HOST).replace(/\/+$/, "");
}

function unetName(): string {
  return strEnv("QWEN_GHOST_UNET", "qwen_image_2.1_int8_convrot.safetensors");
}
function clipName(): string {
  return strEnv("QWEN_GHOST_CLIP", "qwen3vl_8b_int8_convrot.safetensors");
}
function vaeName(): string {
  return strEnv("QWEN_GHOST_VAE", "qwen_image_2.1_vae_bf16.safetensors");
}
function steps(): number {
  const raw = Number(strEnv("QWEN_GHOST_STEPS", ""));
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_STEPS;
}

/** Whether ComfyUI is up and has the three Qwen-Image-2.1 files loaded. */
export async function comfyReady(): Promise<boolean> {
  try {
    const res = await fetch(`${comfyHost()}/object_info/UNETLoader`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as Record<string, unknown>;
    const node = body.UNETLoader as
      | { input?: { required?: { unet_name?: [string[]] } } }
      | undefined;
    return (node?.input?.required?.unet_name?.[0] ?? []).includes(unetName());
  } catch {
    return false;
  }
}

async function uploadImage(image: QwenImage, filename: string): Promise<string> {
  const form = new FormData();
  form.append("image", new Blob([new Uint8Array(image.buffer)], { type: image.mime }), filename);
  // Same bytes for the same garment on every retry; overwriting keeps the
  // input folder from growing a copy per attempt.
  form.append("overwrite", "true");

  const res = await fetch(`${comfyHost()}/upload/image`, { method: "POST", body: form });
  if (!res.ok) {
    throw new Error(`ComfyUI rejected an upload (HTTP ${res.status})`);
  }
  const body = (await res.json()) as { name: string; subfolder?: string };
  return body.subfolder ? `${body.subfolder}/${body.name}` : body.name;
}

/**
 * The graph, in ComfyUI's API format.
 *
 * Built from primitives rather than by shipping the stock template: that one
 * wraps the whole pipeline in a subgraph keyed by a UUID, which would be an
 * opaque blob here and would break whenever the template is revised.
 *
 * References go in under DOTTED keys — `images.image_1`, `images.image_2` —
 * and this is the whole ballgame. `/object_info` advertises the input as
 * `images` with a template naming `image_1`…`image_16`, which invites three
 * wrong guesses: a bare `images` list, a list of `{image: link}`, and a plain
 * `image_1` sibling. The first two queue cleanly and are then *silently
 * ignored*, so the render succeeds and quietly invents a garment; the third
 * dies at execution with "unexpected keyword argument".
 *
 * The dot is not decoration. `parse_class_inputs` prefixes an autogrow input
 * with its own id before expanding the template (`finalize_prefix(["images"],
 * "image_1")`), and `build_nested_inputs` later splits that path back into the
 * `{images: {image_1: tensor}}` dict the node signature wants.
 *
 * The first entry is the edit target and the rest are references, matching the
 * `<image1>` markers the prompt uses.
 */
function buildGraph(uploaded: string[], prompt: string, seed: number): unknown {
  const images = Object.fromEntries(
    uploaded.map((_, i) => [`${AUTOGROW_INPUT}.image_${i + 1}`, [String(10 + i), 0]]),
  );
  const loaders = Object.fromEntries(
    uploaded.map((name, i) => [
      String(10 + i),
      { class_type: "LoadImage", inputs: { image: name } },
    ]),
  );

  return {
    ...loaders,
    "1": {
      class_type: "UNETLoader",
      inputs: { unet_name: unetName(), weight_dtype: "default" },
    },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: clipName(), type: "qwen_image" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: vaeName() } },
    "5": {
      class_type: "TextEncodeQwenImage21",
      inputs: {
        clip: ["2", 0],
        prompt,
        negative_prompt: "",
        resolution: resolution(),
        vae: ["3", 0],
        ...images,
      },
    },
    "6": {
      class_type: "KSampler",
      inputs: {
        model: ["1", 0],
        seed,
        steps: steps(),
        cfg: CFG,
        sampler_name: SAMPLER,
        scheduler: SCHEDULER,
        positive: ["5", 0],
        negative: ["5", 1],
        latent_image: ["5", 2],
        denoise: 1.0,
      },
    },
    "7": { class_type: "VAEDecode", inputs: { samples: ["6", 0], vae: ["3", 0] } },
    "8": {
      class_type: "SaveImage",
      inputs: { images: ["7", 0], filename_prefix: "wardrobe_ghost" },
    },
  };
}

/**
 * How printed type must be reproduced.
 *
 * A print is flat artwork applied to cloth, but the reference photo shows it
 * lying over a chest, a fold, a sleeve — so the letters in the *photo* are
 * genuinely curved and rippled, and the model copies that distortion as if it
 * were the design. A Stanford crewneck came back with "STANFORD UNIVERSITY"
 * wobbling along the drape of the body it had been photographed on.
 *
 * The fix is to name the distinction the model is failing to make: the arc of
 * a collegiate wordmark belongs to the artwork and must be kept; the ripple
 * from a fold belongs to the photograph and must not. Text is set type — one
 * typeface, even weight, consistent letter height, a smooth baseline — and
 * that is true of essentially every printed garment.
 *
 * Local-only, and deliberately not in the shared prompt: the hosted renders do
 * not show this fault, and editing `baseApparelPrompt` would mean bumping
 * PROMPT_VERSION and invalidating every cached Gemini render, which costs real
 * money to rebuild. Move it if Gemini ever starts doing the same thing.
 */
const PRINTED_TEXT_RULE = `Printed text and graphics:
- Any text is set type: one consistent typeface, even stroke weight, uniform letter height, evenly spaced.
- Render it on a smooth, regular baseline. Straight text stays straight; an arched wordmark keeps a clean even arc.
- The reference photo shows the print over a body, a fold, or a sleeve. That waviness belongs to the photograph, not to the design — do not reproduce it.
- Keep the artwork's own geometry (its curve, its layout, its proportions) and drop the distortion the drape added.
- Letter edges are crisp and unbroken. No warping, rippling, smearing, doubling, or invented characters.`;

/**
 * Bind the shared ghost prompt to the uploaded references.
 *
 * Qwen-Image-2.1 resolves references through explicit `<image1>` … `<imageN>`
 * markers. The shared prompt says "this garment" and "the reference", which
 * Gemini's edit endpoint binds implicitly — Qwen does not, and without the
 * markers it quietly ignores the photo and renders the *category* instead. The
 * first real test returned immaculate black chinos from a photo of grey
 * sweat shorts, which is the failure this exists to prevent.
 *
 * Prepended rather than substituted into the body: the shared prompt is tuned
 * for the other providers and rewriting its phrases here would make the two
 * drift apart silently.
 */
export function qwenPrompt(prompt: string, refCount: number): string {
  const extras = Array.from({ length: Math.max(0, refCount - 1) }, (_, i) => `<image${i + 2}>`);
  const binding = [
    `<image1> shows the exact garment to reproduce.`,
    extras.length > 0
      ? `${extras.join(", ")} show the same garment from other angles — use them for detail only.`
      : "",
    `Reproduce the garment in <image1> exactly: its cut, colour, pattern, logos and fabric. Do not substitute a different garment.`,
  ]
    .filter(Boolean)
    .join(" ");
  return `${binding}\n\n${prompt}\n\n${PRINTED_TEXT_RULE}`;
}

type HistoryEntry = {
  status?: { status_str?: string; completed?: boolean };
  outputs?: Record<string, { images?: Array<{ filename: string; subfolder: string; type: string }> }>;
};

/**
 * Render one ghost image. Throws with a readable message on any failure.
 *
 * `seed` is passed in rather than randomised here so a retry of the same job
 * can ask for a genuinely different frame, the same way the Gemini path does.
 */
export async function qwenEditImage(
  prompt: string,
  images: QwenImage[],
  opts: {
    seed?: number;
    timeoutMs?: number;
    pollIntervalMs?: number;
  } = {},
): Promise<Buffer> {
  if (images.length === 0) throw new Error("qwenEditImage needs at least one image");
  const host = comfyHost();
  const startedAt = Date.now();
  const deadline = startedAt + (opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const uploaded: string[] = [];
  for (const [i, image] of images.entries()) {
    const ext = image.mime === "image/png" ? "png" : "jpg";
    uploaded.push(await uploadImage(image, `wardrobe-ref-${i + 1}.${ext}`));
  }

  const graph = buildGraph(
    uploaded,
    qwenPrompt(prompt, images.length),
    opts.seed ?? Math.floor(Math.random() * 2 ** 31),
  );
  const queued = await fetch(`${host}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: graph, client_id: "wardrobe" }),
  }).catch((err: Error) => {
    throw new Error(`Could not reach ComfyUI at ${host}. Is it running? (${err.message})`);
  });

  const queuedBody = (await queued.json().catch(() => ({}))) as {
    prompt_id?: string;
    error?: { message?: string };
    node_errors?: Record<string, unknown>;
  };
  if (!queued.ok || !queuedBody.prompt_id) {
    // node_errors names the offending node, which is the only useful part when
    // a model file has been renamed or a node signature has changed.
    throw new Error(
      `ComfyUI refused the job: ${queuedBody.error?.message ?? JSON.stringify(queuedBody.node_errors ?? {}).slice(0, 300)}`,
    );
  }
  const promptId = queuedBody.prompt_id;

  for (;;) {
    if (Date.now() > deadline) {
      throw new Error(
        `Local render did not finish within ${Math.round((deadline - startedAt) / 60000)} minutes.`,
      );
    }
    await new Promise((r) => setTimeout(r, opts.pollIntervalMs ?? POLL_INTERVAL_MS));

    const res = await fetch(`${host}/history/${promptId}`);
    if (!res.ok) continue;
    const history = (await res.json()) as Record<string, HistoryEntry>;
    const entry = history[promptId];
    if (!entry) continue;

    const status = entry.status?.status_str;
    if (status === "error") {
      throw new Error("ComfyUI reported an error running the graph; check its console.");
    }
    const image = Object.values(entry.outputs ?? {}).flatMap((o) => o.images ?? [])[0];
    if (!image) {
      if (entry.status?.completed) {
        throw new Error("ComfyUI finished without producing an image.");
      }
      continue;
    }

    const params = new URLSearchParams({
      filename: image.filename,
      subfolder: image.subfolder,
      type: image.type,
    });
    const file = await fetch(`${host}/view?${params}`);
    if (!file.ok) throw new Error(`Could not download the render (HTTP ${file.status})`);
    const buffer = Buffer.from(await file.arrayBuffer());
    log.info("ghost.qwen.ok", {
      model: QWEN_GHOST_MODEL,
      refs: images.length,
      steps: steps(),
      ms: Date.now() - startedAt,
      bytes: buffer.byteLength,
    });
    return buffer;
  }
}
