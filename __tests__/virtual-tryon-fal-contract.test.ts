import { describe, it, expect } from "vitest";
import {
  falModelUsesVtonContract,
  vtonDescription,
} from "../lib/services/virtualTryOn";

describe("falModelUsesVtonContract", () => {
  it("routes dedicated idm-vton models to the one-garment-per-call chain", () => {
    expect(falModelUsesVtonContract("fal-ai/idm-vton")).toBe(true);
    expect(falModelUsesVtonContract("fal-ai/IDM-VTON")).toBe(true);
  });

  it("routes editor models to the multi-image-edit composite", () => {
    expect(falModelUsesVtonContract("fal-ai/gemini-25-flash-image/edit")).toBe(false);
    expect(falModelUsesVtonContract("fal-ai/flux-pro/kontext")).toBe(false);
    expect(falModelUsesVtonContract("fal-ai/seedream/v4/edit")).toBe(false);
  });
});

describe("vtonDescription", () => {
  it("prefers the rich description over the bare category", () => {
    expect(
      vtonDescription({ description: "Blue Linen Shirt shirt top", category: "top shirt" }),
    ).toBe("Blue Linen Shirt shirt top");
  });

  it("falls back to category when no description is present", () => {
    expect(vtonDescription({ category: "bottom jeans" })).toBe("bottom jeans");
  });

  it("falls back to a generic phrase when nothing is provided", () => {
    expect(vtonDescription({})).toBe("a clothing garment");
    expect(vtonDescription({ description: "   ", category: "" })).toBe("a clothing garment");
  });
});
