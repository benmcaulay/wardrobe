/**
 * Generation worker process. Run alongside the web server:
 *   pnpm worker
 *
 * Polls the GenerationJob queue and executes jobs (virtual try-on today). Safe
 * to run multiple instances — jobs are claimed with FOR UPDATE SKIP LOCKED.
 */
import { runWorker } from "../lib/jobs/worker";

let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    if (stopping) process.exit(1); // second signal forces exit
    stopping = true;
    console.log(`\n[worker] ${sig} received — finishing current drain, then exiting…`);
  });
}

runWorker({
  pollMs: Number(process.env.WORKER_POLL_MS) || 2000,
  shouldStop: () => stopping,
})
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[worker] fatal:", err);
    process.exit(1);
  });
