/**
 * Pure auth constants split from lib/auth.ts so the edge middleware can
 * import them without pulling prisma / next-auth into its bundle (same
 * pattern as ghost-mannequin-shared.ts).
 */

export const DEMO_USER_COOKIE = "wardrobe_demo_uid";
export const DEMO_USER_EMAIL = "demo@local.test";

/**
 * Whether the keyless demo login is available.
 *
 * Demo mode signs anyone who clicks a button into ONE shared account holding
 * 1,000,000 credits — no password, no email, a plain cookie. That is a fine
 * way to run the app on a laptop and a hole in a deployment: every visitor
 * lands in the same closet, can delete each other's clothes, and spends the
 * same Gemini key.
 *
 * So the env var alone is not enough to open it. Production refuses outright,
 * and there is deliberately no override — a demo that real people can reach
 * needs its own throwaway account per visitor, which is a different feature,
 * not this cookie with the guard removed.
 *
 * Lives here rather than in lib/auth.ts because the edge middleware needs the
 * same answer and cannot import prisma or next-auth.
 */
export function demoModeEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return process.env.AUTH_DEMO_MODE === "true";
}
