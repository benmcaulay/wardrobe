import { describe, it, expect, afterEach } from "vitest";
import {
  costTenthCentsForModel,
  currentGenerationCost,
  formatTenthCents,
  groupSpendByModel,
  isKnownModel,
  sumTenthCents,
} from "../lib/ai-costs";

const ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ENV };
});

describe("costTenthCentsForModel", () => {
  it("prices the models we actually route to", () => {
    expect(costTenthCentsForModel("gemini-3.1-flash-image")).toBe(67);
    expect(costTenthCentsForModel("gemini-2.5-flash-image")).toBe(39);
    expect(costTenthCentsForModel("gemini-3-pro-image")).toBe(134);
    expect(costTenthCentsForModel("fal-ai/bytedance/seedream/v4/edit")).toBe(30);
  });

  it("charges an unknown model rather than treating it as free", () => {
    expect(costTenthCentsForModel("some-new-model")).toBeGreaterThan(0);
    expect(costTenthCentsForModel(null)).toBeGreaterThan(0);
    expect(isKnownModel("some-new-model")).toBe(false);
  });

  it("tolerates surrounding whitespace", () => {
    expect(costTenthCentsForModel("  gemini-3-pro-image  ")).toBe(134);
  });
});

describe("formatTenthCents", () => {
  it("keeps sub-cent precision so cheap and default models stay distinguishable", () => {
    expect(formatTenthCents(67)).toBe("$0.067");
    expect(formatTenthCents(39)).toBe("$0.039");
    expect(formatTenthCents(30)).toBe("$0.030");
  });

  it("switches to two decimals past a dollar", () => {
    expect(formatTenthCents(1340)).toBe("$1.34");
    expect(formatTenthCents(10000)).toBe("$10.00");
  });

  it("shows exactly $0.00 for free", () => {
    expect(formatTenthCents(0)).toBe("$0.00");
  });
});

describe("summing", () => {
  /**
   * The reason costs are held in tenths of a cent: 100 renders at $0.067 must
   * come to $6.70. Rounding each to a whole cent first would give $7.00.
   */
  it("does not drift over many sub-cent generations", () => {
    const rows = Array.from({ length: 100 }, () => ({ costTenthCents: 67 }));
    expect(sumTenthCents(rows)).toBe(6700);
    expect(formatTenthCents(sumTenthCents(rows))).toBe("$6.70");
  });

  it("treats missing costs as zero", () => {
    expect(sumTenthCents([{ costTenthCents: null }, {}, { costTenthCents: 30 }])).toBe(30);
  });
});

describe("groupSpendByModel", () => {
  it("aggregates per model, most expensive first", () => {
    const groups = groupSpendByModel([
      { model: "gemini-3.1-flash-image", costTenthCents: 67 },
      { model: "fal-ai/bytedance/seedream/v4/edit", costTenthCents: 30 },
      { model: "gemini-3.1-flash-image", costTenthCents: 67 },
    ]);
    expect(groups).toEqual([
      { model: "gemini-3.1-flash-image", generations: 2, tenthCents: 134 },
      { model: "fal-ai/bytedance/seedream/v4/edit", generations: 1, tenthCents: 30 },
    ]);
  });

  it("buckets rows with no model under 'unknown'", () => {
    const groups = groupSpendByModel([{ costTenthCents: 100 }]);
    expect(groups[0].model).toBe("unknown");
  });
});

describe("currentGenerationCost", () => {
  it("is free in stub mode", () => {
    process.env.USE_REAL_GHOST_MANNEQUIN = "false";
    const cost = currentGenerationCost("apparel");
    expect(cost.free).toBe(true);
    expect(cost.tenthCents).toBe(0);
  });

  it("prices apparel on the gemini model", () => {
    process.env.USE_REAL_GHOST_MANNEQUIN = "true";
    process.env.GEMINI_IMAGE_MODEL = "";
    delete process.env.GHOST_PROVIDER;
    expect(currentGenerationCost("apparel").label).toBe("$0.067");
    process.env.GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image";
    expect(currentGenerationCost("apparel").label).toBe("$0.039");
  });

  it("prices footwear on fal when a fal key exists", () => {
    process.env.USE_REAL_GHOST_MANNEQUIN = "true";
    process.env.FAL_KEY = "test-key";
    delete process.env.GHOST_PROVIDER;
    expect(currentGenerationCost("footwear").label).toBe("$0.030");
  });

  it("falls back to gemini pricing for footwear with no fal key", () => {
    process.env.USE_REAL_GHOST_MANNEQUIN = "true";
    process.env.FAL_KEY = "";
    process.env.GEMINI_IMAGE_MODEL = "";
    delete process.env.GHOST_PROVIDER;
    expect(currentGenerationCost("footwear").label).toBe("$0.067");
  });

  it("honours a forced provider for every category", () => {
    process.env.USE_REAL_GHOST_MANNEQUIN = "true";
    process.env.FAL_KEY = "test-key";
    process.env.GHOST_PROVIDER = "gemini";
    process.env.GEMINI_IMAGE_MODEL = "";
    expect(currentGenerationCost("footwear").label).toBe("$0.067");
  });
});
