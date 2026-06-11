import { describe, it, expect } from "vitest";
import { willRetry } from "../lib/jobs/queue";

describe("willRetry", () => {
  it("retries while attempts remain below the cap", () => {
    expect(willRetry(1, 3)).toBe(true);
    expect(willRetry(2, 3)).toBe(true);
  });

  it("stops at the cap", () => {
    expect(willRetry(3, 3)).toBe(false);
    expect(willRetry(4, 3)).toBe(false);
  });

  it("a permanent error (attempts forced to max) never retries", () => {
    // runner.ts sets attempts = maxAttempts for PermanentJobError.
    expect(willRetry(3, 3)).toBe(false);
  });
});
