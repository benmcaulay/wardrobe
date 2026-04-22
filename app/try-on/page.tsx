import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseStringArray } from "@/lib/json";
import { TryOnFlow } from "./try-on-flow";

type SearchParams = { item?: string; outfit?: string };

export default async function TryOnPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const [photos, items, outfit] = await Promise.all([
    prisma.referencePhoto.findMany({
      where: { userId: user.id },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      select: { id: true, imagePath: true, isPrimary: true },
    }),
    prisma.wardrobeItem.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        brand: true,
        category: true,
        originalImagePath: true,
      },
    }),
    searchParams.outfit
      ? prisma.outfit.findFirst({
          where: { id: searchParams.outfit, userId: user.id },
        })
      : Promise.resolve(null),
  ]);

  const itemIds = new Set(items.map((i) => i.id));

  // Initial selection: query params take precedence, otherwise empty.
  let initialSelected: string[] = [];
  if (outfit) {
    initialSelected = parseStringArray(outfit.itemIds).filter((id) => itemIds.has(id));
  } else if (searchParams.item && itemIds.has(searchParams.item)) {
    initialSelected = [searchParams.item];
  }

  return (
    <main className="max-w-6xl mx-auto px-6 py-12">
      <nav className="text-xs text-ink-muted mb-6">
        <Link href="/closet" className="hover:text-ink">
          ← Closet
        </Link>
      </nav>
      <header className="mb-10">
        <h1 className="font-serif text-4xl tracking-tight">Try it on</h1>
        <p className="text-ink-muted mt-2">
          Pick a reference photo of yourself, add one or more items from your
          closet, and generate a preview of the full outfit.
        </p>
      </header>

      {photos.length === 0 ? (
        <div className="rounded-2xl border border-ink/10 bg-paper-warm p-10 text-center max-w-lg mx-auto">
          <p className="font-serif text-2xl">You&apos;ll need a reference photo first.</p>
          <p className="text-ink-muted mt-2 text-sm">
            Add one in Settings and come back.
          </p>
          <Link
            href="/settings"
            className="inline-block mt-6 rounded-full bg-ink text-paper px-6 py-2 text-sm tracking-wide hover:bg-ink-soft transition"
          >
            Go to Settings
          </Link>
        </div>
      ) : (
        <TryOnFlow
          photos={photos}
          items={items}
          initialSelectedItemIds={initialSelected}
          initialReferencePhotoId={photos[0].id}
        />
      )}
    </main>
  );
}
