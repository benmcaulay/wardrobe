import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const FASHN_API_BASE = "https://api.fashn.ai";

export type FashnRunResponse = { id: string; error?: string | null };
export type FashnStatusResponse = {
  id: string;
  status: "starting" | "in_queue" | "processing" | "completed" | "failed";
  output?: string[];
  error?: { name?: string; message?: string } | null;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function fileToDataUri(absolutePath: string): Promise<string> {
  const buf = await fs.readFile(absolutePath);
  const ext = path.extname(absolutePath).toLowerCase();
  const mime =
    ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

/** Re-encode as JPEG data URI for chaining (consistent MIME for follow-up try-ons). */
export async function bufferToJpegDataUri(buf: Buffer): Promise<string> {
  const jpeg = await sharp(buf).rotate().jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}

/**
 * Re-encode as a PNG data URI for chaining between multi-garment steps. Used
 * instead of {@link bufferToJpegDataUri} so each garment we add to an outfit
 * doesn't re-JPEG the previous step's result — generational JPEG loss is
 * visible (mushy textures, ringing on prints) by the third garment.
 */
export async function bufferToPngDataUri(buf: Buffer): Promise<string> {
  const png = await sharp(buf).rotate().png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

export async function fashnRunTryOn(
  apiKey: string,
  modelName: string,
  inputs: Record<string, unknown>,
): Promise<string> {
  const runRes = await fetch(`${FASHN_API_BASE}/v1/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model_name: modelName, inputs }),
  });

  const runBody = (await runRes.json().catch(() => ({}))) as FashnRunResponse & {
    message?: string;
    error?: string;
  };

  if (!runRes.ok) {
    const msg =
      typeof runBody.message === "string"
        ? runBody.message
        : typeof runBody.error === "string"
          ? runBody.error
          : `FASHN /v1/run HTTP ${runRes.status}`;
    throw new Error(msg);
  }
  if (runBody.error) {
    throw new Error(String(runBody.error));
  }
  if (!runBody.id) {
    throw new Error("FASHN /v1/run returned no prediction id");
  }

  const deadline = Date.now() + 180_000;
  const pollMs = 1500;

  while (Date.now() < deadline) {
    const statusRes = await fetch(`${FASHN_API_BASE}/v1/status/${encodeURIComponent(runBody.id)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const status = (await statusRes.json().catch(() => ({}))) as FashnStatusResponse;

    if (status.status === "completed") {
      const url = status.output?.[0];
      if (!url) throw new Error("FASHN completed but returned no output URL");
      return url;
    }
    if (status.status === "failed") {
      const msg = status.error?.message ?? status.error?.name ?? "FASHN prediction failed";
      throw new Error(msg);
    }
    await sleep(pollMs);
  }

  throw new Error("FASHN virtual try-on timed out waiting for result");
}
