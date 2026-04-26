import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export default async function LandingPage() {
  // Verify the user actually exists in the DB rather than trusting the cookie.
  // After a `pnpm db:reset` (or any wipe) a stale cookie would otherwise loop:
  // / → /closet → requireUser() finds nothing → / → /closet → …
  const user = await getCurrentUser();
  if (user) redirect("/closet");

  return (
    <main className="min-h-dvh flex items-center justify-center px-6">
      <div className="max-w-lg text-center space-y-8">
        <h1 className="font-serif text-5xl tracking-tight">Wardrobe</h1>
        <p className="text-ink-muted text-lg leading-relaxed">
          Your personal digital closet. Upload what you own, see it organized,
          and turn flat photos into clean ghost-mannequin product shots.
        </p>
        <form action="/api/demo/enter" method="post">
          <button
            type="submit"
            className="rounded-full bg-ink text-paper px-8 py-3 text-sm tracking-wide hover:bg-ink-soft transition"
          >
            Enter demo
          </button>
        </form>
        <p className="text-xs text-ink-muted">
          Everything stays on this machine — no cloud, no accounts.
        </p>
      </div>
    </main>
  );
}
