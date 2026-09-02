import { describe, it, expect } from "vitest";
import { JOB_LEASE_MINUTES, leaseExpired, willRetry } from "../lib/jobs/queue";

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

describe("job lease", () => {
  const now = new Date("2026-08-29T12:00:00Z");
  const minsAgo = (m: number) => new Date(now.getTime() - m * 60_000);

  it("holds the lease while a job keeps reporting progress", () => {
    // updateJobProgress bumps updatedAt, so a slow camera-roll scan working
    // through 50 photos renews its own lease and is never stolen.
    expect(leaseExpired(minsAgo(1), now)).toBe(false);
    expect(leaseExpired(minsAgo(9), now)).toBe(false);
  });

  it("expires once a job has gone silent past the lease", () => {
    expect(leaseExpired(minsAgo(10), now)).toBe(true);
    expect(leaseExpired(minsAgo(45), now)).toBe(true);
  });

  it("comfortably outlasts one ghost generation", () => {
    // A single generation's own request timeout is 120s; the lease must not
    // fire inside a legitimate attempt.
    expect(JOB_LEASE_MINUTES * 60).toBeGreaterThan(120 * 2);
    expect(leaseExpired(minsAgo(4), now)).toBe(false);
  });

  it("honours a custom lease window", () => {
    expect(leaseExpired(minsAgo(3), now, 5)).toBe(false);
    expect(leaseExpired(minsAgo(6), now, 5)).toBe(true);
  });

  it("treats a future timestamp as fresh rather than expired", () => {
    // Clock skew between app and database must not mass-reclaim live jobs.
    expect(leaseExpired(new Date(now.getTime() + 60_000), now)).toBe(false);
  });
});
