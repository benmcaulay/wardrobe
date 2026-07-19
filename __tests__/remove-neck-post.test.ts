import { describe, it, expect } from "vitest";
import sharp from "sharp";
import {
  computeNeckPostMask,
  hasSuspectedNeckForm,
  removeNeckPost,
} from "../lib/services/remove-neck-post";

async function syntheticHoodieWithNeckPost(): Promise<Buffer> {
  const width = 400;
  const height = 520;
  const rgba = Buffer.alloc(width * height * 4, 0);

  const fillRect = (x0: number, y0: number, x1: number, y1: number, rgb: [number, number, number]) => {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const p = (y * width + x) * 4;
        rgba[p] = rgb[0];
        rgba[p + 1] = rgb[1];
        rgba[p + 2] = rgb[2];
        rgba[p + 3] = 255;
      }
    }
  };

  fillRect(80, 120, 319, 480, [180, 180, 185]);
  fillRect(120, 80, 279, 170, [180, 180, 185]);
  fillRect(188, 95, 211, 210, [255, 255, 255]);

  return sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

async function syntheticHoodieWithMannequinHead(): Promise<Buffer> {
  const width = 400;
  const height = 520;
  const rgba = Buffer.alloc(width * height * 4, 0);

  const fillRect = (x0: number, y0: number, x1: number, y1: number, rgb: [number, number, number]) => {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const p = (y * width + x) * 4;
        rgba[p] = rgb[0];
        rgba[p + 1] = rgb[1];
        rgba[p + 2] = rgb[2];
        rgba[p + 3] = 255;
      }
    }
  };

  fillRect(80, 160, 319, 480, [180, 180, 185]);
  fillRect(120, 120, 279, 210, [180, 180, 185]);
  // Wide mannequin head + neck (typical Seedream failure)
  fillRect(130, 55, 269, 190, [248, 248, 248]);
  fillRect(182, 170, 217, 240, [252, 252, 252]);

  return sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

describe("remove-neck-post", () => {
  it("detects a narrow white neck column in the upper neckline region", async () => {
    const cutout = await syntheticHoodieWithNeckPost();
    const { data, info } = await sharp(cutout).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const mask = computeNeckPostMask(data, info.width, info.height);
    let removed = 0;
    for (let p = 0; p < info.width * info.height; p++) {
      if (mask[p]) removed++;
    }
    expect(removed).toBeGreaterThan(100);
  });

  it("detects a wide mannequin head in the hood opening", async () => {
    const cutout = await syntheticHoodieWithMannequinHead();
    const { data, info } = await sharp(cutout).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(hasSuspectedNeckForm(data, info.width, info.height)).toBe(true);
    const mask = computeNeckPostMask(data, info.width, info.height);
    let removed = 0;
    for (let p = 0; p < info.width * info.height; p++) {
      if (mask[p]) removed++;
    }
    expect(removed).toBeGreaterThan(500);
  });

  it("removes the neck post from flattened and cutout images", async () => {
    const cutout = await syntheticHoodieWithNeckPost();
    const flattened = await sharp({
      create: { width: 400, height: 520, channels: 3, background: "#ffffff" },
    })
      .composite([{ input: cutout }])
      .png()
      .toBuffer();

    const { cutout: outCutout, removedPixels } = await removeNeckPost(flattened, cutout);
    expect(removedPixels).toBeGreaterThan(0);
    const alpha = await sharp(outCutout).ensureAlpha().extractChannel(3).raw().toBuffer();

    const cx = 200;
    const cy = 150;
    const idx = cy * 400 + cx;
    expect(alpha[idx]).toBeLessThan(32);
  });
});
