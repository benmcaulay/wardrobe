import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getCategoriesListFromPrefs, NONE_CATEGORY } from "@/lib/categories";
import { prisma } from "@/lib/db";
import { parseStylePrefs } from "@/lib/json";
import { ScanClient } from "./scan-client";

export default async function CameraRollScanPage() {
  const user = await requireUser();
  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { credits: true, stylePrefs: true },
  });
  const prefs = parseStylePrefs(dbUser?.stylePrefs);
  const categories = [NONE_CATEGORY, ...getCategoriesListFromPrefs(prefs)];
  const realGhost = process.env.USE_REAL_GHOST_MANNEQUIN === "true";

  return (
    <main className="max-w-2xl mx-auto px-6 py-12">
      <nav className="mb-6 text-xs text-ink-muted">
        <Link href="/closet" className="hover:text-ink">
          ← Closet
        </Link>
      </nav>
      <header className="mb-8">
        <h1 className="font-serif text-4xl tracking-tight">Scan camera roll</h1>
        <p className="text-ink-muted mt-2">
          Bulk-import clothing from Apple Photos or your camera roll — we detect garments, ghost
          them, and let you review before anything hits your closet.
        </p>
      </header>
      <ScanClient
        credits={dbUser?.credits ?? 0}
        realGhost={realGhost}
        categories={categories}
      />
    </main>
  );
}
