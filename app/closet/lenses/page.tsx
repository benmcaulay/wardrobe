import Link from "next/link";
import { getClosetLenses } from "@/lib/actions/closet-lenses";
import { LensesClient } from "./lenses-client";

export const dynamic = "force-dynamic";

export default async function LensesPage() {
  const lenses = await getClosetLenses();

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6">
      <nav className="mb-4">
        <Link href="/closet" className="text-sm text-ink-muted hover:text-ink">
          ← Closet
        </Link>
      </nav>

      <header className="mb-5">
        <h1 className="font-display text-3xl text-ink">Your closet, looked at</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Observations only. What to do about any of it is yours to decide.
        </p>
      </header>

      <LensesClient lenses={lenses} />
    </main>
  );
}
