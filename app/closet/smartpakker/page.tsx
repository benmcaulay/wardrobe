import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseStringArray } from "@/lib/json";
import { formatVolume } from "@/lib/packing/estimate";
import { HubClient, type BagOption, type TripView } from "./hub-client";

export const dynamic = "force-dynamic";

function countAssigned(assignmentsJson: string): number {
  try {
    const map = JSON.parse(assignmentsJson) as Record<string, string[]>;
    return new Set(Object.values(map).flat()).size;
  } catch {
    return 0;
  }
}

export default async function SmartPakkerPage() {
  const user = await requireUser();
  const [bags, trips] = await Promise.all([
    prisma.packingBag.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
    prisma.packingTrip.findMany({ where: { userId: user.id }, orderBy: { startDate: "desc" } }),
  ]);

  const bagOptions: BagOption[] = bags.map((b) => ({
    id: b.id,
    name: b.name,
    volumeLiters: b.volumeLiters,
  }));

  const tripViews: TripView[] = trips.map((t) => ({
    id: t.id,
    name: t.name,
    destination: t.destination,
    startDate: t.startDate.toISOString(),
    endDate: t.endDate.toISOString(),
    bagCount: parseStringArray(t.bagIds).length,
    packedCount: countAssigned(t.assignments),
  }));

  const totalLiters = bags.reduce((sum, b) => sum + b.volumeLiters, 0);

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      {/* pr-28 clears the fixed menu trigger (app/closet/layout.tsx). */}
      <nav className="mb-6 flex items-center justify-between pr-28 text-xs text-ink-muted">
        <Link href="/closet" className="hover:text-ink">
          ← Closet
        </Link>
        <span className="flex items-center gap-4">
          <Link href="/closet/smartpakker/gear" className="hover:text-ink">
            Gear
          </Link>
          <Link href="/closet/smartpakker/bags" className="hover:text-ink">
            Manage bags{bags.length > 0 ? ` (${bags.length})` : ""} →
          </Link>
        </span>
      </nav>

      <header className="mb-10">
        <h1 className="font-serif text-5xl tracking-tight">Trip Packing Assistant</h1>
        <p className="mt-2 max-w-xl text-ink-muted">
          Tell us where you&apos;re going and which bags you&apos;ve got. We&apos;ll estimate the
          weight and volume of everything in your closet and pack you for the climate.
        </p>
        {bags.length > 0 ? (
          <p className="mt-3 text-xs uppercase tracking-[0.18em] text-ink-muted">
            {bags.length} {bags.length === 1 ? "bag" : "bags"} · {formatVolume(totalLiters)} total
          </p>
        ) : null}
      </header>

      <HubClient bags={bagOptions} trips={tripViews} />
    </main>
  );
}
