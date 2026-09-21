import { describe, expect, it } from "vitest";
import { buildPrompt, buildRevisionPrompt } from "@/lib/services/ghostMannequin";
import { qwenPrompt } from "@/lib/services/ghost-provider-qwen";

describe("buildRevisionPrompt", () => {
  it("states the change and pins everything else", () => {
    const p = buildRevisionPrompt("  straighten the printed text  ");
    expect(p).toContain("straighten the printed text");
    expect(p).toMatch(/existing e-commerce product photo/i);
    expect(p).toMatch(/Same framing, same scale/);
    expect(p).toMatch(/correction, not a new render/);
  });

  it("does not carry the build prompt's anti-wearer argument", () => {
    // That text exists to talk a model out of putting the garment on a person.
    // An input that is already a floating product shot only drifts against it.
    const p = buildRevisionPrompt("make the red deeper");
    expect(p).not.toMatch(/folded, stacked, laid flat/i);
    expect(p.length).toBeLessThan(buildPrompt("upperbody", undefined, "default").length);
  });
});

describe("buildPrompt revision routing", () => {
  it("returns the revision prompt when the reference is a previous render", () => {
    const revised = buildPrompt("upperbody", "fix the logo", "default", true);
    expect(revised).toBe(buildRevisionPrompt("fix the logo"));
  });

  it("is unchanged for an ordinary render", () => {
    expect(buildPrompt("upperbody", "fix the logo", "default", false)).not.toBe(
      buildRevisionPrompt("fix the logo"),
    );
  });

  it("defaults to building, so no existing caller changes behaviour", () => {
    expect(buildPrompt("upperbody", "x", "default")).toBe(
      buildPrompt("upperbody", "x", "default", false),
    );
  });
});

describe("printed text rule", () => {
  const rule = qwenPrompt("BASE PROMPT", 1);

  it("tells the model the waviness is the photograph, not the design", () => {
    expect(rule).toMatch(/belongs to the photograph, not to the design/i);
  });

  it("keeps a deliberate arc while dropping the drape", () => {
    // A collegiate wordmark really is arched; the rule must not flatten it.
    expect(rule).toMatch(/arched wordmark keeps a clean even arc/i);
    expect(rule).toMatch(/drop the distortion the drape added/i);
  });

  it("asks for set type: one face, even weight, uniform height", () => {
    expect(rule).toMatch(/consistent typeface/i);
    expect(rule).toMatch(/even stroke weight/i);
    expect(rule).toMatch(/uniform letter height/i);
  });

  it("still carries the caller's prompt and the reference binding", () => {
    expect(rule).toContain("BASE PROMPT");
    expect(rule).toMatch(/<image1> shows the exact garment/);
  });
});
