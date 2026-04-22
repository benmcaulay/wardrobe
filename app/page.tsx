import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DEMO_USER_COOKIE } from "@/lib/auth";

export default function LandingPage() {
  const hasCookie = cookies().get(DEMO_USER_COOKIE)?.value;
  if (hasCookie) redirect("/closet");

  return (
    <main className="min-h-dvh flex items-center justify-center px-6">
      <div className="max-w-lg text-center space-y-8">
        <h1 className="font-serif text-5xl tracking-tight">Wardrobe</h1>
        <p className="text-ink-muted text-lg leading-relaxed">
          Your personal digital closet. Upload what you own, see it organized,
          and (soon) try on new pieces before you buy.
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
