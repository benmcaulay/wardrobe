import { describe, it, expect } from "vitest";
import { emailAllowed, parseAllowedEmails } from "../lib/auth-allowlist";

describe("parseAllowedEmails", () => {
  it("splits, trims and lowercases", () => {
    expect(parseAllowedEmails(" A@x.com , B@Y.com ")).toEqual(["a@x.com", "b@y.com"]);
  });

  it("treats unset, empty and blank as no roster", () => {
    for (const raw of [undefined, null, "", "   ", ",,", " , , "]) {
      expect(parseAllowedEmails(raw)).toEqual([]);
    }
  });
});

describe("emailAllowed", () => {
  const roster = "me@x.com, her@y.com";

  it("allows everyone when no roster is configured", () => {
    // Local dev and the test suite must not need a roster.
    expect(emailAllowed("stranger@z.com", undefined)).toBe(true);
    expect(emailAllowed("stranger@z.com", "")).toBe(true);
    expect(emailAllowed(null, undefined)).toBe(true);
  });

  it("admits a listed address regardless of casing or padding", () => {
    expect(emailAllowed("me@x.com", roster)).toBe(true);
    expect(emailAllowed(" ME@X.com ", roster)).toBe(true);
    expect(emailAllowed("her@y.com", roster)).toBe(true);
  });

  it("rejects an unlisted address", () => {
    expect(emailAllowed("stranger@z.com", roster)).toBe(false);
  });

  it("rejects a missing address once a roster exists", () => {
    // "Cannot be checked" must not mean "allowed" after the operator asked
    // for a restriction.
    expect(emailAllowed(null, roster)).toBe(false);
    expect(emailAllowed(undefined, roster)).toBe(false);
    expect(emailAllowed("", roster)).toBe(false);
  });

  it("does not match on a substring or a lookalike domain", () => {
    expect(emailAllowed("me@x.com.evil.com", roster)).toBe(false);
    expect(emailAllowed("notme@x.com", roster)).toBe(false);
    expect(emailAllowed("me@x.co", roster)).toBe(false);
  });
});
