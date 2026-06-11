/**
 * Structured logger for the server. One JSON object per line so any log
 * platform (Datadog, Loki, CloudWatch, Vercel) can parse without grok rules.
 *
 * log.error also forwards to Sentry when SENTRY_DSN is configured (see
 * lib/sentry.ts) so operational errors alert without each call site caring.
 */
import { captureError } from "./sentry";

type Fields = Record<string, unknown>;

function emit(level: "info" | "warn" | "error", event: string, fields: Fields = {}): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...fields,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info(event: string, fields?: Fields): void {
    emit("info", event, fields);
  },
  warn(event: string, fields?: Fields): void {
    emit("warn", event, fields);
  },
  /** `err` is serialized to message (+ forwarded to Sentry with the event/fields as context). */
  error(event: string, err?: unknown, fields?: Fields): void {
    const message = err instanceof Error ? err.message : err != null ? String(err) : undefined;
    emit("error", event, { ...fields, ...(message ? { error: message } : {}) });
    captureError(event, err, fields);
  },
};
