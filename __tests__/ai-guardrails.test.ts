import { describe, it, expect, afterEach } from "vitest";
import { decideQuota, quotaLimits, startOfUtcDay } from "../lib/ai-guardrails";

const ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ENV };
});

const limits = {
  disabled: false,
  perUserDaily: 200,
  globalDaily: 1000,
  perUserDailySpend: 10_000,
  globalDailySpend: 50_000,
};

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
    expect(quotaLimits()).toEqual({
      disabled: false,
      perUserDaily: 200,
      globalDaily: 1000,
      perUserDailySpend: 10_000,
      globalDailySpend: 50_000,
    });
  });

  it("reads env overrides and the kill switch", () => {
    process.env.AI_DAILY_LIMIT_PER_USER = "10";
    process.env.AI_DAILY_LIMIT_GLOBAL = "50";
    process.env.AI_GENERATIONS_DISABLED = "true";
    expect(quotaLimits()).toEqual({
      disabled: true,
      perUserDaily: 10,
      globalDaily: 50,
      perUserDailySpend: 10_000,
      globalDailySpend: 50_000,
    });
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
    expect(quotaLimits()).toEqual({
      disabled: false,
      perUserDaily: 200,
      globalDaily: 1000,
      perUserDailySpend: 10_000,
      globalDailySpend: 50_000,
    });
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

describe("decideQuota spend limits", () => {
  it("stops a user who has spent the daily budget, whatever the row count", () => {
    /*
     * The reason spend exists alongside counts. A row cap assumes every
     * generation costs the same; lib/ai-costs.ts prices them from $0.039 to
     * $0.134, so 200 rows is anywhere from $7.80 to $26.80.
     */
    expect(decideQuota(limits, 5, 5, 10_000, 0).ok).toBe(false);
    expect(decideQuota(limits, 5, 5, 9_999, 0)).toEqual({ ok: true });
  });

  it("stops the whole service at the global spend ceiling", () => {
    const d = decideQuota(limits, 1, 1, 0, 50_000);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error).toMatch(/overall generation limit/i);
  });

  it("still allows a user well inside both budgets", () => {
    expect(decideQuota(limits, 10, 20, 500, 2_000)).toEqual({ ok: true });
  });

  it("treats omitted spend as zero, so existing callers are unaffected", () => {
    expect(decideQuota(limits, 0, 0)).toEqual({ ok: true });
    expect(decideQuota(limits, 199, 999)).toEqual({ ok: true });
  });

  it("prefers the per-user message when count and spend both trip", () => {
    // Either way nothing generates; the friendlier one should surface.
    const d = decideQuota(limits, 200, 0, 99_999, 0);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error).toMatch(/you've reached today's generation limit/i);
  });

  it("the kill switch still beats everything", () => {
    expect(decideQuota({ ...limits, disabled: true }, 0, 0, 0, 0).ok).toBe(false);
  });
});

describe("spend defaults", () => {
  it("bounds a day's worst case in dollars, not rows", () => {
    const l = quotaLimits();
    // Ghosts are 67 tenth-cents each (lib/ai-costs.ts).
    expect(l.perUserDailySpend / 67).toBeLessThan(l.perUserDaily);
    expect(l.globalDailySpend / 67).toBeLessThan(l.globalDaily);
  });

  it("is env-tunable", () => {
    process.env.AI_DAILY_SPEND_PER_USER = "250";
    process.env.AI_DAILY_SPEND_GLOBAL = "900";
    const l = quotaLimits();
    expect(l.perUserDailySpend).toBe(250);
    expect(l.globalDailySpend).toBe(900);
  });
});

describe("spend limits inherit the empty-value protection", () => {
  /**
   * The same trap the count limits already fell into: .env.example ships these
   * as NAME="", Number("") is 0 (not NaN), and a spend cap of 0 refuses every
   * generation with a "reached today's limit" message on a fresh clone.
   */
  it("treats a present-but-empty value as unset, not as a freeze", () => {
    process.env.AI_DAILY_SPEND_PER_USER = "";
    process.env.AI_DAILY_SPEND_GLOBAL = "";
    const l = quotaLimits();
    expect(l.perUserDailySpend).toBe(10_000);
    expect(l.globalDailySpend).toBe(50_000);
    expect(decideQuota(l, 0, 0, 0, 0)).toEqual({ ok: true });
  });

  it("honors an explicit zero as a deliberate freeze", () => {
    process.env.AI_DAILY_SPEND_PER_USER = "0";
    expect(decideQuota(quotaLimits(), 0, 0, 0, 0).ok).toBe(false);
  });
});
