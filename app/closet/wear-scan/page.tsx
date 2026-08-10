import Link from "next/link";
import { getScanReadiness } from "@/lib/actions/wear-scan";
import { WearScanClient } from "./wear-scan-client";

export const dynamic = "force-dynamic";

export default async function WearScanPage() {
  const { embedded, total } = await getScanReadiness();

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6">
      <nav className="mb-4">
        <Link href="/closet" className="text-sm text-ink-muted hover:text-ink">
          ← Closet
        </Link>
      </nav>

      <header className="mb-5">
        <h1 className="font-display text-3xl text-ink">Find past wears</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Photos of you, matched against your closet — on this device, never uploaded.
        </p>
      </header>

      <WearScanClient embedded={embedded} total={total} />
    </main>
  );
}
