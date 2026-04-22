import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseStylePrefs } from "@/lib/json";
import { ReferencePhotoManager } from "@/components/reference-photo-manager";
import { SettingsClient } from "./settings-client";

export default async function SettingsPage() {
  const user = await requireUser();
  const [photos, dbUser] = await Promise.all([
    prisma.referencePhoto.findMany({
      where: { userId: user.id },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      select: { id: true, imagePath: true, isPrimary: true },
    }),
    prisma.user.findUnique({ where: { id: user.id }, select: { stylePrefs: true } }),
  ]);
  const initialPrefs = parseStylePrefs(dbUser?.stylePrefs);

  return (
    <main className="max-w-3xl mx-auto px-6 py-12">
      <nav className="text-xs text-ink-muted mb-6">
        <Link href="/closet" className="hover:text-ink">
          ← Closet
        </Link>
      </nav>
      <header className="mb-10">
        <h1 className="font-serif text-4xl tracking-tight">Settings</h1>
      </header>

      <section className="space-y-4 mb-14">
        <div>
          <h2 className="font-serif text-2xl tracking-tight">Reference photos</h2>
          <p className="text-ink-muted text-sm mt-1">
            The photos the try-on engine works from. Mark one as primary to use
            it by default.
          </p>
        </div>
        <ReferencePhotoManager photos={photos} maxRecommended={5} />
      </section>

      <section>
        <h2 className="font-serif text-2xl tracking-tight mb-6">Style preferences</h2>
        <SettingsClient initialPrefs={initialPrefs} />
      </section>
    </main>
  );
}
