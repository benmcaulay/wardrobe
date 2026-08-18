import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getCategoriesListFromPrefs } from "@/lib/categories";
import { getColorsListFromPrefs } from "@/lib/colors";
import { prisma } from "@/lib/db";
import { parseStylePrefs } from "@/lib/json";
import { getStyleTagsListFromPrefs } from "@/lib/preferences";
import { getOwnersFromPrefs } from "@/lib/owners";
import { stripeEnabled } from "@/lib/stripe";
import { SettingsClient } from "./settings-client";

export default async function SettingsPage() {
  const user = await requireUser();
  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { stylePrefs: true, credits: true, autoGenerateGhost: true },
  });
  const initialPrefs = parseStylePrefs(dbUser?.stylePrefs);
  const categoryList = getCategoriesListFromPrefs(initialPrefs);
  const categoryShapes = initialPrefs.categoryShapes ?? {};
  const styleTagsList = getStyleTagsListFromPrefs(initialPrefs);
  const ownersList = getOwnersFromPrefs(initialPrefs);
  const colorList = getColorsListFromPrefs(initialPrefs);

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

      <section className="mb-14 rounded-2xl border border-ink/10 bg-white p-5 flex items-center justify-between gap-4">
        <div>
          <h2 className="font-serif text-xl tracking-tight">Account</h2>
          <p className="text-sm text-ink-muted mt-1">Signed in as {user.email}</p>
        </div>
        <form action="/api/logout" method="post">
          <button
            type="submit"
            className="rounded-full border border-ink/15 px-5 py-2 text-sm tracking-wide hover:bg-paper-warm transition"
          >
            Sign out
          </button>
        </form>
      </section>

      <section className="mb-14">
        <h2 className="font-serif text-2xl tracking-tight mb-6">Style preferences</h2>
        <SettingsClient
          initialPrefs={initialPrefs}
          categoryList={categoryList}
        categoryShapes={categoryShapes}
          styleTagsList={styleTagsList}
          ownersList={ownersList}
          colorList={colorList}
          credits={dbUser?.credits ?? 0}
          autoGenerateGhost={dbUser?.autoGenerateGhost ?? false}
          purchasesEnabled={stripeEnabled()}
        />
      </section>
    </main>
  );
}
