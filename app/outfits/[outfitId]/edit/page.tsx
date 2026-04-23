import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseStringArray } from "@/lib/json";
import { OutfitBuilder } from "@/components/outfit-builder";

export default async function EditOutfitPage({
  params,
}: {
  params: { outfitId: string };
}) {
  const user = await requireUser();
  const [outfit, items] = await Promise.all([
    prisma.outfit.findFirst({ where: { id: params.outfitId, userId: user.id } }),
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
  ]);
  if (!outfit) notFound();

  const itemIds = new Set(items.map((i) => i.id));
  const initialSelectedItemIds = parseStringArray(outfit.itemIds).filter((id) =>
    itemIds.has(id),
  );

  return (
    <main className="max-w-5xl mx-auto px-6 py-12">
      <nav className="text-xs text-ink-muted mb-6">
        <Link href="/outfits" className="hover:text-ink">
          ← Outfits
        </Link>
      </nav>
      <header className="mb-10">
        <h1 className="font-serif text-4xl tracking-tight">Edit outfit</h1>
      </header>

      <OutfitBuilder
        mode="edit"
        outfitId={outfit.id}
        items={items}
        initialName={outfit.name}
        initialSelectedItemIds={initialSelectedItemIds}
      />
    </main>
  );
}
