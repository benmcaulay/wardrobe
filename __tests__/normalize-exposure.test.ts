import { describe, expect, it } from "vitest";
import {
  applyToneCurve,
  buildToneLut,
  EXPOSURE_DEFAULTS,
  gammaForTarget,
  planCorrection,
  saturationBoostFor,
} from "@/lib/services/normalize-exposure";
import { exposureStats, foregroundMask, type RgbImage } from "@/lib/eval/catalog-image";

function canvas(width: number, height: number, fill = 255): RgbImage {
  return { data: new Uint8Array(width * height * 3).fill(fill), width, height };
}

function rect(
  img: RgbImage,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rgb: [number, number, number],
) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * img.width + x) * 3;
      img.data[i] = rgb[0];
      img.data[i + 1] = rgb[1];
      img.data[i + 2] = rgb[2];
    }
  }
}

describe("gammaForTarget", () => {
  it("is a no-op when the image is already at or below target", () => {
    expect(gammaForTarget(150, 190)).toBe(1);
    expect(gammaForTarget(190, 190)).toBe(1);
  });

  it("hits the target exactly when the correction fits under the clamp", () => {
    const g = gammaForTarget(205, 190);
    expect(g).toBeGreaterThan(1);
    expect(g).toBeLessThan(EXPOSURE_DEFAULTS.maxGamma);
    expect(255 * Math.pow(205 / 255, g)).toBeCloseTo(190, 1);
  });

  it("clamps a large correction and therefore under-shoots on purpose", () => {
    // Landing 230 exactly on 190 needs gamma ~2.85, which drags a mid-grey down
    // to near-black. Under-correcting is the safer failure, so the clamp wins
    // and the result stays above target rather than crushing the shadows.
    const g = gammaForTarget(230, 190);
    expect(g).toBe(EXPOSURE_DEFAULTS.maxGamma);
    const landed = 255 * Math.pow(230 / 255, g);
    expect(landed).toBeLessThan(230);
    expect(landed).toBeGreaterThan(190);
    // A mid-grey survives rather than being crushed.
    expect(255 * Math.pow(128 / 255, g)).toBeGreaterThan(45);
  });

  it("clamps to maxGamma so a broken measurement cannot crush the image", () => {
    expect(gammaForTarget(254, 20, 2.2)).toBe(2.2);
  });

  it("refuses degenerate measurements rather than dividing by a zero log", () => {
    expect(gammaForTarget(255, 190)).toBe(1);
    expect(gammaForTarget(0, 190)).toBe(1);
    expect(gammaForTarget(Number.NaN, 190)).toBe(1);
  });
});

describe("saturationBoostFor", () => {
  it("is disabled when no target is set", () => {
    expect(saturationBoostFor(20, 0)).toBe(1);
  });

  it("lifts a washed-out image toward the target", () => {
    // Raise the clamp so the raw ratio is observable.
    expect(saturationBoostFor(20, 40, 3)).toBeCloseTo(2, 5);
    // At the default clamp the same input is capped.
    expect(saturationBoostFor(20, 40)).toBe(EXPOSURE_DEFAULTS.maxSaturationBoost);
  });

  it("clamps to maxBoost", () => {
    expect(saturationBoostFor(5, 100, 1.6)).toBe(1.6);
  });

  it("leaves an already-saturated image alone", () => {
    expect(saturationBoostFor(60, 40)).toBe(1);
  });
});

describe("applyToneCurve", () => {
  it("leaves pure white exactly white — the background must survive", () => {
    // This is the reason for gamma over a linear gain: a multiply would turn
    // the #ffffff background grey and defeat the whole pipeline.
    const data = new Uint8Array([255, 255, 255]);
    applyToneCurve(data, 2.0, 1);
    expect([...data]).toEqual([255, 255, 255]);
  });

  it("leaves pure black black", () => {
    const data = new Uint8Array([0, 0, 0]);
    applyToneCurve(data, 2.0, 1);
    expect([...data]).toEqual([0, 0, 0]);
  });

  it("darkens midtones", () => {
    const data = new Uint8Array([200, 200, 200]);
    applyToneCurve(data, 1.5, 1);
    expect(data[0]!).toBeLessThan(200);
    expect(data[0]!).toBeGreaterThan(120);
  });

  it("is a no-op when both terms are identity", () => {
    const data = new Uint8Array([10, 128, 240]);
    applyToneCurve(data, 1, 1);
    expect([...data]).toEqual([10, 128, 240]);
  });

  it("boosts saturation without shifting hue order", () => {
    const data = new Uint8Array([180, 100, 90]);
    applyToneCurve(data, 1, 1.5);
    // Red stays the dominant channel and the spread widens.
    expect(data[0]!).toBeGreaterThan(data[1]!);
    expect(data[0]! - data[2]!).toBeGreaterThan(180 - 90);
  });

  it("clamps rather than wrapping when saturation overshoots", () => {
    const data = new Uint8Array([250, 10, 10]);
    applyToneCurve(data, 1, 4);
    for (const v of data) expect(v).toBeGreaterThanOrEqual(0);
    for (const v of data) expect(v).toBeLessThanOrEqual(255);
  });
});

describe("buildToneLut / highlight shoulder", () => {
  it("lands the top of the range exactly on the ceiling", () => {
    const lut = buildToneLut(1, 247, 232);
    expect(lut[255]).toBe(247);
    expect(lut[232]).toBe(232);
  });

  it("leaves tones below the shoulder untouched", () => {
    const lut = buildToneLut(1, 247, 232);
    expect(lut[100]).toBe(100);
    expect(lut[231]).toBe(231);
  });

  it("is monotonic so it cannot invert detail", () => {
    const lut = buildToneLut(1.4, 247, 232);
    for (let v = 1; v < 256; v++) expect(lut[v]!).toBeGreaterThanOrEqual(lut[v - 1]!);
  });

  it("pulls clipped values below the clip level, which gamma alone cannot", () => {
    // Gamma fixes 255 in place, so it can never fix a clipped garment pixel.
    expect(buildToneLut(2, null)[255]).toBe(255);
    expect(buildToneLut(1, 247, 232)[255]!).toBeLessThan(252);
  });
});

describe("applyToneCurve masking", () => {
  it("leaves masked-out background pixels byte-identical", () => {
    // Two pixels: index 0 background, index 1 foreground.
    const data = new Uint8Array([255, 255, 255, 254, 254, 254]);
    const mask = new Uint8Array([0, 1]);
    applyToneCurve(data, 1, 1, { mask, highlightCeiling: 247, highlightShoulder: 232 });
    expect([data[0], data[1], data[2]]).toEqual([255, 255, 255]);
    expect(data[3]!).toBeLessThan(252);
  });

  it("would darken white without a mask — the reason the mask is required", () => {
    const data = new Uint8Array([255, 255, 255]);
    applyToneCurve(data, 1, 1, { highlightCeiling: 247, highlightShoulder: 232 });
    expect(data[0]).toBe(247);
  });
});

describe("planCorrection", () => {
  it("passes a correctly exposed garment through untouched", () => {
    const img = canvas(60, 60);
    rect(img, 12, 12, 47, 47, [130, 35, 45]);
    const plan = planCorrection(img);
    expect(plan.applied).toBe(false);
    expect(plan.gamma).toBe(1);
  });

  it("corrects a garment brighter than the trigger", () => {
    const img = canvas(60, 60);
    rect(img, 12, 12, 47, 47, [225, 222, 228]);
    const plan = planCorrection(img);
    expect(plan.measuredMeanLuma).toBeGreaterThan(EXPOSURE_DEFAULTS.triggerMeanLuma);
    expect(plan.applied).toBe(true);
    expect(plan.gamma).toBeGreaterThan(1);
  });

  it("corrects blown highlights even when mean luma is well under the trigger", () => {
    // Regression guard for a real miss: this render averaged 155 luma — far
    // below the 205 brightness trigger — yet 2.7% of the garment was clipped.
    // Gating the whole correction on mean luma skipped it entirely.
    const img = canvas(80, 80);
    rect(img, 16, 16, 63, 63, [60, 55, 65]);
    rect(img, 24, 24, 40, 40, [255, 255, 255]); // blown patch inside the garment
    const plan = planCorrection(img);
    expect(plan.measuredMeanLuma).toBeLessThan(EXPOSURE_DEFAULTS.triggerMeanLuma);
    expect(plan.measuredClippedRatio).toBeGreaterThan(EXPOSURE_DEFAULTS.triggerClippedRatio);
    expect(plan.gamma).toBe(1);
    expect(plan.highlightCeiling).toBe(EXPOSURE_DEFAULTS.highlightCeiling);
    expect(plan.applied).toBe(true);
  });

  it("leaves highlights alone when nothing is clipped", () => {
    const img = canvas(80, 80);
    rect(img, 16, 16, 63, 63, [120, 40, 50]);
    expect(planCorrection(img).highlightCeiling).toBeNull();
  });

  it("declines to correct when there is no garment to measure", () => {
    // An all-white frame yields no foreground; correcting off that measurement
    // would be worse than leaving the image alone.
    const plan = planCorrection(canvas(32, 32));
    expect(plan.applied).toBe(false);
  });

  it("brings a mildly over-bright garment onto target end to end", () => {
    const img = canvas(80, 80);
    rect(img, 16, 16, 63, 63, [208, 206, 212]);
    const plan = planCorrection(img);
    expect(plan.applied).toBe(true);

    applyToneCurve(img.data, plan.gamma, plan.saturationBoost);
    const after = exposureStats(img, foregroundMask(img).mask);
    expect(after.meanLuma).toBeLessThan(plan.measuredMeanLuma);
    expect(after.meanLuma).toBeCloseTo(EXPOSURE_DEFAULTS.targetMeanLuma, 0);
  });

  it("moves a severely blown garment down even when the clamp bites", () => {
    const img = canvas(80, 80);
    rect(img, 16, 16, 63, 63, [232, 230, 234]);
    const plan = planCorrection(img);
    expect(plan.gamma).toBe(EXPOSURE_DEFAULTS.maxGamma);

    applyToneCurve(img.data, plan.gamma, plan.saturationBoost);
    const after = exposureStats(img, foregroundMask(img).mask);
    // Meaningful improvement, without a promise of hitting target exactly.
    expect(after.meanLuma).toBeLessThan(plan.measuredMeanLuma - 20);
  });

  it("keeps the background pure white after a real correction", () => {
    const img = canvas(80, 80);
    rect(img, 16, 16, 63, 63, [230, 228, 232]);
    const plan = planCorrection(img);
    applyToneCurve(img.data, plan.gamma, plan.saturationBoost);
    // Sample a corner: still exactly white.
    expect([img.data[0], img.data[1], img.data[2]]).toEqual([255, 255, 255]);
  });
});
