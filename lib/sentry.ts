/**
 * Server-side Sentry error forwarding. Inert unless SENTRY_DSN is set, so dev,
 * CI, and self-hosters pay zero cost. Deliberately server-only (@sentry/node
 * via lazy import) rather than the full @sentry/nextjs wizard setup: the
 * highest-value surface is server actions + provider calls (where money is
 * spent and failures hide); browser capture can be layered on later.
 */

type SentryModule = typeof import("@sentry/node");

let initPromise: Promise<SentryModule | null> | null = null;

function getSentry(): Promise<SentryModule | null> {
  if (!process.env.SENTRY_DSN?.trim()) return Promise.resolve(null);
  if (!initPromise) {
    initPromise = import("@sentry/node")
      .then((Sentry) => {
        Sentry.init({
          dsn: process.env.SENTRY_DSN,
          environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
          tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
        });
        return Sentry;
      })
      .catch(() => null);
  }
  return initPromise;
}

/** Fire-and-forget capture; never throws, never blocks the caller. */
export function captureError(event: string, err: unknown, context?: Record<string, unknown>): void {
  if (!process.env.SENTRY_DSN?.trim()) return;
  void getSentry().then((Sentry) => {
    if (!Sentry) return;
    Sentry.withScope((scope) => {
      scope.setTag("event", event);
      if (context) scope.setContext("fields", context as Record<string, unknown>);
      if (err instanceof Error) Sentry.captureException(err);
      else Sentry.captureMessage(`${event}: ${err != null ? String(err) : "error"}`, "error");
    });
  });
}
