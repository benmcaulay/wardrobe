import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseSeasons, parseStringArray, type Season } from "@/lib/json";
import { estimateItemPacking } from "@/lib/packing/estimate";
import { bucketFor } from "@/lib/packing/plan";
import type { ClimateSummary } from "@/lib/services/weather";
import {
  TripPlanner,
  type PlannerBag,
  type PlannerItem,
  type PlannerTrip,
} from "./trip-planner";

export const dynamic = "force-dynamic";

export default async function TripPage({ params }: { params: { tripId: string } }) {
  const user = await requireUser();
  const trip = await prisma.packingTrip.findUnique({ where: { id: params.tripId } });
  if (!trip || trip.userId !== user.id) notFound();

  const bagIds = parseStringArray(trip.bagIds);
  const [bagRows, itemRows] = await Promise.all([
    prisma.packingBag.findMany({
      where: { userId: user.id, id: { in: bagIds.length ? bagIds : ["__none__"] } },
    }),
    prisma.wardrobeItem.findMany({
      where: { userId: user.id, isWishlist: false },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        category: true,
        subcategory: true,
        material: true,
        season: true,
        originalImagePath: true,
        ghostImagePath: true,
        weightGrams: true,
        volumeLiters: true,
        priceCents: true,
        currency: true,
      },
    }),
  ]);

  const bags: PlannerBag[] = bagRows
    .sort((a, b) => bagIds.indexOf(a.id) - bagIds.indexOf(b.id))
    .map((b) => ({
      id: b.id,
      name: b.name,
      volumeLiters: b.volumeLiters,
      maxWeightKg: b.maxWeightKg,
    }));

  const items: PlannerItem[] = itemRows.map((r) => {
    const est = estimateItemPacking({
      category: r.category,
      subcategory: r.subcategory,
      material: r.material,
      name: r.name,
      weightGrams: r.weightGrams,
      volumeLiters: r.volumeLiters,
    });
    return {
      id: r.id,
      name: r.name,
      imagePath: r.ghostImagePath ?? r.originalImagePath,
      category: r.category,
      bucket: bucketFor(r.category),
      season: parseSeasons(r.season) as Season[],
      weightGrams: est.weightGrams,
      volumeLiters: est.volumeLiters,
      priceCents: r.priceCents,
      currency: r.currency,
      hasOverride: r.weightGrams != null || r.volumeLiters != null,
    };
  });

  const tripView: PlannerTrip = {
    id: trip.id,
    name: trip.name,
    destination: trip.destination,
    startDate: trip.startDate.toISOString(),
    endDate: trip.endDate.toISOString(),
  };

  let climate: ClimateSummary | null = null;
  if (trip.climateData) {
    try {
      climate = JSON.parse(trip.climateData) as ClimateSummary;
    } catch {
      climate = null;
    }
  }

  const assignments = (() => {
    try {
      return JSON.parse(trip.assignments) as Record<string, string[]>;
    } catch {
      return {};
    }
  })();
  // Make sure every current bag has an entry so the UI renders empty bags.
  for (const bag of bags) if (!assignments[bag.id]) assignments[bag.id] = [];

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <nav className="mb-6 text-xs text-ink-muted">
        <Link href="/closet/smartpakker" className="hover:text-ink">
          ← SmartPakker
        </Link>
      </nav>

      <TripPlanner
        trip={tripView}
        bags={bags}
        items={items}
        initialClimate={climate}
        initialAssignments={assignments}
      />
    </main>
  );
}
