import { afterEach, describe, expect, it } from "vitest";
import { demoModeEnabled } from "../lib/auth-shared";

const original = { node: process.env.NODE_ENV, demo: process.env.AUTH_DEMO_MODE };

function setEnv(nodeEnv: string | undefined, demo: string | undefined) {
  // NODE_ENV is readonly in the types but writable at runtime; tests need it.
  (process.env as Record<string, string | undefined>).NODE_ENV = nodeEnv;
  (process.env as Record<string, string | undefined>).AUTH_DEMO_MODE = demo;
}

afterEach(() => setEnv(original.node, original.demo));

describe("demoModeEnabled", () => {
  it("refuses in production even when the env var says otherwise", () => {
    /*
     * The whole point. Demo mode signs any visitor into one shared account
     * with 1,000,000 credits behind a plain cookie. Setting AUTH_DEMO_MODE on
     * a host — by habit, by copying .env.example, by a template default —
     * must not be enough to open that door.
     */
    setEnv("production", "true");
    expect(demoModeEnabled()).toBe(false);
  });

  it("is off in production regardless of the flag", () => {
    for (const flag of ["true", "false", "1", undefined]) {
      setEnv("production", flag);
      expect(demoModeEnabled(), `AUTH_DEMO_MODE=${flag}`).toBe(false);
    }
  });

  it("still works for local development", () => {
    setEnv("development", "true");
    expect(demoModeEnabled()).toBe(true);
    setEnv("test", "true");
    expect(demoModeEnabled()).toBe(true);
  });

  it("stays off outside production unless explicitly enabled", () => {
    for (const flag of [undefined, "", "false", "TRUE", "yes", "1"]) {
      setEnv("development", flag);
      expect(demoModeEnabled(), `AUTH_DEMO_MODE=${flag}`).toBe(false);
    }
  });
});
