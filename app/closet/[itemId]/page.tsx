import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { imageUrl } from "@/lib/uploads";

export default async function ItemDetailPage({ params }: { params: { itemId: string } }) {
  const user = await requireUser();
  const item = await prisma.wardrobeItem.findFirst({
    where: { id: params.itemId, userId: user.id },
  });
  if (!item) notFound();

  return (
    <main className="max-w-3xl mx-auto px-6 py-12">
      <h1 className="font-serif text-4xl tracking-tight">{item.name}</h1>
      <p className="text-ink-muted mt-1">{item.brand ?? "—"}</p>
      <div className="mt-8 rounded-2xl overflow-hidden bg-paper-warm aspect-square max-w-md">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl(item.originalImagePath)}
          alt={item.name}
          className="w-full h-full object-cover"
        />
      </div>
      <p className="text-xs text-ink-muted mt-6">
        Detail view is a placeholder — full editing arrives in step 4.
      </p>
    </main>
  );
}
