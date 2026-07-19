import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { centerCatalogImage } from "../lib/services/center-catalog-image";

describe("centerCatalogImage", () => {
  it("centers a cutout on a white canvas", async () => {
    const cutout = await sharp({
      create: { width: 200, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 80, height: 120, channels: 3, background: "#336699" },
          })
            .png()
            .toBuffer(),
          left: 30,
          top: 40,
        },
      ])
      .png()
      .toBuffer();

    const { flattened } = await centerCatalogImage(cutout, { width: 400, height: 500 });
    const meta = await sharp(flattened).metadata();
    expect(meta.width).toBe(400);
    expect(meta.height).toBe(500);

    const { data } = await sharp(flattened).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBe(255);
    expect(data[1]).toBe(255);
    expect(data[2]).toBe(255);
  });
});
