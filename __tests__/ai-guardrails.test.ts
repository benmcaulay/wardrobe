import { describe, it, expect, afterEach } from "vitest";
import { decideQuota, quotaLimits, startOfUtcDay } from "../lib/ai-guardrails";

const ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ENV };
});

const limits = { disabled: false, perUserDaily: 200, globalDaily: 1000 };

describe("decideQuota", () => {
  it("allows under both limits", () => {
    expect(decideQuota(limits, 0, 0)).toEqual({ ok: true });
    expect(decideQuota(limits, 199, 999)).toEqual({ ok: true });
  });

  it("refuses at the per-user limit", () => {
    const d = decideQuota(limits, 200, 200);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error).toMatch(/generation limit/i);
  });

  it("refuses at the global limit even when the user is under theirs", () => {
    const d = decideQuota(limits, 3, 1000);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error).toMatch(/overall/i);
  });

  it("kill switch beats everything", () => {
    const d = decideQuota({ ...limits, disabled: true }, 0, 0);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error).toMatch(/temporarily disabled/i);
  });
});

describe("quotaLimits env parsing", () => {
  it("uses generous defaults", () => {
    delete process.env.AI_DAILY_LIMIT_PER_USER;
    delete process.env.AI_DAILY_LIMIT_GLOBAL;
    delete process.env.AI_GENERATIONS_DISABLED;
    expect(quotaLimits()).toEqual({ disabled: false, perUserDaily: 200, globalDaily: 1000 });
  });

  it("reads env overrides and the kill switch", () => {
    process.env.AI_DAILY_LIMIT_PER_USER = "10";
    process.env.AI_DAILY_LIMIT_GLOBAL = "50";
    process.env.AI_GENERATIONS_DISABLED = "true";
    expect(quotaLimits()).toEqual({ disabled: true, perUserDaily: 10, globalDaily: 50 });
  });

  it("ignores junk values", () => {
    process.env.AI_DAILY_LIMIT_PER_USER = "banana";
    process.env.AI_DAILY_LIMIT_GLOBAL = "-5";
    expect(quotaLimits().perUserDaily).toBe(200);
    expect(quotaLimits().globalDaily).toBe(1000);
  });

  /**
   * Regression: .env.example ships these as NAME="", and Number("") is 0 (not
   * NaN), so the old parser returned a quota of 0 — refusing every generation
   * on a fresh clone with the misleading "reached today's limit" message.
   */
  it("treats a present-but-empty value as unset, not as zero", () => {
    process.env.AI_DAILY_LIMIT_PER_USER = "";
    process.env.AI_DAILY_LIMIT_GLOBAL = "";
    process.env.AI_GENERATIONS_DISABLED = "";
    expect(quotaLimits()).toEqual({ disabled: false, perUserDaily: 200, globalDaily: 1000 });
  });

  it("still allows generation on a freshly copied .env.example", () => {
    process.env.AI_DAILY_LIMIT_PER_USER = "";
    process.env.AI_DAILY_LIMIT_GLOBAL = "";
    process.env.AI_GENERATIONS_DISABLED = "";
    expect(decideQuota(quotaLimits(), 0, 0)).toEqual({ ok: true });
  });

  it("honors an explicit zero as a deliberate freeze", () => {
    process.env.AI_DAILY_LIMIT_PER_USER = "0";
    expect(quotaLimits().perUserDaily).toBe(0);
    const d = decideQuota(quotaLimits(), 0, 0);
    expect(d.ok).toBe(false);
  });
});

describe("startOfUtcDay", () => {
  it("zeroes the time component in UTC", () => {
    const d = startOfUtcDay(new Date("2026-06-10T17:45:12.345Z"));
    expect(d.toISOString()).toBe("2026-06-10T00:00:00.000Z");
  });
});
