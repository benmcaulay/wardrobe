/**
 * Who is allowed to sign in.
 *
 * The deployment is a public URL with public Google sign-in, and every account
 * that gets created draws on one shared, metered Gemini budget. The caps in
 * lib/ai-guardrails.ts bound what a single account can burn in a day; they do
 * nothing to stop a stranger from opening the account in the first place. This
 * is the gate that does.
 *
 * Unset means no restriction. That is deliberate — local development and the
 * test suite must not need a roster — so a host that should be private has to
 * say so explicitly by setting AUTH_ALLOWED_EMAILS.
 *
 * Comparison is on the lowercased, trimmed address. Google normalises the
 * casing of what it returns, but the value here is hand-typed into a hosting
 * dashboard, so it is the side likely to carry a stray capital or space.
 */

/** Parse the comma-separated env value. Empty and blank entries are dropped. */
export function parseAllowedEmails(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

/**
 * True when this address may sign in.
 *
 * An empty roster allows everyone (see above). A non-empty roster rejects an
 * absent email rather than letting it through: a provider that returns no
 * address cannot be checked against a list, and "cannot be checked" must not
 * mean "allowed" once the operator has asked for a restriction.
 */
export function emailAllowed(
  email: string | undefined | null,
  raw: string | undefined | null,
): boolean {
  const allowed = parseAllowedEmails(raw);
  if (allowed.length === 0) return true;
  if (!email) return false;
  return allowed.includes(email.trim().toLowerCase());
}
