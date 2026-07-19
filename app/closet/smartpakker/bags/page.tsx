import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { BagsClient, type BagView } from "./bags-client";

export const dynamic = "force-dynamic";

export default async function BagsPage() {
  const user = await requireUser();
  const bags = await prisma.packingBag.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
  });

  const views: BagView[] = bags.map((b) => ({
    id: b.id,
    name: b.name,
    volumeLiters: b.volumeLiters,
    maxWeightKg: b.maxWeightKg,
    silhouette: b.silhouette,
    imagePath: b.imagePath,
  }));

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <nav className="mb-6 text-xs text-ink-muted">
        <Link href="/closet/smartpakker" className="hover:text-ink">
          ← Trip Packing Assistant
        </Link>
      </nav>

      <header className="mb-8">
        <h1 className="font-serif text-4xl tracking-tight">Your bags</h1>
        <p className="mt-2 text-ink-muted">
          Add each piece of luggage you own — its volume in litres and an optional weight limit.
          The Trip Packing Assistant packs your trips into these.
        </p>
      </header>

      <BagsClient initial={views} />
    </main>
  );
}
