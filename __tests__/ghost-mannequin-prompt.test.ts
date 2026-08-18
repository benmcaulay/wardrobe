import { describe, it, expect } from "vitest";
import { buildPrompt } from "../lib/services/ghostMannequin";

describe("ghost catalog fal prompt (six tenets)", () => {
  it("never says mannequin in apparel or footwear prompts", () => {
    for (const cat of ["upperbody", "lowerbody", "dress", "full", "footwear"] as const) {
      const p = buildPrompt(cat, undefined, "default");
      expect(p).not.toMatch(/mannequin/i);
    }
  });

  it("requires visible back lining through openings when applicable", () => {
    const p = buildPrompt("upperbody", undefined, "default");
    expect(p).toMatch(/back lining/i);
    expect(p).toMatch(/No white plastic tube/i);
  });

  it("requires natural retail shape without inflate/balloon language", () => {
    const p = buildPrompt("upperbody", undefined, "default");
    expect(p).toMatch(/Natural retail shape/i);
    expect(p).toMatch(/not flat, collapsed/i);
    expect(p).not.toMatch(/inflat/i);
    expect(p).toMatch(/do not overfill, puff, balloon/i);
  });

  it("treats the reference as identity only, never as pose", () => {
    for (const cat of ["upperbody", "lowerbody", "dress", "full", "footwear"] as const) {
      const p = buildPrompt(cat, undefined, "default");
      expect(p).toMatch(/Reference is for identity only/i);
      expect(p).toMatch(/may be folded, stacked, laid flat/i);
      expect(p).toMatch(/upright, fully unfolded/i);
    }
  });

  it("never lets a folded flat-lay reference anchor the output silhouette", () => {
    const p = buildPrompt("upperbody", undefined, "default");
    // The old prompt said "beyond the reference", which made a folded input
    // authoritative for shape. Silhouette must key off the cut, not the photo.
    expect(p).not.toMatch(/silhouette beyond the reference/i);
    expect(p).toMatch(/silhouette beyond its true cut/i);
    expect(p).toMatch(/Never reproduce fold lines, stacked layers, or a flat-lay layout/i);
    expect(p).toMatch(/never folded in half/i);
  });

  it("demands a pressed, wrinkle-free finish that ignores a rumpled reference", () => {
    for (const cat of ["upperbody", "lowerbody", "dress", "full"] as const) {
      const p = buildPrompt(cat, undefined, "default");
      expect(p).toMatch(/Freshly pressed finish/i);
      expect(p).toMatch(/No wrinkles, creases, crumple marks/i);
      expect(p).toMatch(/wrinkles never carry over/i);
    }
  });

  it("requires straight arms for tops", () => {
    const p = buildPrompt("upperbody", undefined, "default");
    expect(p).toMatch(/TYPE — top/i);
    expect(p).toMatch(/straight down at the sides/i);
  });

  it("asks untyped (full) prompts to identify type then follow that type's instructions", () => {
    const p = buildPrompt("full", undefined, "default");
    expect(p).toMatch(/Identify the garment or accessory type/i);
    expect(p).toMatch(/apply ONLY the matching TYPE block/i);
    expect(p).toMatch(/TYPE — top/i);
    expect(p).toMatch(/TYPE — bottom/i);
    expect(p).toMatch(/TYPE — dress/i);
    expect(p).toMatch(/TYPE — footwear/i);
    expect(p).toMatch(/TYPE — accessory/i);
    expect(p).toMatch(/45°/);
  });

  it("requires pure white background and no shadows", () => {
    const p = buildPrompt("upperbody", undefined, "default");
    expect(p).toMatch(/#ffffff/);
    expect(p).toMatch(/No shadows/i);
    expect(p).toMatch(/No cast shadow/i);
  });

  it("guards exposure so renders don't come back washed out", () => {
    for (const cat of ["upperbody", "lowerbody", "dress", "full", "footwear"] as const) {
      const p = buildPrompt(cat, undefined, "default");
      expect(p).toMatch(/Correct exposure — never brightened/i);
      expect(p).toMatch(/No blown-out or clipped highlights/i);
      expect(p).toMatch(/dark tones stay genuinely dark/i);
    }
  });

  it("bans high-frequency shading, which is what reads as wrinkles", () => {
    const p = buildPrompt("upperbody", undefined, "default");
    expect(p).toMatch(/No small, sharp, or high-frequency light-and-dark detail/i);
    expect(p).toMatch(/Do not trace, copy, or preserve the reference photo's wrinkle/i);
    // Flat-lighting language drove the blown-out look; it must not come back.
    expect(p).not.toMatch(/Flat, even, shadowless lighting/i);
  });

  it("requires straight-on camera for front and rear", () => {
    const front = buildPrompt("upperbody", undefined, "default");
    expect(front).toMatch(/Straight-on camera only/i);
    expect(front).toMatch(/0° yaw/);
    const rear = buildPrompt("upperbody", undefined, "rear");
    expect(rear).toMatch(/back of the item/i);
    expect(rear).toMatch(/0° yaw/);
  });

  it("uses footwear-specific framing without saying mannequin", () => {
    const p = buildPrompt("footwear", undefined, "default");
    expect(p).toMatch(/TYPE — footwear/i);
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
