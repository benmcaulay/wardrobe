import { describe, it, expect } from "vitest";
import { emailAuthConfigured } from "../lib/auth-shared-email";

describe("emailAuthConfigured", () => {
  const server = "smtp://user:pass@smtp.example.com:587";

  it("is true only when both halves are present", () => {
    expect(emailAuthConfigured({ EMAIL_SERVER: server, EMAIL_FROM: "a@b.com" })).toBe(true);
  });

  it("is false when either half is missing", () => {
    expect(emailAuthConfigured({ EMAIL_SERVER: server })).toBe(false);
    expect(emailAuthConfigured({ EMAIL_FROM: "a@b.com" })).toBe(false);
    expect(emailAuthConfigured({})).toBe(false);
  });

  it("treats empty and whitespace-only values as unset", () => {
    // The three failures that broke this deployment were all set-but-empty
    // variables, which `??` lets through.
    expect(emailAuthConfigured({ EMAIL_SERVER: "", EMAIL_FROM: "" })).toBe(false);
    expect(emailAuthConfigured({ EMAIL_SERVER: server, EMAIL_FROM: "" })).toBe(false);
    expect(emailAuthConfigured({ EMAIL_SERVER: "   ", EMAIL_FROM: "a@b.com" })).toBe(false);
  });
});
