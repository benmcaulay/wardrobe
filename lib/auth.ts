import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { User } from "@prisma/client";
import { prisma } from "./db";

export const DEMO_USER_COOKIE = "wardrobe_demo_uid";
export const DEMO_USER_EMAIL = "demo@local.test";

/**
 * Returns the currently-active demo user (creating it on first run) and ensures
 * the cookie is set. Used by the /api/demo/enter route.
 */
export async function getOrCreateDemoUser(): Promise<User> {
  const existing = await prisma.user.findUnique({ where: { email: DEMO_USER_EMAIL } });
  if (existing) return existing;
  return prisma.user.create({
    // 250 credits ≈ $10 at ~$0.04 per fal.ai gemini-25-flash-image generation.
    data: { email: DEMO_USER_EMAIL, name: "Demo", credits: 250 },
  });
}

/**
 * Reads the current user from the cookie. Returns null when no demo session
 * is active — callers that need a user should use requireUser() instead.
 */
export async function getCurrentUser(): Promise<User | null> {
  const uid = cookies().get(DEMO_USER_COOKIE)?.value;
  if (!uid) return null;
  return prisma.user.findUnique({ where: { id: uid } });
}

/**
 * Route guard for server components and server actions. Redirects to the
 * landing page when there's no active demo user.
 */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  return user;
}
