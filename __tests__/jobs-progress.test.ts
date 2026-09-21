import { describe, it, expect } from "vitest";
import {
  describeJobProgress,
  formatElapsed,
  PICKUP_GRACE_MS,
  type JobProgressInput,
} from "../lib/jobs/progress";
import { JOB_LEASE_MINUTES } from "../lib/jobs/queue";

const NOW = new Date("2026-09-20T12:00:00Z");
const agoMs = (ms: number) => new Date(NOW.getTime() - ms);
const agoMin = (m: number) => agoMs(m * 60_000);

const job = (over: Partial<JobProgressInput> = {}): JobProgressInput => ({
  status: "queued",
  createdAt: agoMs(5_000),
  updatedAt: agoMs(5_000),
  attempts: 0,
  maxAttempts: 3,
  error: null,
  ...over,
});

describe("formatElapsed", () => {
  it("reads in whatever unit is natural", () => {
    expect(formatElapsed(12_000)).toBe("12s");
    expect(formatElapsed(4 * 60_000)).toBe("4m");
    expect(formatElapsed(80 * 60_000)).toBe("1h 20m");
    expect(formatElapsed(120 * 60_000)).toBe("2h");
  });

  it("never shows negative time when clocks disagree", () => {
    expect(formatElapsed(-5000)).toBe("0s");
  });
});

describe("describeJobProgress", () => {
  it("a fresh queued job is just starting", () => {
    const p = describeJobProgress(job(), NOW);
    expect(p.state).toBe("queued");
    expect(p.active).toBe(true);
  });

  it("names the real problem once nothing has claimed it", () => {
    const p = describeJobProgress(job({ createdAt: agoMs(PICKUP_GRACE_MS + 1000) }), NOW);
    expect(p.state).toBe("unclaimed");
    expect(p.active).toBe(false);
    expect(p.message).toMatch(/nothing has picked it up/i);
  });

  it("a job inside its lease is genuinely rendering", () => {
    const p = describeJobProgress(
      job({ status: "running", attempts: 1, createdAt: agoMin(1), updatedAt: agoMs(3_000) }),
      NOW,
    );
    expect(p.state).toBe("working");
    expect(p.active).toBe(true);
    expect(p.message).toMatch(/1m so far/);
  });

  it("a running job past its lease is a dead worker, not a slow one", () => {
    const p = describeJobProgress(
      job({
        status: "running",
        attempts: 1,
        createdAt: agoMin(30),
        updatedAt: agoMin(JOB_LEASE_MINUTES + 1),
      }),
      NOW,
    );
    expect(p.state).toBe("stalled");
    expect(p.active).toBe(false);
    expect(p.message).toMatch(/stopped partway/i);
  });

  it("distinguishes a dead worker with no retries left", () => {
    const p = describeJobProgress(
      job({
        status: "running",
        attempts: 3,
        maxAttempts: 3,
        createdAt: agoMin(40),
        updatedAt: agoMin(JOB_LEASE_MINUTES + 1),
      }),
      NOW,
    );
    expect(p.state).toBe("abandoned");
    expect(p.active).toBe(false);
  });

  it("a requeued job reports the failure it is retrying, not a blank wait", () => {
    // markJobFailed puts a retryable job back to "queued" with the error kept.
    const p = describeJobProgress(
      job({ attempts: 2, error: "Gemini returned 503", createdAt: agoMin(12) }),
      NOW,
    );
    expect(p.state).toBe("retrying");
    expect(p.active).toBe(false);
    expect(p.message).toContain("Attempt 2 of 3 failed");
    expect(p.message).toContain("Gemini returned 503");
  });

  it("truncates a runaway error rather than pasting a stack trace into the page", () => {
    const p = describeJobProgress(job({ status: "failed", error: "x".repeat(500) }), NOW);
    expect(p.state).toBe("failed");
    expect(p.message.length).toBeLessThan(200);
    expect(p.message).toContain("…");
  });

  it("collapses whitespace so a multi-line error stays one line", () => {
    const p = describeJobProgress(job({ status: "failed", error: "bad\n  thing" }), NOW);
    expect(p.message).toContain("bad thing");
  });

  it("reports how long a finished job took", () => {
    const p = describeJobProgress(job({ status: "succeeded", createdAt: agoMs(42_000) }), NOW);
    expect(p.state).toBe("succeeded");
    expect(p.message).toBe("Finished in 42s.");
    expect(p.active).toBe(false);
  });

  it("only ever calls itself active when waiting is still the right move", () => {
    const states = [
      job(),
      job({ createdAt: agoMin(10) }),
      job({ status: "running", updatedAt: agoMs(1000) }),
      job({ status: "running", updatedAt: agoMin(JOB_LEASE_MINUTES + 1) }),
      job({ status: "failed" }),
      job({ status: "succeeded" }),
    ].map((j) => describeJobProgress(j, NOW));
    expect(states.map((p) => p.active)).toEqual([true, false, true, false, false, false]);
  });
});
