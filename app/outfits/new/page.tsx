import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { OutfitBuilder } from "@/components/outfit-builder";

export default async function NewOutfitPage({
  searchParams,
}: {
  searchParams: { items?: string };
}) {
  const user = await requireUser();
  const items = await prisma.wardrobeItem.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      brand: true,
      category: true,
      originalImagePath: true,
    },
  });

  // Optional pre-selection via ?items=id1,id2
  const itemIds = new Set(items.map((i) => i.id));
  const initialSelectedItemIds = (searchParams.items ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && itemIds.has(s));

  return (
    <main className="max-w-5xl mx-auto px-6 py-12">
      <nav className="text-xs text-ink-muted mb-6">
        <Link href="/outfits" className="hover:text-ink">
          ← Outfits
        </Link>
      </nav>
      <header className="mb-10">
        <h1 className="font-serif text-4xl tracking-tight">New outfit</h1>
        <p className="text-ink-muted mt-2">
          Name it and pick the pieces that belong together.
        </p>
      </header>

      <OutfitBuilder mode="create" items={items} initialSelectedItemIds={initialSelectedItemIds} />
    </main>
  );
}
