import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { softenCatalogShadows } from "../lib/services/flatten-catalog-lighting";

describe("softenCatalogShadows", () => {
  it("lifts mid-tone fabric shadows on foreground pixels", async () => {
    const flattened = await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 40, height: 40, channels: 3, background: { r: 40, g: 40, b: 40 } },
          })
            .png()
            .toBuffer(),
          left: 30,
          top: 30,
        },
      ])
      .jpeg()
      .toBuffer();

    const cutout = await sharp({
      create: { width: 100, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([
        {
          input: await sharp({
            create: {
              width: 40,
              height: 40,
              channels: 4,
              background: { r: 255, g: 255, b: 255, alpha: 255 },
            },
          })
            .png()
            .toBuffer(),
          left: 30,
          top: 30,
        },
      ])
      .png()
      .toBuffer();

    const out = await softenCatalogShadows(flattened, cutout);
    const center = await sharp(out)
      .extract({ left: 45, top: 45, width: 10, height: 10 })
      .raw()
      .toBuffer();
    const avg = center.reduce((s, v) => s + v, 0) / center.length;
    expect(avg).toBeGreaterThan(40);
  });
});
