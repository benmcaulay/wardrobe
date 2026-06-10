import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { User } from "@prisma/client";
import { getServerSession } from "next-auth";
import { prisma } from "./db";
import { authOptions } from "./auth-options";

export { DEMO_USER_COOKIE, DEMO_USER_EMAIL } from "./auth-shared";
import { DEMO_USER_COOKIE, DEMO_USER_EMAIL } from "./auth-shared";

/**
 * Demo mode is an explicit opt-in (AUTH_DEMO_MODE="true"): a single shared
 * user behind a plain cookie, for local dev and keyless demos. Never enable
 * it on a deployment with real users — the cookie is not a credential.
 */
export function demoModeEnabled(): boolean {
  return process.env.AUTH_DEMO_MODE === "true";
}

/**
 * Returns the demo user (creating it on first run). Only meaningful in demo
 * mode; the /api/demo/enter route guards on demoModeEnabled().
 */
export async function getOrCreateDemoUser(): Promise<User> {
  const existing = await prisma.user.findUnique({ where: { email: DEMO_USER_EMAIL } });
  if (existing) return existing;
  return prisma.user.create({
    // 250 credits ≈ $10 at ~$0.03-0.04 per fal.ai generation.
    data: { email: DEMO_USER_EMAIL, name: "Demo", credits: 250 },
  });
}

/**
 * Reads the current user: a real NextAuth session first, then (in demo mode
 * only) the demo cookie. Returns null when neither is present — callers that
 * need a user should use requireUser() instead.
 */
export async function getCurrentUser(): Promise<User | null> {
  const session = await getServerSession(authOptions);
  const sessionUserId = (session?.user as { id?: string } | undefined)?.id;
  if (sessionUserId) {
    return prisma.user.findUnique({ where: { id: sessionUserId } });
  }
  if (demoModeEnabled()) {
    const uid = cookies().get(DEMO_USER_COOKIE)?.value;
    if (uid) return prisma.user.findUnique({ where: { id: uid } });
  }
  return null;
}

/**
 * Route guard for server components and server actions. Redirects to the
 * landing page when there's no active session.
 */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  return user;
}
