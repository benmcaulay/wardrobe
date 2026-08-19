import { describe, expect, it } from "vitest";
import {
  buildFeatureMap,
  describeWeights,
  FEATURE_DIMS,
  FEATURE_NAMES,
  itemFeatures,
} from "@/lib/outfit/features";
import type { ScorableItem } from "@/lib/outfit/compatibility";

const index = (name: (typeof FEATURE_NAMES)[number]) => FEATURE_NAMES.indexOf(name);

const item = (overrides: Partial<ScorableItem> & { id: string }): ScorableItem => ({
  category: "top",
  name: "Shirt",
  ...overrides,
});

describe("itemFeatures", () => {
  it("has one dimension per declared name", () => {
    expect(FEATURE_DIMS).toBe(FEATURE_NAMES.length);
    expect(itemFeatures(item({ id: "a" }))).toHaveLength(FEATURE_DIMS);
  });

  it("reads a grey as fully neutral with no hue", () => {
    const features = itemFeatures(
      item({ id: "g", colors: [{ hex: "#808080", name: "grey" }] }),
    );
    expect(features[index("neutralShare")]).toBe(1);
    // Hue of a near-grey is numerically unstable, so it must not be reported.
    expect(features[index("hueCos")]).toBe(0);
    expect(features[index("hueSin")]).toBe(0);
    expect(features[index("chroma")]).toBeLessThan(0.2);
  });

  it("reads a saturated colour as chromatic with a hue direction", () => {
    const features = itemFeatures(item({ id: "r", colors: [{ hex: "#e01e8c", name: "pink" }] }));
    expect(features[index("neutralShare")]).toBe(0);
    expect(features[index("chroma")]).toBeGreaterThan(0.3);
    const cos = features[index("hueCos")];
    const sin = features[index("hueSin")];
    // A single chromatic colour must land on the unit circle.
    expect(Math.hypot(cos, sin)).toBeCloseTo(1, 6);
  });

  /**
   * The reason hue is stored as sine and cosine rather than as an angle.
   * #e01e8c sits at 352° and #c81e5a at 9°: adjacent pinks either side of the
   * wrap point. A numeric mean would call them 180° — the opposite hue, teal —
   * and hand the model a colour the garment does not contain.
   */
  it("averages hue circularly across the 0°/360° wrap", () => {
    const features = itemFeatures(
      item({
        id: "two-pinks",
        colors: [
          { hex: "#e01e8c", name: "pink" },
          { hex: "#c81e5a", name: "raspberry" },
        ],
      }),
    );
    // Both hues are within ~9° of the wrap point, so the circular mean stays
    // pinned there: cos ≈ 1, sin ≈ 0.
    expect(features[index("hueCos")]).toBeGreaterThan(0.98);
    expect(Math.abs(features[index("hueSin")])).toBeLessThan(0.15);
  });

  it("excludes neutrals from the hue average but counts them as neutral", () => {
    const mixed = itemFeatures(
      item({
        id: "mixed",
        colors: [
          { hex: "#000000", name: "black" },
          { hex: "#e01e2e", name: "red" },
        ],
      }),
    );
    expect(mixed[index("neutralShare")]).toBeCloseTo(0.5, 6);
    // The hue comes from the red alone, so it still sits on the unit circle.
    expect(Math.hypot(mixed[index("hueCos")], mixed[index("hueSin")])).toBeCloseTo(1, 6);
  });

  it("returns zeros for colour dimensions when no hex parses", () => {
    const features = itemFeatures(
      item({ id: "bad", colors: [{ hex: "not-a-hex", name: "?" }] }),
    );
    expect(features[index("lightness")]).toBe(0);
    expect(features[index("neutralShare")]).toBe(0);
    expect(features[index("colorCount")]).toBe(0);
  });

  it("flags patterns, distinguishing bold from subtle", () => {
    const bold = itemFeatures(item({ id: "b", pattern: "floral" }));
    expect(bold[index("hasPattern")]).toBe(1);
    expect(bold[index("boldPattern")]).toBe(1);

    const subtle = itemFeatures(item({ id: "s", pattern: "pinstripe" }));
    expect(subtle[index("hasPattern")]).toBe(1);
    expect(subtle[index("boldPattern")]).toBe(0);

    const plain = itemFeatures(item({ id: "p" }));
    expect(plain[index("hasPattern")]).toBe(0);
  });

  it("keeps every dimension inside [-1, 1] so one shared L2 penalty is fair", () => {
    const items = [
      item({ id: "1", colors: [{ hex: "#ffffff", name: "white" }] }),
      item({ id: "2", category: "shoes", name: "Tuxedo dress shoe", pattern: "leopard" }),
      item({
        id: "3",
        colors: Array.from({ length: 6 }, (_, i) => ({ hex: `#e0${i}e8c`, name: "x" })),
      }),
    ];
    for (const one of items) {
      for (const value of itemFeatures(one)) {
        expect(value).toBeGreaterThanOrEqual(-1);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  /**
   * Kind one-hots were removed deliberately — see the note in features.ts. This
   * pins that, because re-adding them silently would put the model back to
   * fitting a logging artifact.
   */
  it("carries no garment-kind one-hot", () => {
    expect(FEATURE_NAMES.filter((name) => name.startsWith("kind"))).toEqual([]);
  });
});

describe("buildFeatureMap", () => {
  const closet = [
    item({ id: "a", colors: [{ hex: "#000000", name: "black" }] }),
    item({ id: "b", colors: [{ hex: "#ffffff", name: "white" }] }),
    item({ id: "c", category: "shoes", name: "Sneaker", colors: [{ hex: "#e01e8c", name: "pink" }] }),
  ];

  it("centres on the closet mean", () => {
    const { features, mean, dims } = buildFeatureMap(closet);
    expect(dims).toBe(FEATURE_DIMS);
    expect(features.size).toBe(3);

    for (let k = 0; k < dims; k += 1) {
      let total = 0;
      for (const vector of features.values()) total += vector[k];
      // Centred: every dimension sums to zero across the closet, which is what
      // makes a zero vector mean "the average garment" — the reading
      // NEUTRAL_ANCHOR depends on.
      expect(total).toBeCloseTo(0, 10);
      expect(mean[k]).toBeCloseTo(
        closet.reduce((sum, one) => sum + itemFeatures(one)[k], 0) / closet.length,
        10,
      );
    }
  });

  it("handles an empty closet without producing NaNs", () => {
    const { features, mean } = buildFeatureMap([]);
    expect(features.size).toBe(0);
    for (const value of mean) expect(value).toBe(0);
  });
});

describe("describeWeights", () => {
  it("orders by absolute influence so the readout leads with what matters", () => {
    const weights = new Array(FEATURE_DIMS).fill(0);
    weights[index("chroma")] = -0.9;
    weights[index("lightness")] = 0.4;
    const described = describeWeights(weights);
    expect(described[0]).toEqual({ name: "chroma", weight: -0.9 });
    expect(described[1]).toEqual({ name: "lightness", weight: 0.4 });
  });
});
