import { describe, expect, it } from "vitest";
import {
  cutOutBackdrop,
  detectBorderBackground,
  isRemovableBackdrop,
  knockOutBackdrop,
} from "@/lib/image-cutout";

/** Build an RGBA buffer from a paint function, so tests read as pictures. */
function image(
  width: number,
  height: number,
  paint: (x: number, y: number) => [number, number, number],
): Uint8ClampedArray {
  const px = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const [r, g, b] = paint(x, y);
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
      px[i + 3] = 255;
    }
  }
  return px;
}

const alphaAt = (px: Uint8ClampedArray, width: number, x: number, y: number) =>
  px[(y * width + x) * 4 + 3];

/** A centred square of `subject` on a field of `bg`. */
const onBackdrop = (
  size: number,
  bg: [number, number, number],
  subject: [number, number, number],
  inset = 3,
) =>
  image(size, size, (x, y) =>
    x >= inset && x < size - inset && y >= inset && y < size - inset ? subject : bg,
  );

describe("detectBorderBackground", () => {
  it("reads a flat white border", () => {
    const px = onBackdrop(12, [255, 255, 255], [10, 20, 30]);
    const found = detectBorderBackground(px, 12, 12)!;
    expect(found.color).toEqual({ r: 255, g: 255, b: 255 });
    expect(found.spread).toBe(0);
  });

  it("reads a flat black border", () => {
    const px = onBackdrop(12, [0, 0, 0], [200, 200, 200]);
    const found = detectBorderBackground(px, 12, 12)!;
    expect(found.color).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("reports a high spread for a busy border", () => {
    const px = image(12, 12, (x, y) => (((x + y) % 2 === 0 ? [250, 250, 250] : [20, 20, 20])));
    expect(detectBorderBackground(px, 12, 12)!.spread).toBeGreaterThan(34);
  });

  it("returns null for a degenerate image", () => {
    expect(detectBorderBackground(new Uint8ClampedArray(4), 1, 1)).toBeNull();
    expect(detectBorderBackground(new Uint8ClampedArray(0), 0, 0)).toBeNull();
  });
});

describe("isRemovableBackdrop", () => {
  it("accepts near-white and near-black", () => {
    expect(isRemovableBackdrop({ r: 255, g: 255, b: 255 })).toBe(true);
    expect(isRemovableBackdrop({ r: 240, g: 238, b: 236 })).toBe(true);
    expect(isRemovableBackdrop({ r: 0, g: 0, b: 0 })).toBe(true);
    expect(isRemovableBackdrop({ r: 18, g: 12, b: 20 })).toBe(true);
  });

  it("refuses anything else, so a real scene is left alone", () => {
    expect(isRemovableBackdrop({ r: 128, g: 128, b: 128 })).toBe(false);
    expect(isRemovableBackdrop({ r: 200, g: 120, b: 60 })).toBe(false);
    expect(isRemovableBackdrop({ r: 250, g: 250, b: 100 })).toBe(false);
  });
});

describe("knockOutBackdrop", () => {
  it("clears the field and keeps the subject", () => {
    const size = 12;
    const px = onBackdrop(size, [255, 255, 255], [40, 60, 90]);
    const cleared = knockOutBackdrop(px, size, size, { r: 255, g: 255, b: 255 });
    expect(cleared).toBeGreaterThan(0);
    expect(alphaAt(px, size, 0, 0)).toBe(0);
    expect(alphaAt(px, size, 6, 6)).toBe(255);
  });

  it("clears a black field too", () => {
    const size = 12;
    const px = onBackdrop(size, [0, 0, 0], [220, 220, 220]);
    knockOutBackdrop(px, size, size, { r: 0, g: 0, b: 0 });
    expect(alphaAt(px, size, 0, 0)).toBe(0);
    expect(alphaAt(px, size, 6, 6)).toBe(255);
  });

  /**
   * The whole reason for the flood fill. A global threshold would delete the
   * shirt along with the backdrop, which is exactly what the previous
   * implementation did.
   */
  it("keeps a white shirt on a white backdrop", () => {
    const size = 12;
    // A real white garment still shades: 230 against a 255 field.
    const px = onBackdrop(size, [255, 255, 255], [230, 230, 230]);
    knockOutBackdrop(px, size, size, { r: 255, g: 255, b: 255 });
    expect(alphaAt(px, size, 0, 0)).toBe(0);
    expect(alphaAt(px, size, 6, 6)).toBe(255);
  });

  /** The same hazard, and the more common one: black clothing is everywhere. */
  it("keeps a black jacket on a black backdrop", () => {
    const size = 12;
    const px = onBackdrop(size, [0, 0, 0], [40, 40, 40]);
    knockOutBackdrop(px, size, size, { r: 0, g: 0, b: 0 });
    expect(alphaAt(px, size, 0, 0)).toBe(0);
    expect(alphaAt(px, size, 6, 6)).toBe(255);
  });

  it("does not reach a backdrop-coloured pocket enclosed by the subject", () => {
    const size = 13;
    const mid = 6;
    // A white ring of subject around a single white pixel at the centre.
    const px = image(size, size, (x, y) => {
      if (x === mid && y === mid) return [255, 255, 255];
      const inSubject = x >= 3 && x < size - 3 && y >= 3 && y < size - 3;
      return inSubject ? [30, 30, 30] : [255, 255, 255];
    });
    knockOutBackdrop(px, size, size, { r: 255, g: 255, b: 255 });
    expect(alphaAt(px, size, 0, 0)).toBe(0);
    // Enclosed and therefore unreachable from the border: it stays.
    expect(alphaAt(px, size, mid, mid)).toBe(255);
  });

  it("clears everything when the whole image is backdrop", () => {
    const size = 8;
    const px = image(size, size, () => [255, 255, 255]);
    expect(knockOutBackdrop(px, size, size, { r: 255, g: 255, b: 255 })).toBe(size * size);
  });

  it("clears nothing when the border doesn't match the colour given", () => {
    const size = 8;
    const px = image(size, size, () => [120, 130, 140]);
    expect(knockOutBackdrop(px, size, size, { r: 255, g: 255, b: 255 })).toBe(0);
    expect(alphaAt(px, size, 0, 0)).toBe(255);
  });

  it("feathers the surviving edge instead of leaving a hard fringe", () => {
    const size = 12;
    // A halo one shade off the backdrop, as JPEG ringing produces.
    const px = image(size, size, (x, y) => {
      const inSubject = x >= 4 && x < size - 4 && y >= 4 && y < size - 4;
      if (inSubject) return [20, 20, 20];
      const inHalo = x >= 3 && x < size - 3 && y >= 3 && y < size - 3;
      return inHalo ? [228, 228, 228] : [255, 255, 255];
    });
    knockOutBackdrop(px, size, size, { r: 255, g: 255, b: 255 });
    const halo = alphaAt(px, size, 3, 6);
    expect(halo).toBeGreaterThan(0);
    expect(halo).toBeLessThan(255);
  });

  it("survives a zero-sized image", () => {
    expect(knockOutBackdrop(new Uint8ClampedArray(0), 0, 0, { r: 0, g: 0, b: 0 })).toBe(0);
  });
});

describe("cutOutBackdrop", () => {
  it("removes a white studio backdrop", () => {
    const size = 12;
    const px = onBackdrop(size, [255, 255, 255], [40, 60, 90]);
    expect(cutOutBackdrop(px, size, size)).toBe(true);
    expect(alphaAt(px, size, 0, 0)).toBe(0);
  });

  it("removes a black studio backdrop", () => {
    const size = 12;
    const px = onBackdrop(size, [2, 2, 4], [220, 210, 200]);
    expect(cutOutBackdrop(px, size, size)).toBe(true);
    expect(alphaAt(px, size, 0, 0)).toBe(0);
  });

  it("leaves a mid-grey backdrop alone rather than guessing", () => {
    const size = 12;
    const px = onBackdrop(size, [128, 128, 128], [20, 20, 20]);
    expect(cutOutBackdrop(px, size, size)).toBe(false);
    expect(alphaAt(px, size, 0, 0)).toBe(255);
  });

  /** A photo taken against something real must come back untouched. */
  it("leaves a busy background alone", () => {
    const size = 14;
    const px = image(size, size, (x, y) => [(x * 37) % 256, (y * 53) % 256, ((x + y) * 29) % 256]);
    expect(cutOutBackdrop(px, size, size)).toBe(false);
  });

  it("still cuts out when the garment touches a frame edge", () => {
    /*
     * The Arc'teryx jacket: a product photo whose hood met the top of the
     * frame. The border was 96% pure white, but one dark run pushed max spread
     * to 202, the old veto rejected it outright, and the item drew as a white
     * rectangle over everything behind it on the outfit canvas.
     */
    const size = 20;
    const px = onBackdrop(size, [255, 255, 255], [30, 30, 40]);
    // Bleed the garment up to the top edge across a quarter of the width.
    for (let x = 8; x < 13; x += 1) {
      for (let y = 0; y < 6; y += 1) {
        const i = (y * size + x) * 4;
        px[i] = 30;
        px[i + 1] = 30;
        px[i + 2] = 40;
      }
    }
    const detected = detectBorderBackground(px, size, size)!;
    expect(detected.spread).toBeGreaterThan(34); // the old veto would have fired
    expect(detected.color).toEqual({ r: 255, g: 255, b: 255 }); // median ignores the intrusion
    expect(cutOutBackdrop(px, size, size)).toBe(true);
    // The corner clears; the garment that reaches the edge is kept.
    expect(alphaAt(px, size, 0, 0)).toBe(0);
    expect(alphaAt(px, size, 10, 1)).toBe(255);
  });

  it("still refuses when no single colour covers most of the border", () => {
    // Half backdrop, half something else is not a backdrop.
    const size = 16;
    const px = image(size, size, (x, y) =>
      y < size / 2 ? [255, 255, 255] : [(x * 31) % 256, (y * 17) % 256, 90],
    );
    expect(cutOutBackdrop(px, size, size)).toBe(false);
  });

  it("reports false rather than throwing on a degenerate image", () => {
    expect(cutOutBackdrop(new Uint8ClampedArray(4), 1, 1)).toBe(false);
  });
});
