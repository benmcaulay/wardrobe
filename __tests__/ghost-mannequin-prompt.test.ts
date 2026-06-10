import { describe, it, expect } from "vitest";
import { buildPrompt } from "../lib/services/ghostMannequin";

describe("ghost-mannequin camera-angle prompt", () => {
  it("pins footwear to a single strict angle (no vague 'or' the model can dodge)", () => {
    const p = buildPrompt("footwear", undefined, "default");
    expect(p).toMatch(/STRICT/);
    expect(p).toMatch(/45°/);
    expect(p).toMatch(/left/i);
    // The old wording let the model pick between angles — make sure it's gone.
    expect(p).not.toMatch(/three-quarter or front angle/);
  });

  it("squares apparel to the camera as a strict requirement", () => {
    const p = buildPrompt("upperbody", undefined, "default");
    expect(p).toMatch(/STRICT/);
    expect(p).toMatch(/squared to the camera/);
  });

  it("still honours an explicit rear composition hint for apparel", () => {
    const p = buildPrompt("upperbody", undefined, "rear");
    expect(p).toMatch(/[Rr]ear-facing/);
  });

  it("appends caller instructions after the baked-in angle", () => {
    const p = buildPrompt("dress", "shot on a marble plinth", "default");
    expect(p).toMatch(/Additional view instruction/);
    expect(p).toMatch(/marble plinth/);
  });
});
