/**
 * Env readers that treat a present-but-empty variable as absent.
 *
 * `.env.example` ships every optional knob as `NAME=""` so the file documents
 * the full surface without turning anything on. Copying it to `.env` therefore
 * leaves those names *defined and empty* — and the obvious parsing idioms all
 * mishandle that:
 *
 *   Number("")                      -> 0     (not NaN, so isFinite passes)
 *   process.env.X ?? fallback       -> ""    (?? only catches null/undefined)
 *
 * Both silently substitute a wrong value for the intended default: a quota of
 * 0 blocks every generation, a model id of "" can't be called. `||` and
 * `Number.isFinite` guards get this right by accident, which is why some call
 * sites were correct and others weren't. These helpers make it deliberate:
 * empty or whitespace-only means "not set", so the fallback wins.
 */

/** Raw string value, or undefined when unset/empty/whitespace-only. */
export function strEnv(name: string): string | undefined;
export function strEnv(name: string, fallback: string): string;
export function strEnv(name: string, fallback?: string): string | undefined {
  const trimmed = process.env[name]?.trim();
  return trimmed ? trimmed : fallback;
}

/**
 * Finite number from env, else `fallback`. An explicit "0" is honored — only
 * absent, empty, and unparseable values fall back.
 */
export function numEnv(name: string, fallback: number): number {
  const raw = strEnv(name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Non-negative integer from env, else `fallback`. Fractions are floored;
 * negatives are rejected as junk. An explicit "0" is honored, so a quota can
 * still be deliberately set to zero.
 */
export function intEnv(name: string, fallback: number): number {
  const n = numEnv(name, fallback);
  return n >= 0 ? Math.floor(n) : fallback;
}

/**
 * Boolean from env, case-insensitive. Only an explicit "true"/"false" decides;
 * anything else (absent, empty, junk) takes `fallback`. The fallback matters
 * because the codebase has both opt-in flags (default false) and opt-out flags
 * written as `!== "false"` (default true).
 */
export function boolEnv(name: string, fallback = false): boolean {
  const raw = strEnv(name)?.toLowerCase();
  if (raw === "true") return true;
  if (raw === "false") return false;
  return fallback;
}
