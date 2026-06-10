import { redirect } from "next/navigation";
import { getCurrentUser, demoModeEnabled } from "@/lib/auth";
import { GoogleSignInButton } from "@/components/google-signin-button";

export default async function LandingPage() {
  // Verify the user actually exists in the DB rather than trusting the cookie.
  // After a `pnpm db:reset` (or any wipe) a stale cookie would otherwise loop:
  // / → /closet → requireUser() finds nothing → / → /closet → …
  const user = await getCurrentUser();
  if (user) redirect("/closet");

  const demo = demoModeEnabled();
  const googleConfigured = Boolean(process.env.GOOGLE_CLIENT_ID);

  return (
    <main className="min-h-dvh flex items-center justify-center px-6">
      <div className="max-w-lg text-center space-y-8">
        <h1 className="font-serif text-5xl tracking-tight">Wardrobe</h1>
        <p className="text-ink-muted text-lg leading-relaxed">
          Your personal digital closet. Upload what you own, see it organized,
          and turn flat photos into clean ghost-mannequin product shots.
        </p>
        <div className="flex flex-col items-center gap-3">
          {googleConfigured && <GoogleSignInButton />}
          {demo && (
            <form action="/api/demo/enter" method="post">
              <button
                type="submit"
                className={
                  googleConfigured
                    ? "rounded-full border border-ink/15 px-8 py-3 text-sm tracking-wide hover:bg-paper-warm transition"
                    : "rounded-full bg-ink text-paper px-8 py-3 text-sm tracking-wide hover:bg-ink-soft transition"
                }
              >
                Enter demo
              </button>
            </form>
          )}
          {!googleConfigured && !demo && (
            <p className="text-sm text-ink-muted">
              No sign-in method is configured. Set GOOGLE_CLIENT_ID /
              GOOGLE_CLIENT_SECRET, or AUTH_DEMO_MODE=&quot;true&quot; for a
              local demo.
            </p>
          )}
        </div>
        {demo && !googleConfigured && (
          <p className="text-xs text-ink-muted">
            Demo mode — everything stays on this machine.
          </p>
        )}
      </div>
    </main>
  );
}
