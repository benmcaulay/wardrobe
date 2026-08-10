import Link from "next/link";
import { getDailySlate } from "@/lib/actions/daily-outfit";
import { listPendingWears } from "@/lib/actions/wear-confirm";
import { listStyleNotes } from "@/lib/actions/style-notes";
import { TodayClient } from "./today-client";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  // Both hit the network/DB and neither depends on the other.
  const [slate, pending, notes] = await Promise.all([
    getDailySlate(),
    listPendingWears(),
    listStyleNotes(),
  ]);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6">
      <nav className="mb-4">
        <Link href="/closet" className="text-sm text-ink-muted hover:text-ink">
          ← Closet
        </Link>
      </nav>

      <header className="mb-5">
        <h1 className="font-display text-3xl text-ink">Today</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Three looks from what you own. Tell me which one you wear and they get better.
        </p>
      </header>

      <TodayClient initialSlate={slate} initialPending={pending} initialNotes={notes} />
    </main>
  );
}
