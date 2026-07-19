/**
 * Best-effort inline job drain when no dedicated worker process is running.
 * The worker (`pnpm worker`) is still the primary path in production; this
 * lets local dev and single-process deploys make progress without a second
 * terminal.
 */
import { log } from "../log";
import { drainOnce } from "./worker";

export function kickJobDrain(max = 3): void {
  void drainOnce(max).catch((err) => log.error("job.kick-drain.failed", err));
}
