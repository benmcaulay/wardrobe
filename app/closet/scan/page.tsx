import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getCategoriesListFromPrefs, NONE_CATEGORY } from "@/lib/categories";
import { prisma } from "@/lib/db";
import { parseStylePrefs } from "@/lib/json";
import { getOwnersFromPrefs } from "@/lib/owners";
import { getScanReadiness } from "@/lib/actions/wear-scan";
import { ScanModes } from "./scan-modes";

// The wear-scan mode reports how much of the closet is embedded, which changes
// as pieces are added, so this can't be static.
export const dynamic = "force-dynamic";

export default async function CameraRollScanPage() {
  const user = await requireUser();
  const [dbUser, readiness] = await Promise.all([
    prisma.user.findUnique({
      where: { id: user.id },
      select: { credits: true, stylePrefs: true },
    }),
    getScanReadiness(),
  ]);
  const prefs = parseStylePrefs(dbUser?.stylePrefs);
  const categories = [NONE_CATEGORY, ...getCategoriesListFromPrefs(prefs)];
  const owners = getOwnersFromPrefs(prefs);
  const realGhost = process.env.USE_REAL_GHOST_MANNEQUIN === "true";

  return (
    <main className="max-w-2xl mx-auto px-6 py-12">
      <nav className="mb-6 text-xs text-ink-muted">
        <Link href="/closet" className="hover:text-ink">
          ← Closet
        </Link>
      </nav>
      <ScanModes
        credits={dbUser?.credits ?? 0}
        realGhost={realGhost}
        categories={categories}
        owners={owners}
        embedded={readiness.embedded}
        total={readiness.total}
      />
    </main>
  );
}
