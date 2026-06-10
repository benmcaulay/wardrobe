/**
 * Pure auth constants split from lib/auth.ts so the edge middleware can
 * import them without pulling prisma / next-auth into its bundle (same
 * pattern as ghost-mannequin-shared.ts).
 */

export const DEMO_USER_COOKIE = "wardrobe_demo_uid";
export const DEMO_USER_EMAIL = "demo@local.test";
