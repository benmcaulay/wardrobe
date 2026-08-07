/**
 * Share-link tokens.
 *
 * The token is the *only* credential protecting a share, so it has to be
 * unguessable: 160 bits from a CSPRNG, base64url-encoded. That's the same
 * order of entropy as a session id, which is the right bar — anyone who can
 * guess one gets the contents.
 */

import crypto from "node:crypto";

const TOKEN_BYTES = 20; // 160 bits → 27 base64url chars
const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

export function generateShareToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString("base64url");
}

/**
 * Cheap shape check before touching the database, so obviously-bogus tokens
 * from crawlers never become a query.
 */
export function isValidShareTokenFormat(token: string): boolean {
  return TOKEN_RE.test(token);
}
