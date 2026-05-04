import { describe, it, expect, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { createVirtualTryOn } from "../lib/services/virtualTryOn";
import { UPLOADS_ROOT } from "../lib/uploads";

const TEST_USER = "__test_vton__";
const TEST_DIR = path.join(UPLOADS_ROOT, TEST_USER);

async function cleanup() {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
}
afterAll(cleanup);

async function writeImage(name: string, color: string, width = 800, height = 1067): Promise<string> {
  await fs.mkdir(TEST_DIR, { recursive: true });
  const abs = path.join(TEST_DIR, name);
  await sharp({ create: { width, height, channels: 3, background: color } })
    .jpeg({ quality: 80 })
    .toFile(abs);
  return path.posix.join(TEST_USER, name);
}

describe("createVirtualTryOn (stub)", () => {
  it("composes a 1024x1366 JPEG and 400px thumbnail", async () => {
    const person = await writeImage("person.jpg", "#c9b9a4");
    const garment = await writeImage("garment.jpg", "#7a8c6f", 600, 600);
    const result = await createVirtualTryOn({
      userId: TEST_USER,
      personImagePath: person,
      garmentImagePaths: [garment],
    });
    expect(result.resultImagePath.startsWith(`${TEST_USER}/tryon-`)).toBe(true);
    expect(result.credits).toBe(1);
    const meta = await sharp(path.join(UPLOADS_ROOT, result.resultImagePath)).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(1024);
    expect(meta.height).toBe(1366);
    const thumbRel = result.resultImagePath.replace(/\.jpg$/, "-thumb.jpg");
    const thumbMeta = await sharp(path.join(UPLOADS_ROOT, thumbRel)).metadata();
    expect(thumbMeta.width).toBeLessThanOrEqual(400);
    expect(thumbMeta.height).toBeLessThanOrEqual(400);
  });

  it("is deterministic for the same inputs", async () => {
    const person = await writeImage("person.jpg", "#c9b9a4");
    const garment = await writeImage("garment.jpg", "#7a8c6f", 600, 600);
    const a = await createVirtualTryOn({
      userId: TEST_USER,
      personImagePath: person,
      garmentImagePaths: [garment],
      prompt: "evening",
    });
    const b = await createVirtualTryOn({
      userId: TEST_USER,
      personImagePath: person,
      garmentImagePaths: [garment],
      prompt: "evening",
    });
    expect(a.resultImagePath).toBe(b.resultImagePath);
  });

  it("changes filename when the prompt changes", async () => {
    const person = await writeImage("person.jpg", "#c9b9a4");
    const garment = await writeImage("garment.jpg", "#7a8c6f", 600, 600);
    const a = await createVirtualTryOn({
      userId: TEST_USER,
      personImagePath: person,
      garmentImagePaths: [garment],
      prompt: "evening",
    });
    const b = await createVirtualTryOn({
      userId: TEST_USER,
      personImagePath: person,
      garmentImagePaths: [garment],
      prompt: "morning",
    });
    expect(a.resultImagePath).not.toBe(b.resultImagePath);
  });

  it("rejects empty garment list", async () => {
    const person = await writeImage("person.jpg", "#c9b9a4");
    await expect(
      createVirtualTryOn({
        userId: TEST_USER,
        personImagePath: person,
        garmentImagePaths: [],
      }),
    ).rejects.toThrow();
  });

  it("rejects traversal-unsafe person path", async () => {
    await expect(
      createVirtualTryOn({
        userId: TEST_USER,
        personImagePath: "../etc/passwd",
        garmentImagePaths: ["x/y.jpg"],
      }),
    ).rejects.toThrow();
  });
});
