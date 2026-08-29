import { describe, expect, it } from "vitest";
import { APP_WORDMARK, APP_WORDMARK_PARTS } from "@/lib/brand";
import {
  WORDMARK_SPACE_CAP,
  WORDMARK_SPACE_MAX_EM,
  WORDMARK_SPACE_MIN_EM,
  wordmarkSpaceEm,
  wordmarkSpaceLabel,
} from "@/lib/space/wordmark";

describe("APP_WORDMARK_PARTS", () => {
  it("splits the wordmark at its one space", () => {
    expect(APP_WORDMARK_PARTS).toEqual(["MAKING", "SPACE"]);
    expect(APP_WORDMARK_PARTS.join(" ")).toBe(APP_WORDMARK);
  });
});

describe("wordmarkSpaceEm", () => {
  it("rests at the minimum with nothing out", () => {
    expect(wordmarkSpaceEm(0)).toBe(WORDMARK_SPACE_MIN_EM);
  });

  it("never goes below the minimum, whatever it is handed", () => {
    for (const bad of [-1, -100, Number.NaN, Number.NEGATIVE_INFINITY]) {
      expect(wordmarkSpaceEm(bad)).toBe(WORDMARK_SPACE_MIN_EM);
    }
  });

  it("moves visibly on the very first piece out", () => {
    // The first sale is the whole reward; a curve that starts flat wastes it.
    const first = wordmarkSpaceEm(1);
    expect(first).toBeGreaterThan(WORDMARK_SPACE_MIN_EM + 0.15);
  });

  it("increases monotonically", () => {
    let previous = wordmarkSpaceEm(0);
    for (let n = 1; n <= WORDMARK_SPACE_CAP + 5; n += 1) {
      const current = wordmarkSpaceEm(n);
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });

  it("decelerates — the twentieth piece moves it less than the second", () => {
    const early = wordmarkSpaceEm(2) - wordmarkSpaceEm(1);
    const late = wordmarkSpaceEm(20) - wordmarkSpaceEm(19);
    expect(late).toBeLessThan(early);
  });

  it("caps so the two halves still read as one name", () => {
    expect(wordmarkSpaceEm(WORDMARK_SPACE_CAP)).toBe(WORDMARK_SPACE_MAX_EM);
    expect(wordmarkSpaceEm(WORDMARK_SPACE_CAP * 100)).toBe(WORDMARK_SPACE_MAX_EM);
  });

  it("returns a value stable enough to render identically on both sides", () => {
    for (let n = 0; n <= 30; n += 1) {
      const value = wordmarkSpaceEm(n);
      expect(String(value)).toBe(String(Number(value.toFixed(3))));
    }
  });
});

describe("wordmarkSpaceLabel", () => {
  it("says plainly that nothing has happened", () => {
    expect(wordmarkSpaceLabel(0)).toBe("Nothing has left the closet this month.");
  });

  it("counts and stops", () => {
    expect(wordmarkSpaceLabel(1)).toContain("1 piece left the closet this month");
    expect(wordmarkSpaceLabel(4)).toContain("4 pieces left the closet this month");
  });

  it("takes the window label from the caller", () => {
    expect(wordmarkSpaceLabel(3, "this year")).toContain("this year");
  });

  it("never encourages, compares, or instructs", () => {
    const all = [0, 1, 9, 40].map((n) => wordmarkSpaceLabel(n).toLowerCase()).join(" ");
    for (const banned of ["keep going", "goal", "target", "better", "worse", "should", "than last"]) {
      expect(all).not.toContain(banned);
    }
  });
});
