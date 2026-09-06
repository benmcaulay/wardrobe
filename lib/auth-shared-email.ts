/**
 * Whether magic-link sign-in can actually run.
 *
 * Both halves are required and both are commonly half-set: a transport with no
 * From address produces a 550 from most providers, and a From address with no
 * transport fails at send time — in each case *after* the user has typed their
 * address and been told to check their inbox. Checking up front lets the
 * landing page say "not configured" instead of silently swallowing sign-ins.
 *
 * Empty strings count as unset. That is not defensive coding for its own sake:
 * this deployment's first three failures were all variables that existed with
 * empty values, which `??` does not catch.
 */
export function emailAuthConfigured(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return Boolean(env.EMAIL_SERVER?.trim() && env.EMAIL_FROM?.trim());
}
