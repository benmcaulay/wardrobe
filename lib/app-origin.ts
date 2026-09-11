/**
 * The origin this deployment serves from.
 *
 * NEXTAUTH_URL is the authority: it is already what NextAuth builds its
 * callback URLs from, so anything validating one has to agree with it or the
 * check is against a different site than the links point at.
 */
export function appOrigin(): string {
  const raw =
    process.env.NEXTAUTH_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    "http://localhost:3000";
  try {
    return new URL(raw).origin;
  } catch {
    return "http://localhost:3000";
  }
}
