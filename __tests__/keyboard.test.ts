import { describe, it, expect } from "vitest";
import { isTypingTarget } from "../lib/keyboard";

describe("isTypingTarget", () => {
  it("is true for the fields a keystroke would otherwise be stolen from", () => {
    expect(isTypingTarget({ tagName: "INPUT" })).toBe(true);
    expect(isTypingTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTypingTarget({ tagName: "SELECT" })).toBe(true);
  });

  it("is true for a contenteditable element whatever its tag", () => {
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  it("is false for ordinary elements a shortcut should act on", () => {
    expect(isTypingTarget({ tagName: "DIV" })).toBe(false);
    expect(isTypingTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isTypingTarget({ tagName: "BODY" })).toBe(false);
  });

  it("tolerates a missing or odd target rather than throwing mid-keystroke", () => {
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget({})).toBe(false);
  });

  it("matches the tag case-insensitively, as SVG and XHTML report it lowercase", () => {
    expect(isTypingTarget({ tagName: "input" })).toBe(true);
  });
});
