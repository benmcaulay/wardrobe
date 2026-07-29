import { requireUser } from "@/lib/auth";
import { getCategoriesListFromPrefs } from "@/lib/categories";
import { getColorsListFromPrefs } from "@/lib/colors";
import { prisma } from "@/lib/db";
import { parseStylePrefs } from "@/lib/json";
import { getStyleTagsListFromPrefs } from "@/lib/preferences";
import { getOwnersFromPrefs } from "@/lib/owners";
import { webMatchAutofillEnabled } from "@/lib/web-match-autofill";
import { AddItemFlow } from "./add-item-flow";

export default async function AddItemPage() {
  const user = await requireUser();
  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { credits: true, autoGenerateGhost: true, stylePrefs: true },
  });
  const prefs = parseStylePrefs(dbUser?.stylePrefs);
  const categories = getCategoriesListFromPrefs(prefs);
  const styleTagsList = getStyleTagsListFromPrefs(prefs);
  const ownersList = getOwnersFromPrefs(prefs);
  const colorOptions = getColorsListFromPrefs(prefs);
  const webMatchAutofill = webMatchAutofillEnabled();
  return (
    <main className="max-w-5xl mx-auto px-6 py-12">
      <header className="mb-8">
        <h1 className="font-serif text-4xl tracking-tight">Add a piece</h1>
        <p className="text-ink-muted mt-2">
          {webMatchAutofill
            ? "Take a photo or upload one — we\u2019ll remove the background, analyze the garment, and pre-fill the details for you."
            : "Search the web for a listing to import, or take your own photo — we\u2019ll remove the background and fill in the details."}
        </p>
      </header>
      <AddItemFlow
        credits={dbUser?.credits ?? 0}
        autoGenerateGhost={dbUser?.autoGenerateGhost ?? false}
        categories={categories}
        styleTagsList={styleTagsList}
        ownersList={ownersList}
        colorOptions={colorOptions}
        webMatchAutofill={webMatchAutofill}
      />
    </main>
  );
}
