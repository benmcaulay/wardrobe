/**
 * Turn a job row into something a waiting human can read.
 *
 * A spinner answers "is it done?" and nothing else. The queue already records
 * enough to answer the questions actually being asked — has anything picked
 * this up, is it still going, has it failed and quietly gone round again — and
 * this is where those columns become a sentence.
 *
 * Pure so the wording is testable: it takes `now` rather than reading the
 * clock, and never touches the database.
 */
import { JOB_LEASE_MINUTES, leaseExpired, willRetry, type GenerationJobStatus } from "./queue";

/**
 * How long a job may sit unclaimed before the wait itself is the news.
 *
 * The inline drain claims within a second or two when it runs at all, so past
 * this the honest answer is not "starting soon", it is "nothing has taken
 * this".
 */
export const PICKUP_GRACE_MS = 30_000;

export type JobProgressState =
  | "queued" // waiting, and that is still normal
  | "unclaimed" // waiting too long; no worker has taken it
  | "working" // a worker holds a live lease
  | "retrying" // an attempt failed, another is due
  | "stalled" // a worker took it and stopped; a retry is still possible
  | "abandoned" // a worker took it and stopped, with no retries left
  | "succeeded"
  | "failed";

export type JobProgressInput = {
  status: GenerationJobStatus;
  createdAt: Date;
  updatedAt: Date;
  attempts: number;
  maxAttempts: number;
  /** Last error, which the queue keeps set while a job waits to retry. */
  error?: string | null;
};

export type JobProgress = {
  state: JobProgressState;
  /** One sentence for the user. Already includes elapsed time where it helps. */
  message: string;
  elapsedMs: number;
  /** Whether simply waiting is still the right thing to do. A spinner should follow this, not `status`. */
  active: boolean;
};

/** "12s" / "4m" / "1h 20m" — short enough to sit inside a sentence. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total}s`;
  const minutes = Math.round(total / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** Trim a worker error down to something that fits in a status line. */
function shorten(error: string | null | undefined): string {
  const text = (error ?? "").trim().replace(/\s+/g, " ");
  if (!text) return "";
  return text.length > 120 ? `${text.slice(0, 119)}…` : text;
}

export function describeJobProgress(
  job: JobProgressInput,
  now: Date,
  leaseMinutes = JOB_LEASE_MINUTES,
): JobProgress {
  const elapsedMs = now.getTime() - job.createdAt.getTime();
  const elapsed = formatElapsed(elapsedMs);
  const attemptOf = `attempt ${Math.max(1, job.attempts)} of ${job.maxAttempts}`;

  if (job.status === "succeeded") {
    return { state: "succeeded", message: `Finished in ${elapsed}.`, elapsedMs, active: false };
  }

  if (job.status === "failed") {
    const why = shorten(job.error);
    return {
      state: "failed",
      message: why ? `Failed after ${elapsed}: ${why}` : `Failed after ${elapsed}.`,
      elapsedMs,
      active: false,
    };
  }

  if (job.status === "running") {
    // A live lease is the only evidence that anything is actually working.
    // Past it the worker is gone — serverless freezes the moment it responds,
    // so this is the normal way a render dies, not an exotic one.
    if (!leaseExpired(job.updatedAt, now, leaseMinutes)) {
      return {
        state: "working",
        message: `Rendering now — ${elapsed} so far (${attemptOf}).`,
        elapsedMs,
        active: true,
      };
    }
    if (willRetry(job.attempts, job.maxAttempts)) {
      return {
        state: "stalled",
        message: `The worker stopped partway through ${attemptOf}. It goes back in the queue on the next sweep.`,
        elapsedMs,
        active: false,
      };
    }
    return {
      state: "abandoned",
      message: `The worker stopped and there are no attempts left. This will be marked failed on the next sweep.`,
      elapsedMs,
      active: false,
    };
  }

  // Queued. A retry lands back here with the previous error still attached,
  // which is the difference between "not started yet" and "already failed
  // twice" — and the UI showed the same spinner for both.
  if (job.attempts > 0) {
    const why = shorten(job.error);
    return {
      state: "retrying",
      message: why
        ? `Attempt ${job.attempts} of ${job.maxAttempts} failed (${why}). Waiting to retry.`
        : `Attempt ${job.attempts} of ${job.maxAttempts} failed. Waiting to retry.`,
      elapsedMs,
      active: false,
    };
  }

  if (elapsedMs > PICKUP_GRACE_MS) {
    return {
      state: "unclaimed",
      message: `Queued ${elapsed} ago and nothing has picked it up yet.`,
      elapsedMs,
      active: false,
    };
  }

  return { state: "queued", message: "Queued — waiting to start.", elapsedMs, active: true };
}
