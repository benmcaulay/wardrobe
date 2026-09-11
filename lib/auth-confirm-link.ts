/**
 * Interposing a human click between the emailed link and the sign-in callback.
 *
 * Mail providers prefetch links to scan them. Magic-link tokens are single
 * use, so the scanner spends the token, the session and cookie are created
 * *for the scanner*, and the person clicking arrives to a dead link and the
 * signed-out landing page. Measured on this deployment: the link was opened
 * 8 seconds after it was requested, which is a machine, not a person.
 *
 * So the email now points at a page that consumes nothing, and the real
 * callback runs only when someone presses the button on it. A scanner that
 * fetches the page finds an inert page.
 */

/** Where the email sends people instead of straight to the callback. */
export const CONFIRM_PATH = "/auth/confirm";

/** Query parameter carrying the real callback URL. */
export const CONFIRM_PARAM = "next";

/** Rewrite a NextAuth callback URL into a link that needs a click. */
export function confirmUrlFor(callbackUrl: string): string {
  const target = new URL(callbackUrl);
  const confirm = new URL(CONFIRM_PATH, target.origin);
  confirm.searchParams.set(CONFIRM_PARAM, callbackUrl);
  return confirm.toString();
}

/**
 * Accept the forwarded URL only if it is our own sign-in callback.
 *
 * The parameter arrives from a link and is therefore attacker-controllable;
 * without this the confirm page would forward a click anywhere, which is an
 * open redirect wearing the site's own domain — worse than the bug it fixes,
 * because the page exists to look trustworthy.
 */
export function safeCallbackUrl(raw: string | undefined, origin: string): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  let base: URL;
  try {
    base = new URL(origin);
  } catch {
    return null;
  }
  if (url.origin !== base.origin) return null;
  if (!url.pathname.startsWith("/api/auth/callback/")) return null;
  return url.toString();
}
