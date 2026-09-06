import { redirect } from "next/navigation";
import type { User } from "@prisma/client";
import { getCurrentUser, demoModeEnabled } from "@/lib/auth";
import { emailAuthConfigured } from "@/lib/auth-shared-email";
import { LandingHero } from "@/app/landing-hero";

export default async function LandingPage() {
  // Verify the user actually exists in the DB rather than trusting the cookie.
  // After a `pnpm db:reset` (or any wipe) a stale cookie would otherwise loop:
  // / → /closet → requireUser() finds nothing → / → /closet → …
  let user: User | null = null;
  try {
    user = await getCurrentUser();
  } catch {
    // DB down (e.g. local Postgres not running) — still show the landing.
  }
  if (user) redirect("/closet");

  const demo = demoModeEnabled();
  const emailConfigured = emailAuthConfigured();

  return (
    <LandingHero demo={demo} emailConfigured={emailConfigured} />
  );
}
