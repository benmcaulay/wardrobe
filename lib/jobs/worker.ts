/**
 * Worker loop logic, separated from the CLI entry (scripts/worker.ts) so it's
 * importable + testable. `drainOnce` runs all currently-runnable jobs and
 * returns — usable from a serverless cron too; `runWorker` is the long-lived
 * polling loop for a dedicated worker process.
 */
import { claimNextJob, failExpiredJobs } from "./queue";
import { runJob } from "./runner";
import { log } from "../log";

/** Claim and run jobs until the queue is empty. Returns how many ran. */
export async function drainOnce(max = Infinity): Promise<number> {
  // Retire anything a dead worker abandoned past its retries, so no job can
  // sit in "running" forever with the UI showing it as still in flight.
  await failExpiredJobs().catch((err) => log.error("jobs.lease-sweep.failed", err));
  let ran = 0;
  while (ran < max) {
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
