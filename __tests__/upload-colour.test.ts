import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { saveImageBuffer } from "../lib/uploads";
import { getObject } from "../lib/storage";

const P3 = "/System/Library/ColorSync/Profiles/Display P3.icc";
const TEST_USER = "icc-test-user";

async function p3Jpeg(): Promise<Buffer> {
  return sharp({ create: { width: 128, height: 128, channels: 3, background: { r: 200, g: 100, b: 50 } } })
    .withMetadata({ icc: P3 })
    .jpeg({ quality: 100 })
    .toBuffer();
}

afterAll(async () => {
  // saveImageBuffer writes through the real local driver; don't leave litter.
  await fs.rm(path.join(process.cwd(), "uploads", TEST_USER), { recursive: true, force: true });
});

describe("upload colour handling", () => {
  it("keeps the source ICC profile on both the original and the thumbnail", async () => {
    /*
     * An iPhone photo is Display P3. sharp does not convert the pixels —
     * measured: three different embedded profiles over identical values come
     * out byte-identical — it only drops the tag. Untagged P3 pixels are read
     * as sRGB by everything downstream, so the colour the classifier names is
     * not the colour of the garment.
     *
     * The thumbnail matters as much as the original: it is what the closet
     * grid renders, and it goes through a second sharp pipeline that strips
     * metadata independently.
     */
    const saved = await saveImageBuffer(await p3Jpeg(), TEST_USER);
    expect(saved.thumbnailImagePath).toBeTruthy();
    expect(saved.thumbnailImagePath).not.toBe(saved.originalImagePath);

    for (const key of [saved.originalImagePath, saved.thumbnailImagePath]) {
      const stored = await getObject(key);
      expect(stored, `${key} should exist`).toBeTruthy();
      const meta = await sharp(stored!).metadata();
      expect(meta.icc, `${key} must carry a colour profile`).toBeTruthy();
      expect(meta.icc!.length).toBeGreaterThan(100);
    }
  });
});
