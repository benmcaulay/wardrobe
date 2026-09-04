/**
 * Cost guardrails for AI generation. All env-tunable:
 *
 *  - Kill switch: AI_GENERATIONS_DISABLED="true" refuses every generation
 *    (emergency brake when a provider misbehaves or spend runs away).
 *  - Per-user daily count:  AI_DAILY_LIMIT_PER_USER (default 200).
 *  - Global daily count:    AI_DAILY_LIMIT_GLOBAL (default 1000).
 *  - Per-user daily spend:  AI_DAILY_SPEND_PER_USER (tenth-cents, default 10_000 = $10).
 *  - Global daily spend:    AI_DAILY_SPEND_GLOBAL   (tenth-cents, default 50_000 = $50).
 *
 * Counts and spend are both enforced, and spend is the one that actually
 * bounds the bill. A row limit assumes every generation costs the same, and
 * they do not: lib/ai-costs.ts prices gemini-2.5-flash-image at $0.039 and
 * gemini-3-pro-image at $0.134. Under a 200-row cap, switching model quietly
 * moves the worst case from $7.80 to $26.80 per user per day. A spend cap does
 * not move.
 *
 * Both read today's logged generations (TryOnGeneration + VirtualTryOn, UTC
 * day) — no schema change, and failed provider calls, which are never billed
 * or logged, consume neither.
 *
 * What this does NOT cover: camera-roll classification. Those are Gemini
 * vision calls with no ledger row, so they are invisible here. They are also
 * ~200x cheaper than a ghost (fractions of a cent against $0.067) and bounded
 * per job by MAX_SCAN_PHOTOS, with a separate daily cap on scan jobs below.
 */
import { prisma } from "./db";
import { intEnv, boolEnv } from "./env";

export type QuotaDecision = { ok: true } | { ok: false; error: string };

export type QuotaLimits = {
  disabled: boolean;
  perUserDaily: number;
  globalDaily: number;
  /** Tenth-cents, matching lib/ai-costs.ts. */
  perUserDailySpend: number;
  globalDailySpend: number;
};

/** Camera-roll scan jobs one user may start per day. */
export function scanJobDailyLimit(): number {
  return intEnv("AI_DAILY_SCANS_PER_USER", 20);
}

export function quotaLimits(): QuotaLimits {
  return {
    disabled: boolEnv("AI_GENERATIONS_DISABLED"),
    perUserDaily: intEnv("AI_DAILY_LIMIT_PER_USER", 200),
    globalDaily: intEnv("AI_DAILY_LIMIT_GLOBAL", 1000),
    perUserDailySpend: intEnv("AI_DAILY_SPEND_PER_USER", 10_000),
    globalDailySpend: intEnv("AI_DAILY_SPEND_GLOBAL", 50_000),
  };
}

/** Pure decision given today's usage counts — unit-tested separately from Prisma. */
export function decideQuota(
  limits: QuotaLimits,
  userCountToday: number,
  globalCountToday: number,
  userSpendToday = 0,
  globalSpendToday = 0,
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
  // Spend is checked after counts so the friendlier count message wins when
  // both trip at once; either way nothing is generated.
  if (userSpendToday >= limits.perUserDailySpend) {
    return { ok: false, error: "You've reached today's generation limit. Try again tomorrow." };
  }
  if (globalSpendToday >= limits.globalDailySpend) {
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
  // _sum returns null for an empty range, hence the ?? 0 on every branch.
  const [userGhost, userTryOn, globalGhost, globalTryOn] = await Promise.all([
    prisma.tryOnGeneration.aggregate({
      where: { userId, createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { costTenthCents: true },
    }),
    prisma.virtualTryOn.aggregate({
      where: { userId, createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { costTenthCents: true },
    }),
    prisma.tryOnGeneration.aggregate({
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { costTenthCents: true },
    }),
    prisma.virtualTryOn.aggregate({
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { costTenthCents: true },
    }),
  ]);

  return decideQuota(
    limits,
    userGhost._count._all + userTryOn._count._all,
    globalGhost._count._all + globalTryOn._count._all,
    (userGhost._sum.costTenthCents ?? 0) + (userTryOn._sum.costTenthCents ?? 0),
    (globalGhost._sum.costTenthCents ?? 0) + (globalTryOn._sum.costTenthCents ?? 0),
  );
}

/**
 * Gate before starting a camera-roll scan.
 *
 * Classification has no ledger row, so `checkAiQuota` cannot see it. Counting
 * scan *jobs* bounds it without a schema change: each job is capped at
 * MAX_SCAN_PHOTOS photos, so N jobs is a hard ceiling on classifier calls.
 * Counted from GenerationJob rows that already exist.
 */
export async function checkScanQuota(userId: string): Promise<QuotaDecision> {
  const limits = quotaLimits();
  if (limits.disabled) return decideQuota(limits, 0, 0);

  const startedToday = await prisma.generationJob.count({
    where: { userId, type: "camera_roll_scan", createdAt: { gte: startOfUtcDay() } },
  });
  if (startedToday >= scanJobDailyLimit()) {
    return { ok: false, error: "You've reached today's scan limit. Try again tomorrow." };
  }
  return { ok: true };
}
