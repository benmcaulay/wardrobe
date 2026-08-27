import { describe, it, expect, afterEach } from "vitest";
import { strEnv, numEnv, intEnv, boolEnv } from "../lib/env";

const ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ENV };
});

/**
 * The case that matters: `.env.example` ships optional knobs as NAME="", so a
 * copied .env leaves them defined-and-empty. Every helper must treat that
 * exactly like unset.
 */
describe("empty means absent", () => {
  it("strEnv falls back on empty and whitespace-only values", () => {
    process.env.T_STR = "";
    expect(strEnv("T_STR")).toBeUndefined();
    expect(strEnv("T_STR", "fallback")).toBe("fallback");

    process.env.T_STR = "   ";
    expect(strEnv("T_STR", "fallback")).toBe("fallback");
  });

  it("numEnv falls back on empty, where Number('') would yield 0", () => {
    process.env.T_NUM = "";
    expect(numEnv("T_NUM", 18)).toBe(18);
    process.env.T_NUM = "  ";
    expect(numEnv("T_NUM", 18)).toBe(18);
  });

  it("intEnv falls back on empty — the AI quota regression", () => {
    process.env.T_INT = "";
    expect(intEnv("T_INT", 200)).toBe(200);
    process.env.T_INT = "\t";
    expect(intEnv("T_INT", 200)).toBe(200);
  });

  it("boolEnv is false for empty", () => {
    process.env.T_BOOL = "";
    expect(boolEnv("T_BOOL")).toBe(false);
  });
});

describe("strEnv", () => {
  it("returns and trims a real value", () => {
    process.env.T_STR = "  fal-ai/seedream/v4/edit  ";
    expect(strEnv("T_STR")).toBe("fal-ai/seedream/v4/edit");
  });

  it("falls back when unset", () => {
    delete process.env.T_STR;
    expect(strEnv("T_STR")).toBeUndefined();
    expect(strEnv("T_STR", "default")).toBe("default");
  });
});

describe("numEnv", () => {
  it("parses integers, decimals, and negatives", () => {
    process.env.T_NUM = "42";
    expect(numEnv("T_NUM", 0)).toBe(42);
    process.env.T_NUM = "0.75";
    expect(numEnv("T_NUM", 0)).toBe(0.75);
    process.env.T_NUM = "-3.5";
    expect(numEnv("T_NUM", 0)).toBe(-3.5);
  });

  it("honors an explicit zero rather than treating it as absent", () => {
    process.env.T_NUM = "0";
    expect(numEnv("T_NUM", 18)).toBe(0);
  });

  it("falls back on unparseable and non-finite values", () => {
    for (const junk of ["banana", "12px", "Infinity", "NaN"]) {
      process.env.T_NUM = junk;
      expect(numEnv("T_NUM", 18)).toBe(18);
    }
  });
});

describe("intEnv", () => {
  it("floors fractions", () => {
    process.env.T_INT = "7.9";
    expect(intEnv("T_INT", 200)).toBe(7);
  });

  it("honors an explicit zero, so a quota can be deliberately closed", () => {
    process.env.T_INT = "0";
    expect(intEnv("T_INT", 200)).toBe(0);
  });

  it("rejects negatives as junk", () => {
    process.env.T_INT = "-5";
    expect(intEnv("T_INT", 200)).toBe(200);
  });
});

describe("boolEnv", () => {
  it("uses the fallback for absent, empty, and junk values", () => {
    delete process.env.T_BOOL;
    expect(boolEnv("T_BOOL", true)).toBe(true);
    expect(boolEnv("T_BOOL", false)).toBe(false);
    for (const junk of ["", "  ", "1", "yes"]) {
      process.env.T_BOOL = junk;
      expect(boolEnv("T_BOOL", true)).toBe(true);
    }
  });

  it("lets an explicit false override a true fallback — the opt-out flags", () => {
    process.env.T_BOOL = "false";
    expect(boolEnv("T_BOOL", true)).toBe(false);
    process.env.T_BOOL = "FALSE";
    expect(boolEnv("T_BOOL", true)).toBe(false);
  });

  it("is true only for an explicit true, case-insensitively", () => {
    for (const v of ["true", "TRUE", " True "]) {
      process.env.T_BOOL = v;
      expect(boolEnv("T_BOOL")).toBe(true);
    }
    for (const v of ["false", "1", "yes", "", "  "]) {
      process.env.T_BOOL = v;
      expect(boolEnv("T_BOOL")).toBe(false);
    }
    delete process.env.T_BOOL;
    expect(boolEnv("T_BOOL")).toBe(false);
  });
});
