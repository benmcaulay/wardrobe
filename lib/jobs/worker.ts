/**
 * Worker loop logic, separated from the CLI entry (scripts/worker.ts) so it's
 * importable + testable. `drainOnce` runs all currently-runnable jobs and
 * returns — usable from a serverless cron too; `runWorker` is the long-lived
 * polling loop for a dedicated worker process.
 */
import { claimNextJob, failExpiredJobs } from "./queue";
import { runJob } from "./runner";
import { log } from "../log";

export type DrainOptions = {
  /** Stop after this many jobs. */
  max?: number;
  /**
   * Stop *starting* jobs once this many ms have elapsed.
   *
   * Serverless is the reason this exists. A platform kills the invocation at
   * its own deadline with no warning, and a job killed mid-flight stays
   * `running` until its lease expires — so the drain has to stop itself before
   * the platform does. The budget is checked before claiming, never mid-job,
   * because abandoning a half-finished generation is the thing being avoided.
   */
  budgetMs?: number;
};

/** Claim and run jobs until the queue is empty, the cap, or the budget. */
export async function drainOnce(options: number | DrainOptions = {}): Promise<number> {
  const { max = Infinity, budgetMs = Infinity } =
    typeof options === "number" ? { max: options } : options;

  // Retire anything a dead worker abandoned past its retries, so no job can
  // sit in "running" forever with the UI showing it as still in flight.
  await failExpiredJobs().catch((err) => log.error("jobs.lease-sweep.failed", err));

  const startedAt = Date.now();
  let ran = 0;
  while (ran < max) {
    if (Date.now() - startedAt >= budgetMs) {
      log.info("jobs.drain.budget-reached", { ran, budgetMs });
      break;
    }
    const job = await claimNextJob();
    if (!job) break;
    await runJob(job);
    ran += 1;
  }
  return ran;
}

export type WorkerOptions = {
  /** Idle poll interval when the queue is empty (ms). */
  pollMs?: number;
  /** Stop signal — return true to exit the loop after the current drain. */
  shouldStop?: () => boolean;
};

export async function runWorker(opts: WorkerOptions = {}): Promise<void> {
  const pollMs = opts.pollMs ?? 2000;
  const shouldStop = opts.shouldStop ?? (() => false);
  log.info("worker.started", { pollMs });
  while (!shouldStop()) {
    let ran = 0;
    try {
      ran = await drainOnce();
    } catch (err) {
      // claimNextJob itself failing (e.g. DB blip) shouldn't kill the worker.
      log.error("worker.drain.failed", err);
    }
    if (ran === 0) await new Promise((r) => setTimeout(r, pollMs));
  }
  log.info("worker.stopped");
}
