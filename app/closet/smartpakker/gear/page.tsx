import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseGearCategory } from "@/lib/packing/gear";
import { GearClient, type GearView } from "./gear-client";

export const dynamic = "force-dynamic";

export default async function GearPage() {
  const user = await requireUser();
  const rows = await prisma.packingGear.findMany({
    where: { userId: user.id, archivedAt: null },
    orderBy: [{ essential: "desc" }, { createdAt: "asc" }],
  });

  const gear: GearView[] = rows.map((g) => ({
    id: g.id,
    name: g.name,
    category: parseGearCategory(g.category),
    icon: g.icon,
    quantity: g.quantity,
    weightGrams: g.weightGrams,
    volumeLiters: g.volumeLiters,
    notes: g.notes,
    essential: g.essential,
  }));

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <nav className="mb-6 text-xs text-ink-muted">
        <Link href="/closet/smartpakker" className="hover:text-ink">
          ← Trip Packing Assistant
        </Link>
      </nav>

      <header className="mb-8">
        <h1 className="font-serif text-4xl tracking-tight">Your gear</h1>
        <p className="mt-2 max-w-2xl text-ink-muted">
          Everything that goes in the bag but isn&apos;t clothing — charger, passport, wash
          bag, medication. Describe each one once and it&apos;s available on every trip,
          counting toward the same volume and weight as your clothes.
        </p>
      </header>

      <GearClient initial={gear} />
    </main>
  );
}
