import { describe, expect, it } from "vitest";
import {
  backgroundPurity,
  erodeMask,
  exposureStats,
  flagsFor,
  foregroundMask,
  framingStats,
  penaltyScore,
  scoreCatalogImage,
  wrinkleEnergy,
  type RgbImage,
} from "@/lib/eval/catalog-image";

/** Blank near-white canvas, the background every catalog render should have. */
function canvas(width: number, height: number, fill = 255): RgbImage {
  const data = new Uint8Array(width * height * 3).fill(fill);
  return { data, width, height };
}

function setPixel(img: RgbImage, x: number, y: number, rgb: [number, number, number]) {
  const i = (y * img.width + x) * 3;
  img.data[i] = rgb[0];
  img.data[i + 1] = rgb[1];
  img.data[i + 2] = rgb[2];
}

/** Draw a filled rect, optionally with per-pixel noise to simulate creasing. */
function rect(
  img: RgbImage,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rgb: [number, number, number],
  noise = 0,
) {
  let seed = 1;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const jitter = noise === 0 ? 0 : Math.round((rand() - 0.5) * 2 * noise);
      setPixel(img, x, y, [
        Math.max(0, Math.min(255, rgb[0] + jitter)),
        Math.max(0, Math.min(255, rgb[1] + jitter)),
        Math.max(0, Math.min(255, rgb[2] + jitter)),
      ]);
    }
  }
}

describe("foregroundMask", () => {
  it("separates a garment from a white background and bounds it", () => {
    const img = canvas(40, 40);
    rect(img, 10, 12, 29, 31, [120, 30, 40]);
    const fg = foregroundMask(img);
    expect(fg.bbox).toEqual({ x0: 10, y0: 12, x1: 29, y1: 31 });
    expect(fg.coverage).toBeCloseTo((20 * 20) / (40 * 40), 5);
  });

  it("keeps an interior white garment as foreground, not background", () => {
    // A white tee on white: a pure threshold would erase it. Only near-white
    // pixels *connected to the border* count as background.
    const img = canvas(40, 40);
    rect(img, 10, 10, 29, 29, [255, 255, 255]);
    rect(img, 10, 10, 29, 10, [200, 200, 200]); // thin darker outline
    rect(img, 10, 29, 29, 29, [200, 200, 200]);
    rect(img, 10, 10, 10, 29, [200, 200, 200]);
    rect(img, 29, 10, 29, 29, [200, 200, 200]);
    const fg = foregroundMask(img);
    // The enclosed white interior is retained.
    expect(fg.coverage).toBeCloseTo((20 * 20) / (40 * 40), 5);
    expect(fg.mask[20 * 40 + 20]).toBe(1);
  });

  it("reports no bbox for an entirely white frame", () => {
    const fg = foregroundMask(canvas(16, 16));
    expect(fg.bbox).toBeNull();
    expect(fg.coverage).toBe(0);
  });
});

describe("erodeMask", () => {
  it("shrinks a region by the requested radius", () => {
    const w = 20;
    const h = 20;
    const mask = new Uint8Array(w * h);
    for (let y = 5; y <= 14; y++) for (let x = 5; x <= 14; x++) mask[y * w + x] = 1;
    const eroded = erodeMask(mask, w, h, 2);
    expect(eroded[7 * w + 7]).toBe(1);
    expect(eroded[5 * w + 5]).toBe(0);
    expect(eroded[6 * w + 6]).toBe(0);
  });
});

describe("wrinkleEnergy", () => {
  it("scores a smooth garment near zero", () => {
    const img = canvas(60, 60);
    rect(img, 10, 10, 49, 49, [120, 30, 40]);
    const fg = foregroundMask(img);
    const w = wrinkleEnergy(img, fg.mask);
    expect(w.samples).toBeGreaterThan(0);
    expect(w.mean).toBeLessThan(0.001);
  });

  it("scores a noisy (creased) garment far higher than a smooth one", () => {
    const smooth = canvas(60, 60);
    rect(smooth, 10, 10, 49, 49, [120, 30, 40]);
    const creased = canvas(60, 60);
    rect(creased, 10, 10, 49, 49, [120, 30, 40], 24);

    const smoothScore = wrinkleEnergy(smooth, foregroundMask(smooth).mask).mean;
    const creasedScore = wrinkleEnergy(creased, foregroundMask(creased).mask).mean;
    expect(creasedScore).toBeGreaterThan(smoothScore * 10);
  });

  it("ignores the silhouette edge, which would otherwise dominate", () => {
    // A smooth garment on white has a huge luma step at its outline. With the
    // interior erosion that step must not register as wrinkle energy.
    const img = canvas(60, 60);
    rect(img, 10, 10, 49, 49, [20, 20, 20]);
    const fg = foregroundMask(img);
    expect(wrinkleEnergy(img, fg.mask, { erodeRadius: 3 }).mean).toBeLessThan(0.001);
    // With no erosion the edge leaks in and the score jumps.
    expect(wrinkleEnergy(img, fg.mask, { erodeRadius: 0 }).mean).toBeGreaterThan(0.01);
  });
});

describe("exposureStats", () => {
  it("flags a blown-out garment via clipped pixels and high luma", () => {
    const img = canvas(40, 40);
    rect(img, 8, 8, 31, 31, [254, 254, 254]);
    // Give it a border so the interior isn't flood-filled as background.
    rect(img, 8, 8, 31, 8, [180, 180, 180]);
    rect(img, 8, 31, 31, 31, [180, 180, 180]);
    rect(img, 8, 8, 8, 31, [180, 180, 180]);
    rect(img, 31, 8, 31, 31, [180, 180, 180]);
    const fg = foregroundMask(img);
    const e = exposureStats(img, fg.mask);
    expect(e.clippedRatio).toBeGreaterThan(0.5);
    expect(e.meanLuma).toBeGreaterThan(240);
  });

  it("reports a correctly exposed garment as unclipped with real saturation", () => {
    const img = canvas(40, 40);
    rect(img, 8, 8, 31, 31, [140, 30, 45]);
    const e = exposureStats(img, foregroundMask(img).mask);
    expect(e.clippedRatio).toBe(0);
    expect(e.meanLuma).toBeLessThan(120);
    expect(e.meanSaturation).toBeGreaterThan(50);
  });
});

describe("backgroundPurity", () => {
  it("reports a pure white background as clean", () => {
    const img = canvas(40, 40);
    rect(img, 10, 10, 29, 29, [100, 100, 100]);
    const b = backgroundPurity(img, foregroundMask(img).mask);
    expect(b.meanDeviation).toBe(0);
    expect(b.offWhiteRatio).toBe(0);
  });

  it("catches a cream background cast", () => {
    const img = canvas(40, 40, 255);
    // Warm cast: blue channel pulled down across the whole frame.
    for (let p = 0; p < 40 * 40; p++) img.data[p * 3 + 2] = 238;
    rect(img, 10, 10, 29, 29, [100, 100, 100]);
    const b = backgroundPurity(img, foregroundMask(img).mask);
    expect(b.meanDeviation).toBeGreaterThan(10);
    expect(b.offWhiteRatio).toBeGreaterThan(0.9);
  });

  it("still finds the background when the whole frame is grey, not white", () => {
    // Regression guard: assuming a near-white background meant a strongly cast
    // render reported a *perfect* background, because the fill claimed nothing.
    const img = canvas(40, 40, 200);
    rect(img, 10, 10, 29, 29, [100, 20, 20]);
    const fg = foregroundMask(img);
    const b = backgroundPurity(img, fg.mask);
    expect(b.samples).toBeGreaterThan(0);
    expect(fg.coverage).toBeCloseTo((20 * 20) / (40 * 40), 5);
    expect(b.meanDeviation).toBeCloseTo(55, 0);
    expect(b.offWhiteRatio).toBeGreaterThan(0.9);
    expect(flagsFor(scoreCatalogImage(img))).toContain("dirty-background");
  });
});

describe("framingStats", () => {
  it("measures fill, centring and symmetry of a centred rect", () => {
    const img = canvas(40, 40);
    rect(img, 10, 10, 29, 29, [100, 20, 20]);
    const fg = foregroundMask(img);
    const f = framingStats(fg, 40, 40);
    expect(f.fillRatio).toBeCloseTo(0.25, 5);
    expect(f.centerOffsetX).toBeCloseTo(0, 5);
    expect(f.centerOffsetY).toBeCloseTo(0, 5);
    expect(f.symmetry).toBeCloseTo(1, 5);
  });

  it("detects an off-centre garment", () => {
    const img = canvas(40, 40);
    rect(img, 2, 10, 13, 29, [100, 20, 20]);
    const f = framingStats(foregroundMask(img), 40, 40);
    expect(f.centerOffsetX).toBeLessThan(-0.1);
  });

  it("scores an asymmetric shape below a symmetric one", () => {
    const sym = canvas(40, 40);
    rect(sym, 10, 10, 29, 29, [100, 20, 20]);
    const asym = canvas(40, 40);
    rect(asym, 10, 10, 29, 29, [100, 20, 20]);
    rect(asym, 10, 10, 19, 19, [255, 255, 255]); // punch out one corner
    const symScore = framingStats(foregroundMask(sym), 40, 40).symmetry;
    const asymScore = framingStats(foregroundMask(asym), 40, 40).symmetry;
    expect(asymScore).toBeLessThan(symScore);
  });
});

describe("flagsFor / penaltyScore", () => {
  it("passes a clean smooth render with no flags", () => {
    const img = canvas(60, 60);
    rect(img, 12, 12, 47, 47, [130, 35, 45]);
    const report = scoreCatalogImage(img);
    expect(flagsFor(report)).toEqual([]);
  });

  it("flags a creased render as wrinkly", () => {
    const img = canvas(60, 60);
    rect(img, 12, 12, 47, 47, [130, 35, 45], 30);
    const flags = flagsFor(scoreCatalogImage(img));
    expect(flags).toContain("wrinkly");
  });

  it("flags an all-white frame as an empty frame", () => {
    expect(flagsFor(scoreCatalogImage(canvas(32, 32)))).toContain("empty-frame");
  });

  it("ranks a smooth render below a creased one on total penalty", () => {
    const smooth = canvas(60, 60);
    rect(smooth, 12, 12, 47, 47, [130, 35, 45]);
    const creased = canvas(60, 60);
    rect(creased, 12, 12, 47, 47, [130, 35, 45], 30);
    const a = penaltyScore(scoreCatalogImage(smooth)).total;
    const b = penaltyScore(scoreCatalogImage(creased)).total;
    expect(a).toBeLessThan(b);
  });

  it("does not penalise a light garment for brightness until it passes the gate", () => {
    const img = canvas(60, 60);
    rect(img, 12, 12, 47, 47, [200, 200, 205]);
    const { terms } = penaltyScore(scoreCatalogImage(img));
    expect(terms.brightness).toBe(0);
  });
});
