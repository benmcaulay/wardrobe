import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { whitenBackground, computeHaloSnapMask } from "../lib/services/whiten-background";

/** Build an RGBA raw buffer from a row of gray values (one pixel high). */
function grayRowRgba(values: number[]): Buffer {
  const buf = Buffer.alloc(values.length * 4);
  values.forEach((v, p) => {
    buf[p * 4] = v;
    buf[p * 4 + 1] = v;
    buf[p * 4 + 2] = v;
    buf[p * 4 + 3] = 255;
  });
  return buf;
}

/** 16x16 image: solid #ededed background with a 6x6 saturated red square in
 *  the centre. Mirrors what fal returns: a near-white catalog backdrop with
 *  the garment in the middle. */
async function nearWhiteCatalog(bgGray = 237): Promise<Buffer> {
  const w = 16,
    h = 16;
  const raw = Buffer.alloc(w * h * 3);
  for (let p = 0; p < w * h; p++) {
    raw[p * 3] = bgGray;
    raw[p * 3 + 1] = bgGray;
    raw[p * 3 + 2] = bgGray;
  }
  for (let y = 5; y < 11; y++) {
    for (let x = 5; x < 11; x++) {
      const p = y * w + x;
      raw[p * 3] = 200;
      raw[p * 3 + 1] = 30;
      raw[p * 3 + 2] = 30;
    }
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } })
    .png()
    .toBuffer();
}

/** Same shape but the garment itself contains a tiny pure-white pocket — the
 *  test the connected-component approach is designed to pass. */
async function catalogWithInteriorWhite(): Promise<Buffer> {
  const w = 16,
    h = 16;
  const raw = Buffer.alloc(w * h * 3);
  for (let p = 0; p < w * h; p++) {
    raw[p * 3] = 237;
    raw[p * 3 + 1] = 237;
    raw[p * 3 + 2] = 237;
  }
  // Garment block (red).
  for (let y = 5; y < 11; y++) {
    for (let x = 5; x < 11; x++) {
      const p = y * w + x;
      raw[p * 3] = 200;
      raw[p * 3 + 1] = 30;
      raw[p * 3 + 2] = 30;
    }
  }
  // White pocket inside the garment, fully surrounded.
  for (let y = 7; y < 9; y++) {
    for (let x = 7; x < 9; x++) {
      const p = y * w + x;
      raw[p * 3] = 255;
      raw[p * 3 + 1] = 255;
      raw[p * 3 + 2] = 255;
    }
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } })
    .png()
    .toBuffer();
}

/** Bright #fc studio with a dimmer #f0f0f0 block fully surrounded — must not be
 *  classified as background (regression: legacy 232 flood would eat it). */
async function brightBgWithDimInteriorIsland(): Promise<Buffer> {
  const w = 24,
    h = 24;
  const raw = Buffer.alloc(w * h * 3);
  for (let p = 0; p < w * h; p++) {
    raw[p * 3] = 252;
    raw[p * 3 + 1] = 252;
    raw[p * 3 + 2] = 252;
  }
  for (let y = 9; y < 15; y++) {
    for (let x = 9; x < 15; x++) {
      const p = y * w + x;
      raw[p * 3] = 240;
      raw[p * 3 + 1] = 240;
      raw[p * 3 + 2] = 240;
    }
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } })
    .png()
    .toBuffer();
}

async function readPixel(
  buf: Buffer,
  x: number,
  y: number,
): Promise<{ r: number; g: number; b: number; a: number }> {
  const { data, info } = await sharp(buf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * 4;
  return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] };
}

describe("whitenBackground", () => {
  it("clamps near-white background pixels to pure #ffffff in the flattened image", async () => {
    const input = await nearWhiteCatalog(237);
    const { flattened } = await whitenBackground(input);
    const corner = await readPixel(flattened, 0, 0);
    expect(corner.r).toBe(255);
    expect(corner.g).toBe(255);
    expect(corner.b).toBe(255);
  });

  it("makes the same background pixels transparent in the cutout", async () => {
    const input = await nearWhiteCatalog(237);
    const { cutout } = await whitenBackground(input);
    const corner = await readPixel(cutout, 0, 0);
    expect(corner.a).toBe(0);
  });

  it("preserves garment pixels untouched in both outputs", async () => {
    const input = await nearWhiteCatalog(237);
    const { flattened, cutout } = await whitenBackground(input);
    const f = await readPixel(flattened, 8, 8);
    expect(f.r).toBeGreaterThan(150);
    expect(f.g).toBeLessThan(80);
    const c = await readPixel(cutout, 8, 8);
    expect(c.a).toBe(255);
    expect(c.r).toBeGreaterThan(150);
  });

  it("does NOT punch holes in interior white regions of the garment", async () => {
    // The pocket at (7,7)-(8,8) is pure white but enclosed by red — the
    // flood fill must not reach it.
    const input = await catalogWithInteriorWhite();
    const { cutout } = await whitenBackground(input);
    const interior = await readPixel(cutout, 7, 7);
    expect(interior.a).toBe(255);
  });

  it("does NOT treat a dim interior island as background when studio is bright", async () => {
    const input = await brightBgWithDimInteriorIsland();
    const { flattened } = await whitenBackground(input);
    const center = await readPixel(flattened, 12, 12);
    expect(center.r).toBe(240);
    expect(center.g).toBe(240);
    expect(center.b).toBe(240);
    const corner = await readPixel(flattened, 0, 0);
    expect(corner.r).toBe(255);
  });
});

describe("computeHaloSnapMask", () => {
  // Row: [bg, near-white fg, shaded fg, near-white fg, bg]
  const data = grayRowRgba([255, 250, 235, 250, 255]);
  const isBg = Uint8Array.from([1, 0, 0, 0, 1]);

  it("snaps near-white foreground pixels that hug the background", () => {
    const snap = computeHaloSnapMask(data, isBg, 5, 1, 244, 2);
    expect(snap[1]).toBe(1);
    expect(snap[3]).toBe(1);
  });

  it("leaves a shaded garment edge below the threshold untouched", () => {
    const snap = computeHaloSnapMask(data, isBg, 5, 1, 244, 2);
    expect(snap[2]).toBe(0); // 235 < 244 → preserved
  });

  it("does not reach interior whites beyond the pass radius", () => {
    // Only p0 is background; p1..p4 are pure white foreground.
    const interior = grayRowRgba([255, 250, 250, 250, 250]);
    const bg = Uint8Array.from([1, 0, 0, 0, 0]);
    const snap = computeHaloSnapMask(interior, bg, 5, 1, 244, 2);
    expect(snap[1]).toBe(1); // touches bg
    expect(snap[2]).toBe(1); // one pass inward
    expect(snap[3]).toBe(0); // 3px from bg, beyond 2 passes
    expect(snap[4]).toBe(0);
  });

  it("is a no-op when passes is 0", () => {
    const snap = computeHaloSnapMask(data, isBg, 5, 1, 244, 0);
    expect(Array.from(snap)).toEqual([0, 0, 0, 0, 0]);
  });
});
