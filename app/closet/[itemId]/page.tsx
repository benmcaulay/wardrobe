import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canonicalCategoryChoice, getCategoriesListFromPrefs } from "@/lib/categories";
import { prisma } from "@/lib/db";
import { parseColors, parseSeasons, parseStringArray, parseStylePrefs } from "@/lib/json";
import { getStyleTagsListFromPrefs } from "@/lib/preferences";
import type { ItemFormValue } from "@/lib/types";
import { EditForm } from "./edit-form";
import { ImageCarousel } from "./image-carousel";

type StoredGhostView = { label: string; imagePath: string; mirror: boolean; thumbZoom: number };

function formatDate(d: Date) {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default async function ItemDetailPage({ params }: { params: { itemId: string } }) {
  const user = await requireUser();
  const [item, dbUser] = await Promise.all([
    prisma.wardrobeItem.findFirst({ where: { id: params.itemId, userId: user.id } }),
    prisma.user.findUnique({ where: { id: user.id }, select: { credits: true, stylePrefs: true } }),
  ]);
  if (!item) notFound();
  const prefs = parseStylePrefs(dbUser?.stylePrefs);
  const categories = getCategoriesListFromPrefs(prefs);
  const styleTagsList = getStyleTagsListFromPrefs(prefs);

  const initial: ItemFormValue = {
    name: item.name,
    brand: item.brand ?? "",
    category: canonicalCategoryChoice(item.category, categories),
    subcategory: item.subcategory ?? "",
    colors: parseColors(item.colors),
    priceCents: item.priceCents,
    currency: item.currency,
    material: item.material ?? "",
    pattern: item.pattern ?? "",
    styleTags: parseStringArray(item.styleTags),
    season: parseSeasons(item.season),
    notes: item.notes ?? "",
    isWishlist: item.isWishlist,
  };

  // Parse ghost views; fall back to synthesising one from ghostImagePath for old items
  let ghostViews: StoredGhostView[] = [];
  try {
    if (item.ghostViews) {
      const parsed = JSON.parse(item.ghostViews) as Array<{
        label?: string;
        imagePath?: string;
        mirror?: boolean;
        thumbZoom?: number;
      }>;
      ghostViews = parsed
        .filter((v): v is { label: string; imagePath: string; mirror?: boolean; thumbZoom?: number } =>
          typeof v?.label === "string" && typeof v?.imagePath === "string",
        )
        .map((v) => ({
          label: v.label,
          imagePath: v.imagePath,
          mirror: !!v.mirror,
          thumbZoom: typeof v.thumbZoom === "number" ? v.thumbZoom : 1,
        }));
    }
  } catch {
    // ignore
  }
  if (ghostViews.length === 0 && item.ghostImagePath) {
    ghostViews = [{ label: "Ghost", imagePath: item.ghostImagePath, mirror: false, thumbZoom: 1 }];
  }

  const extraPaths = parseStringArray(item.extraImagePaths ?? "[]");

  return (
    <main className="max-w-6xl mx-auto px-6 py-12">
      <nav className="text-xs text-ink-muted mb-6">
        <Link href="/closet" className="hover:text-ink">
          ← Closet
        </Link>
      </nav>

      <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-10 items-start">
        <div className="space-y-4 md:sticky md:top-6">
          <ImageCarousel
            itemId={item.id}
            originalPath={item.originalImagePath}
            originalThumbZoom={item.originalThumbZoom ?? 1}
            originalMirror={item.originalMirror ?? false}
            ghostViews={ghostViews}
            primaryGhostPath={item.ghostImagePath}
            extraImagePaths={extraPaths}
            credits={dbUser?.credits ?? 0}
          />
          <dl className="grid grid-cols-2 gap-4 text-xs">
            <div>
              <dt className="uppercase tracking-wide text-ink-muted">Worn</dt>
              <dd className="mt-1 text-sm">
                {item.timesWorn} {item.timesWorn === 1 ? "time" : "times"}
              </dd>
            </div>
            <div>
              <dt className="uppercase tracking-wide text-ink-muted">Last worn</dt>
              <dd className="mt-1 text-sm">
                {item.lastWornAt ? formatDate(item.lastWornAt) : "—"}
              </dd>
            </div>
          </dl>
        </div>

        <div>
          <EditForm itemId={item.id} initial={initial} categories={categories} styleTagsList={styleTagsList} />
        </div>
      </div>
    </main>
  );
}
