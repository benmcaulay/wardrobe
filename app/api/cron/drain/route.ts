/**
 * Drain the job queue. The worker, for a platform that cannot run one.
 *
 * `pnpm worker` is a long-lived polling process and Vercel has nowhere to put
 * it, so on serverless this endpoint is the worker and Vercel Cron is the
 * poll. Everything else stays identical — same claim, same lease, same
 * `runJob` — because a second implementation of the queue is how the two
 * quietly diverge.
 *
 * `kickJobDrain` does not cover this. It is fire-and-forget after the
 * response, and a serverless function can be frozen the instant it responds,
 * so work started that way may simply never finish.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET` when that
 * variable is set. Without a secret configured the route refuses rather than
 * running open — draining costs real Gemini credits, so an unauthenticated
 * caller could burn the key.
 */

import { NextResponse, type NextRequest } from "next/server";
import { drainOnce } from "@/lib/jobs/worker";
import { log } from "@/lib/log";
import { strEnv } from "@/lib/env";

/**
 * Ceiling on one invocation, in seconds. Must stay under the platform's own
 * limit — Vercel kills at `maxDuration` (see vercel.json) with no warning.
 */
export const maxDuration = 300;

/** Stop starting jobs with time to spare, so the last one can finish cleanly. */
const DRAIN_BUDGET_MS = 240_000;

/** One ghost generation is ~12-48s with a 120s ceiling; a handful per run. */
const MAX_JOBS_PER_RUN = 8;

export async function GET(req: NextRequest) {
  const secret = strEnv("CRON_SECRET");
  if (!secret) {
    log.error("cron.drain.no-secret", new Error("CRON_SECRET is not set"));
    return new NextResponse("CRON_SECRET is not configured", { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const startedAt = Date.now();
  try {
    const ran = await drainOnce({ max: MAX_JOBS_PER_RUN, budgetMs: DRAIN_BUDGET_MS });
    const ms = Date.now() - startedAt;
    log.info("cron.drain.done", { ran, ms });
    // `ran === MAX_JOBS_PER_RUN` means the queue may still hold work; the next
    // tick picks it up rather than this invocation running to the deadline.
    return NextResponse.json({ ok: true, ran, ms, more: ran === MAX_JOBS_PER_RUN });
  } catch (err) {
    log.error("cron.drain.failed", err);
    return NextResponse.json({ ok: false, error: "Drain failed" }, { status: 500 });
  }
}
