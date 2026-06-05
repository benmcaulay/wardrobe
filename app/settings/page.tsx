import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getCategoriesListFromPrefs } from "@/lib/categories";
import { prisma } from "@/lib/db";
import { parseStylePrefs } from "@/lib/json";
import { getStyleTagsListFromPrefs } from "@/lib/preferences";
import { SettingsClient } from "./settings-client";

export default async function SettingsPage() {
  const user = await requireUser();
  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { stylePrefs: true, credits: true, autoGenerateGhost: true },
  });
  const initialPrefs = parseStylePrefs(dbUser?.stylePrefs);
  const categoryList = getCategoriesListFromPrefs(initialPrefs);
  const styleTagsList = getStyleTagsListFromPrefs(initialPrefs);

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

      <section className="mb-14">
        <h2 className="font-serif text-2xl tracking-tight mb-6">Style preferences</h2>
        <SettingsClient
          initialPrefs={initialPrefs}
          categoryList={categoryList}
          styleTagsList={styleTagsList}
          credits={dbUser?.credits ?? 0}
          autoGenerateGhost={dbUser?.autoGenerateGhost ?? false}
        />
      </section>
    </main>
  );
}
