import { describe, expect, it, afterEach } from "vitest";
import sharp from "sharp";
import { cornerSeeds, fillToWhite, fillToWhiteFromSeeds } from "@/lib/bucket-whiten";
import {
  autoWhitenTolerance,
  autoWhitenUpload,
  autoWhitenEnabled,
  DEFAULT_AUTO_WHITEN_TOLERANCE,
  MAX_TOLERANCE,
} from "@/lib/services/auto-whiten-upload";

const ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ENV };
});

/** RGBA buffer: `bg` everywhere, with a `fg` square in the middle. */
function scene(
  width: number,
  height: number,
  bg: [number, number, number],
  fg: [number, number, number],
  box = { x0: 20, y0: 20, x1: 60, y1: 60 },
): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const inBox = x >= box.x0 && x < box.x1 && y >= box.y0 && y < box.y1;
      const [r, g, b] = inBox ? fg : bg;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return data;
}

const px = (data: Uint8Array, w: number, x: number, y: number) => {
  const i = (y * w + x) * 4;
  return [data[i], data[i + 1], data[i + 2]] as [number, number, number];
};

describe("cornerSeeds", () => {
  it("insets by a pixel, where JPEG ringing is worst", () => {
    expect(cornerSeeds(100, 80)).toEqual([
      { x: 1, y: 1 },
      { x: 98, y: 1 },
      { x: 1, y: 78 },
      { x: 98, y: 78 },
    ]);
  });

  it("degrades safely on a 1px image", () => {
    for (const seed of cornerSeeds(1, 1)) {
      expect(seed.x).toBe(0);
      expect(seed.y).toBe(0);
    }
  });
});

describe("fillToWhite", () => {
  it("clears a uniform backdrop and leaves the subject alone", () => {
    const w = 80, h = 80;
    const data = scene(w, h, [250, 250, 250], [20, 40, 90]);
    const painted = fillToWhite(data, w, h, { x: 1, y: 1 }, 1, true);

    expect(painted).toBeGreaterThan(0);
    expect(px(data, w, 1, 1)).toEqual([255, 255, 255]);
    expect(px(data, w, 40, 40)).toEqual([20, 40, 90]); // subject untouched
  });

  it("reports zero when the backdrop is already pure white", () => {
    const w = 40, h = 40;
    const data = scene(w, h, [255, 255, 255], [10, 10, 10]);
    expect(fillToWhite(data, w, h, { x: 1, y: 1 }, 1, true)).toBe(0);
  });

  /**
   * The reason the automatic pass stays contiguous: a pale garment on a pale
   * backdrop is only protected by connectivity. Non-contiguous whitens it too.
   */
  it("contiguous protects an enclosed pale subject; non-contiguous does not", () => {
    const w = 60, h = 60;
    // Subject is the same value as the backdrop, ringed by a dark border.
    const build = () => {
      const d = scene(w, h, [250, 250, 250], [10, 10, 10], { x0: 15, y0: 15, x1: 45, y1: 45 });
      for (let y = 20; y < 40; y++) {
        for (let x = 20; x < 40; x++) {
          const i = (y * w + x) * 4;
          d[i] = 250; d[i + 1] = 250; d[i + 2] = 250; d[i + 3] = 255;
        }
      }
      return d;
    };

    const contiguous = build();
    fillToWhite(contiguous, w, h, { x: 1, y: 1 }, 1, true);
    expect(px(contiguous, w, 30, 30)).toEqual([250, 250, 250]); // pale garment survives

    const flood = build();
    fillToWhite(flood, w, h, { x: 1, y: 1 }, 1, false);
    expect(px(flood, w, 30, 30)).toEqual([255, 255, 255]); // and here it is eaten
  });

  it("a tolerance of 1 does not reach a backdrop that varies by more than 1", () => {
    const w = 40, h = 40;
    const data = new Uint8Array(w * h * 4);
    // Backdrop alternates 244/250 — a stand-in for JPEG ringing.
    for (let i = 0; i < w * h; i++) {
      const v = i % 2 === 0 ? 244 : 250;
      data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255;
    }
    const tight = fillToWhite(data.slice(), w, h, { x: 1, y: 1 }, 1, true);
    const loose = fillToWhite(data.slice(), w, h, { x: 1, y: 1 }, 36, true);
    expect(loose).toBeGreaterThan(tight * 10);
  });

  it("is a no-op on an empty frame rather than throwing", () => {
    expect(fillToWhite(new Uint8Array(0), 0, 0, { x: 0, y: 0 }, 1, true)).toBe(0);
  });

  it("clamps an out-of-bounds seed instead of reading past the buffer", () => {
    const w = 20, h = 20;
    const data = scene(w, h, [250, 250, 250], [0, 0, 0], { x0: 5, y0: 5, x1: 8, y1: 8 });
    expect(() => fillToWhite(data, w, h, { x: 999, y: -5 }, 1, true)).not.toThrow();
  });
});

describe("fillToWhiteFromSeeds", () => {
  it("clears two disconnected backdrop regions one seed could not reach", () => {
    const w = 60, h = 20;
    // A dark wall down the middle splits the backdrop in two.
    const data = scene(w, h, [250, 250, 250], [5, 5, 5], { x0: 29, y0: 0, x1: 31, y1: h });

    const oneSeed = data.slice();
    fillToWhite(oneSeed, w, h, { x: 1, y: 1 }, 1, true);
    expect(px(oneSeed, w, 58, 10)).toEqual([250, 250, 250]); // far side missed

    const allCorners = data.slice();
    fillToWhiteFromSeeds(allCorners, w, h, cornerSeeds(w, h), 1, true);
    expect(px(allCorners, w, 58, 10)).toEqual([255, 255, 255]); // reached
  });
});

describe("autoWhitenUpload", () => {
  async function jpeg(bg: [number, number, number], fg: [number, number, number]) {
    const w = 120, h = 120;
    const raw = scene(w, h, bg, fg, { x0: 40, y0: 40, x1: 80, y1: 80 });
    return sharp(Buffer.from(raw), { raw: { width: w, height: h, channels: 4 } })
      .jpeg({ quality: 100 })
      .toBuffer();
  }

  it("whitens a flat backdrop and keeps the subject", async () => {
    const input = await jpeg([252, 252, 252], [30, 60, 120]);
    const out = await autoWhitenUpload(input, { tolerance: 8 });
    expect(out.changed).toBe(true);
    expect(out.whitenPixelFraction).toBeGreaterThan(0.3);

    const { data, info } = await sharp(out.buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const corner = px(data as unknown as Uint8Array, info.width, 2, 2);
    expect(corner.every((c) => c >= 250)).toBe(true);
    const middle = px(data as unknown as Uint8Array, info.width, 60, 60);
    expect(middle[2]).toBeGreaterThan(middle[0]); // still blue-ish, not white
  });

  it("returns the original bytes untouched when nothing is painted", async () => {
    const input = await jpeg([255, 255, 255], [0, 0, 0]);
    const out = await autoWhitenUpload(input, { tolerance: 1 });
    expect(out.changed).toBe(false);
    expect(out.buffer).toBe(input);
    expect(out.whitenPixelFraction).toBe(0);
  });

  it("survives bytes that are not an image", async () => {
    const out = await autoWhitenUpload(Buffer.from("not an image"), { tolerance: 1 });
    expect(out.changed).toBe(false);
    expect(out.buffer.toString()).toBe("not an image");
  });
});

describe("configuration", () => {
  it("defaults to tolerance 1, as requested", () => {
    delete process.env.AUTO_WHITEN_TOLERANCE;
    expect(autoWhitenTolerance()).toBe(1);
    expect(DEFAULT_AUTO_WHITEN_TOLERANCE).toBe(1);
  });

  it("treats an empty env var as unset rather than as zero", () => {
    process.env.AUTO_WHITEN_TOLERANCE = "";
    expect(autoWhitenTolerance()).toBe(1);
  });

  it("can be raised, and is capped at the manual slider's maximum", () => {
    process.env.AUTO_WHITEN_TOLERANCE = "36";
    expect(autoWhitenTolerance()).toBe(36);
    process.env.AUTO_WHITEN_TOLERANCE = "9999";
    expect(autoWhitenTolerance()).toBe(MAX_TOLERANCE);
  });

  it("is on by default and can be switched off explicitly", () => {
    delete process.env.AUTO_WHITEN_ON_SAVE;
    expect(autoWhitenEnabled()).toBe(true);
    process.env.AUTO_WHITEN_ON_SAVE = "false";
    expect(autoWhitenEnabled()).toBe(false);
  });
});
