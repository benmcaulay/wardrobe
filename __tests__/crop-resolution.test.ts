import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { MAX_EDGE_PX, SOURCE_EDGE_PX, saveImageBuffer, deleteSourceCopy } from "../lib/uploads";
import { cropGarmentRegion } from "../lib/services/garment-crop";
import { sourcePathFor } from "../lib/image-paths";
import { getObject } from "../lib/storage";

const TEST_USER = "crop-res-test-user";

/** A photo bigger than both caps, so both resize steps actually bite. */
async function bigPhoto(): Promise<Buffer> {
  return sharp({ create: { width: 4000, height: 3000, channels: 3, background: { r: 90, g: 120, b: 200 } } })
    .jpeg({ quality: 90 })
    .toBuffer();
}

/** The garment occupies a quarter of the frame's width — the case that was failing. */
const QUARTER = { x_min: 0.25, y_min: 0.25, x_max: 0.5, y_max: 0.5 };

async function widthOf(p: string): Promise<number> {
  const buf = await getObject(p);
  return (await sharp(buf!).metadata()).width ?? 0;
}

afterAll(async () => {
  await fs.rm(path.join(process.cwd(), "uploads", TEST_USER), { recursive: true, force: true });
});

describe("crop resolution", () => {
  it("keeps a near-native source alongside the capped original", async () => {
    const saved = await saveImageBuffer(await bigPhoto(), TEST_USER, { keepSource: true });
    expect(await widthOf(saved.originalImagePath)).toBe(MAX_EDGE_PX);
    expect(await widthOf(sourcePathFor(saved.originalImagePath))).toBeLessThanOrEqual(SOURCE_EDGE_PX);
    // 4000 < SOURCE_EDGE_PX, so withoutEnlargement leaves it untouched.
    expect(await widthOf(sourcePathFor(saved.originalImagePath))).toBe(4000);
  });

  it("writes no source unless asked", async () => {
    const saved = await saveImageBuffer(await bigPhoto(), TEST_USER);
    expect(await getObject(sourcePathFor(saved.originalImagePath))).toBeNull();
  });

  it("cuts the crop from the source, not the downscaled original", async () => {
    const saved = await saveImageBuffer(await bigPhoto(), TEST_USER, { keepSource: true });
    const cropped = await cropGarmentRegion(TEST_USER, saved.originalImagePath, QUARTER);
    expect(cropped).toBeTruthy();
    // A quarter of 4000 is ~1000px (plus 6% padding). Off the 2560 original it
    // would be ~640. This gap is the whole point of the change.
    const w = await widthOf(cropped!);
    expect(w).toBeGreaterThan(900);
  });

  it("still crops once the source has been cleaned up", async () => {
    const saved = await saveImageBuffer(await bigPhoto(), TEST_USER, { keepSource: true });
    await deleteSourceCopy(saved.originalImagePath);
    const cropped = await cropGarmentRegion(TEST_USER, saved.originalImagePath, QUARTER);
    expect(cropped).toBeTruthy();
    // Falls back to the stored original: smaller, but never a failed crop.
    const w = await widthOf(cropped!);
    expect(w).toBeGreaterThan(500);
    expect(w).toBeLessThan(900);
  });
});
