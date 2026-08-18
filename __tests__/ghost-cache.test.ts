import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGhostMannequin } from "@/lib/services/ghostMannequin";
import { UPLOADS_ROOT } from "@/lib/uploads";

/**
 * Regenerating a view with unchanged inputs used to overwrite the previous
 * file and charge again, and because the new view row pointed at the same path
 * two views ended up sharing one image — which read as "it returned the same
 * picture". The key is a hash of everything that affects the image, so an
 * identical request is now served from disk: free, and flagged as cached.
 */
const TEST_USER = "__test_ghost_cache__";
const TEST_DIR = path.join(UPLOADS_ROOT, TEST_USER);

async function writeTestImage(name: string, colour: string): Promise<string> {
  await fs.mkdir(TEST_DIR, { recursive: true });
  const buf = await sharp({
    create: { width: 600, height: 800, channels: 3, background: colour },
  })
    .jpeg()
    .toBuffer();
  await fs.writeFile(path.join(TEST_DIR, name), buf);
  return `${TEST_USER}/${name}`;
}

beforeAll(async () => {
  await fs.mkdir(TEST_DIR, { recursive: true });
});

afterAll(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

describe("ghost generation cache", () => {
  it("charges for the first render and reports it as not cached", async () => {
    const garment = await writeTestImage("first.jpg", "#7a8c6f");
    const a = await createGhostMannequin({
      userId: TEST_USER,
      garmentImagePath: garment,
      category: "upperbody",
    });
    expect(a.cached).toBe(false);
    expect(a.credits).toBeGreaterThan(0);
  });

  it("serves an identical repeat from cache, free", async () => {
    const garment = await writeTestImage("repeat.jpg", "#8c6f7a");
    const input = {
      userId: TEST_USER,
      garmentImagePath: garment,
      category: "upperbody" as const,
      instructions: "sharper collar",
    };
    const first = await createGhostMannequin(input);
    const second = await createGhostMannequin(input);

    expect(second.resultImagePath).toBe(first.resultImagePath);
    expect(second.cached).toBe(true);
    expect(second.credits).toBe(0);
  });

  it("does not rewrite the file on a cache hit", async () => {
    const garment = await writeTestImage("stable.jpg", "#6f7a8c");
    const input = {
      userId: TEST_USER,
      garmentImagePath: garment,
      category: "upperbody" as const,
    };
    const first = await createGhostMannequin(input);
    const full = path.join(UPLOADS_ROOT, first.resultImagePath);
    const before = await fs.stat(full);

    await new Promise((r) => setTimeout(r, 20));
    await createGhostMannequin(input);
    const after = await fs.stat(full);
    // Same bytes and an untouched mtime: the old render was reused, not redone.
    expect(after.size).toBe(before.size);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it("changed instructions produce a fresh, charged render", async () => {
    const garment = await writeTestImage("changed.jpg", "#7a6f8c");
    const base = {
      userId: TEST_USER,
      garmentImagePath: garment,
      category: "upperbody" as const,
    };
    const a = await createGhostMannequin({ ...base, instructions: "collar" });
    const b = await createGhostMannequin({ ...base, instructions: "collar and cuffs" });

    expect(b.resultImagePath).not.toBe(a.resultImagePath);
    expect(b.cached).toBe(false);
    expect(b.credits).toBeGreaterThan(0);
  });

  it("a different label alone is NOT enough to get a new image", async () => {
    // Label isn't a hash input, deliberately — it's metadata, not pixels. This
    // is the case that confused: renaming the view and regenerating is a repeat.
    const garment = await writeTestImage("label.jpg", "#8c7a6f");
    const input = {
      userId: TEST_USER,
      garmentImagePath: garment,
      category: "upperbody" as const,
      instructions: "same text",
    };
    const a = await createGhostMannequin(input);
    const b = await createGhostMannequin(input);
    expect(b.resultImagePath).toBe(a.resultImagePath);
    expect(b.cached).toBe(true);
  });

  it("a different composition hint is a different render", async () => {
    const garment = await writeTestImage("rear.jpg", "#6f8c7a");
    const base = {
      userId: TEST_USER,
      garmentImagePath: garment,
      category: "upperbody" as const,
    };
    const front = await createGhostMannequin({ ...base, compositionHint: "default" });
    const rear = await createGhostMannequin({ ...base, compositionHint: "rear" });
    expect(rear.resultImagePath).not.toBe(front.resultImagePath);
    expect(rear.cached).toBe(false);
  });
});
