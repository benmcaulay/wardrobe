import { describe, it, expect } from "vitest";
import { buildPrompt } from "../lib/services/ghostMannequin";

describe("ghost catalog fal prompt (six tenets)", () => {
  it("never says mannequin in apparel or footwear prompts", () => {
    for (const cat of ["upperbody", "lowerbody", "dress", "full", "footwear"] as const) {
      const p = buildPrompt(cat, undefined, "default");
      expect(p).not.toMatch(/mannequin/i);
    }
  });

  it("requires visible back lining through the neck opening", () => {
    const p = buildPrompt("upperbody", undefined, "default");
    expect(p).toMatch(/back lining/i);
    expect(p).toMatch(/No white plastic tube/i);
  });

  it("requires fully inflated volume", () => {
    const p = buildPrompt("upperbody", undefined, "default");
    expect(p).toMatch(/Fully inflated/i);
    expect(p).toMatch(/Not flat, deflated/i);
  });

  it("requires straight arms for tops", () => {
    const p = buildPrompt("upperbody", undefined, "default");
    expect(p).toMatch(/Arms straight/i);
    expect(p).toMatch(/straight down at the sides/i);
  });

  it("requires pure white background and no shadows", () => {
    const p = buildPrompt("upperbody", undefined, "default");
    expect(p).toMatch(/#ffffff/);
    expect(p).toMatch(/No shadows/i);
    expect(p).toMatch(/No cast shadow/i);
  });

  it("requires straight-on camera for front and rear", () => {
    const front = buildPrompt("upperbody", undefined, "default");
    expect(front).toMatch(/Straight-on camera only/i);
    expect(front).toMatch(/0° yaw/);
    const rear = buildPrompt("upperbody", undefined, "rear");
    expect(rear).toMatch(/back of the garment/i);
    expect(rear).toMatch(/0° yaw/);
  });

  it("uses footwear-specific framing without saying mannequin", () => {
    const p = buildPrompt("footwear", undefined, "default");
    expect(p).toMatch(/45°/);
    expect(p).toMatch(/No legs/i);
    expect(p).not.toMatch(/mannequin/i);
  });

  it("appends optional per-view UI instructions", () => {
    const p = buildPrompt("dress", "emphasize the collar stitching", "default");
    expect(p).toMatch(/Additional direction/);
    expect(p).toMatch(/collar stitching/);
  });
});
