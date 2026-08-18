import { describe, expect, it } from "vitest";
import {
  capEditImageUrls,
  DEFAULT_EDIT_CAPTION,
  estimateTrainingCost,
  loraInput,
  MAX_EDIT_IMAGE_URLS,
  MIN_PAIRS,
  pairFileNames,
  RECOMMENDED_MAX_PAIRS,
  validateDataset,
  type DatasetPair,
} from "@/lib/services/ghost-lora";

function pair(id: string, over: Partial<DatasetPair> = {}): DatasetPair {
  return {
    id,
    startBytes: 1000,
    endBytes: 1000,
    startWidth: 1024,
    startHeight: 1366,
    endWidth: 1024,
    endHeight: 1366,
    ...over,
  };
}

const okPairs = (n: number) => Array.from({ length: n }, (_, i) => pair(`p${i}`));

describe("estimateTrainingCost", () => {
  it("matches the trainer's published example (1000 steps, 1 reference)", () => {
    // Published figure is ~$11.82 for 1000 steps with one reference image.
    expect(estimateTrainingCost(1000, 1)).toBeCloseTo(11.816, 2);
  });

  it("scales linearly with steps", () => {
    expect(estimateTrainingCost(2000, 1)).toBeCloseTo(estimateTrainingCost(1000, 1) * 2, 5);
  });

  it("gets more expensive with more reference images", () => {
    const one = estimateTrainingCost(1000, 1);
    const four = estimateTrainingCost(1000, 4);
    expect(four).toBeGreaterThan(one * 3);
  });

  it("rejects a reference count the trainer cannot accept", () => {
    expect(() => estimateTrainingCost(1000, 0)).toThrow(/1-4/);
    expect(() => estimateTrainingCost(1000, 5)).toThrow(/1-4/);
  });
});

describe("pairFileNames", () => {
  it("uses a shared zero-padded root with _start/_end suffixes", () => {
    const n = pairFileNames(7);
    expect(n.root).toBe("0007");
    expect(n.start).toBe("0007_start.png");
    expect(n.end).toBe("0007_end.png");
    expect(n.caption).toBe("0007.txt");
  });

  it("keeps start and end on the same root so the trainer pairs them", () => {
    const n = pairFileNames(42, "jpg");
    expect(n.start.startsWith(n.root)).toBe(true);
    expect(n.end.startsWith(n.root)).toBe(true);
  });
});

describe("validateDataset", () => {
  it("accepts a healthy dataset", () => {
    const v = validateDataset(okPairs(MIN_PAIRS));
    expect(v.ok).toBe(true);
    expect(v.errors).toEqual([]);
  });

  it("blocks a dataset that is too small to train on", () => {
    const v = validateDataset(okPairs(MIN_PAIRS - 1));
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/at least 15/);
  });

  it("warns but does not block when there are more pairs than recommended", () => {
    const v = validateDataset(okPairs(RECOMMENDED_MAX_PAIRS + 1));
    expect(v.ok).toBe(true);
    expect(v.warnings.join(" ")).toMatch(/exceeds the recommended/);
  });

  it("blocks empty images", () => {
    const pairs = [...okPairs(MIN_PAIRS), pair("broken", { endBytes: 0 })];
    const v = validateDataset(pairs);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/broken has an empty image/);
  });

  it("warns about undersized images without blocking", () => {
    const pairs = [...okPairs(MIN_PAIRS), pair("small", { endWidth: 512, endHeight: 512 })];
    const v = validateDataset(pairs);
    expect(v.ok).toBe(true);
    expect(v.warnings.join(" ")).toMatch(/small end is 512×512/);
  });
});

describe("capEditImageUrls", () => {
  it("passes through when already within the endpoint limit", () => {
    const urls = ["a", "b", "c"];
    expect(capEditImageUrls(urls)).toEqual(urls);
  });

  it("trims to the max, keeping the garment first", () => {
    // The endpoint rejects more than 4; extras are dropped, the garment is not.
    const urls = ["garment", "e1", "e2", "e3", "e4", "e5"];
    const capped = capEditImageUrls(urls);
    expect(capped).toHaveLength(MAX_EDIT_IMAGE_URLS);
    expect(capped[0]).toBe("garment");
    expect(capped).not.toContain("e4");
  });
});

describe("loraInput", () => {
  it("builds a single-entry loras array at trained strength", () => {
    expect(loraInput("https://x/lora.safetensors")).toEqual([
      { path: "https://x/lora.safetensors", scale: 1 },
    ]);
  });

  it("clamps scale into the endpoint's 0-4 range", () => {
    expect(loraInput("u", 9)[0]!.scale).toBe(4);
    expect(loraInput("u", -1)[0]!.scale).toBe(0);
  });

  it("returns an empty array for a blank url so callers can spread it safely", () => {
    expect(loraInput("")).toEqual([]);
    expect(loraInput("   ")).toEqual([]);
  });

  it("trims whitespace from a pasted url", () => {
    expect(loraInput("  https://x/l.safetensors \n")[0]!.path).toBe("https://x/l.safetensors");
  });
});

describe("DEFAULT_EDIT_CAPTION", () => {
  it("names the transformation the LoRA is being taught", () => {
    expect(DEFAULT_EDIT_CAPTION).toMatch(/ghost-mannequin/i);
    expect(DEFAULT_EDIT_CAPTION).toMatch(/unfolded/i);
    expect(DEFAULT_EDIT_CAPTION).toMatch(/pressed/i);
  });
});
