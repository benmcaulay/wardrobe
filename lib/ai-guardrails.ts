/**
 * Cost guardrails for AI generation. Three layers, all env-tunable:
 *
 *  - Kill switch: AI_GENERATIONS_DISABLED="true" refuses every generation
 *    (emergency brake when a provider misbehaves or spend runs away).
 *  - Per-user daily quota: AI_DAILY_LIMIT_PER_USER (default 200).
 *  - Global daily quota: AI_DAILY_LIMIT_GLOBAL (default 1000).
 *
 * Quotas count today's logged generations (TryOnGeneration + VirtualTryOn
 * rows, UTC day) — no schema change, and failed provider calls (which aren't
 * billed or logged) don't consume quota. Defaults are deliberately generous so
 * stub-mode dev never notices; tighten them in production .env.
 */
import { prisma } from "./db";

export type QuotaDecision = { ok: true } | { ok: false; error: string };

export type QuotaLimits = {
  disabled: boolean;
  perUserDaily: number;
  globalDaily: number;
};

function intEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export function quotaLimits(): QuotaLimits {
  return {
    disabled: process.env.AI_GENERATIONS_DISABLED === "true",
    perUserDaily: intEnv("AI_DAILY_LIMIT_PER_USER", 200),
    globalDaily: intEnv("AI_DAILY_LIMIT_GLOBAL", 1000),
  };
}

/** Pure decision given today's usage counts — unit-tested separately from Prisma. */
export function decideQuota(
  limits: QuotaLimits,
  userCountToday: number,
  globalCountToday: number,
): QuotaDecision {
  if (limits.disabled) {
    return { ok: false, error: "AI generation is temporarily disabled. Please try again later." };
  }
  if (userCountToday >= limits.perUserDaily) {
    return { ok: false, error: "You've reached today's generation limit. Try again tomorrow." };
  }
  if (globalCountToday >= limits.globalDaily) {
    return {
      ok: false,
      error: "The service has reached today's overall generation limit. Please try again later.",
    };
  }
  return { ok: true };
}

export function startOfUtcDay(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Gate to call before any credit-spending generation. Counts both generation
 * tables in one round trip per table; cheap (indexed by userId, small ranges).
 */
export async function checkAiQuota(userId: string): Promise<QuotaDecision> {
  const limits = quotaLimits();
  if (limits.disabled) return decideQuota(limits, 0, 0);

  const since = startOfUtcDay();
  const [userGhost, userTryOn, globalGhost, globalTryOn] = await Promise.all([
    prisma.tryOnGeneration.count({ where: { userId, createdAt: { gte: since } } }),
    prisma.virtualTryOn.count({ where: { userId, createdAt: { gte: since } } }),
    prisma.tryOnGeneration.count({ where: { createdAt: { gte: since } } }),
    prisma.virtualTryOn.count({ where: { createdAt: { gte: since } } }),
  ]);
  return decideQuota(limits, userGhost + userTryOn, globalGhost + globalTryOn);
}
