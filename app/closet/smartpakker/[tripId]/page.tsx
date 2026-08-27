import { readItemTileMeta } from "@/lib/item-tile-meta";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseColors, parseSeasons, parseStringArray, parseStylePrefs, type Season } from "@/lib/json";
import { readTemperatureUnit } from "@/lib/temperature";
import { estimateItemPacking } from "@/lib/packing/estimate";
import { bucketFor } from "@/lib/packing/plan";
import { parseTripRequirements } from "@/lib/packing/requirements";
import { parseGearCategory } from "@/lib/packing/gear";
import { deriveOccasion, isDailyWear } from "@/lib/packing/occasion";
import type { LookLayoutPrefs } from "@/lib/packing/look";
import {
  sanitizeComboLayouts,
  sanitizeLayerArrangements,
  sanitizeLayerOrder,
  sanitizeOutfitSlotDefaults,
  sanitizeVisualLayers,
} from "@/lib/outfit-slot-defaults";
import type { ClimateSummary } from "@/lib/services/weather";
import {
  TripPlanner,
  type PlannerBag,
  type PlannerGear,
  type PlannerItem,
  type PlannerTrip,
} from "./trip-planner";

export const dynamic = "force-dynamic";

export default async function TripPage({ params }: { params: { tripId: string } }) {
  const user = await requireUser();
  const trip = await prisma.packingTrip.findUnique({ where: { id: params.tripId } });
  if (!trip || trip.userId !== user.id) notFound();

  const bagIds = parseStringArray(trip.bagIds);
  const [prefRow, bagRows, itemRows, gearRows] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: { stylePrefs: true } }),
    prisma.packingBag.findMany({
      where: { userId: user.id, id: { in: bagIds.length ? bagIds : ["__none__"] } },
    }),
    prisma.wardrobeItem.findMany({
      where: {
        userId: user.id,
        isWishlist: false,
        // A sold piece isn't yours to pack. Items merely listed stay browsable
        // so you can still add one by hand; auto-pack skips those separately.
        NOT: { saleListing: { status: "sold" } },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        category: true,
        subcategory: true,
        material: true,
        season: true,
        colors: true,
        originalImagePath: true,
        ghostImagePath: true,
        // Thumbnail framing, so a flip or zoom saved on the item shows up here
        // too rather than only in the closet grid.
        ghostViews: true,
        originalMirror: true,
        originalThumbZoom: true,
        weightGrams: true,
        volumeLiters: true,
        priceCents: true,
        currency: true,
        dailyWear: true,
      },
    }),
    prisma.packingGear.findMany({
      where: { userId: user.id, archivedAt: null },
      orderBy: [{ essential: "desc" }, { createdAt: "asc" }],
    }),
  ]);

  const bags: PlannerBag[] = bagRows
    .sort((a, b) => bagIds.indexOf(a.id) - bagIds.indexOf(b.id))
    .map((b) => ({
      id: b.id,
      name: b.name,
      volumeLiters: b.volumeLiters,
      maxWeightKg: b.maxWeightKg,
      silhouette: b.silhouette,
      imagePath: b.imagePath,
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
      // Resolved with the same helper the closet grid and the outfit canvas use,
      // so all three agree on how a piece is framed.
      tile: readItemTileMeta(r),
      category: r.category,
      bucket: bucketFor(r),
      colors: parseColors(r.colors),
      season: parseSeasons(r.season) as Season[],
      weightGrams: est.weightGrams,
      volumeLiters: est.volumeLiters,
      priceCents: r.priceCents,
      currency: r.currency,
      hasOverride: r.weightGrams != null || r.volumeLiters != null,
      // Resolved server-side so the planner and the packer agree on which
      // pieces are occasion-only; see lib/packing/occasion.ts.
      subcategory: r.subcategory,
      dailyWear: isDailyWear(r),
      occasion: deriveOccasion(r),
      dailyWearOverride: r.dailyWear,
    };
  });

  const gear: PlannerGear[] = gearRows.map((g) => ({
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

  /*
   * The outfit canvas's placement rules, so the looks carousel composes a day
   * exactly the way the outfits tab would. All of it lives in stylePrefs; see
   * lib/packing/look.ts.
   */
  const outfitPrefs = parseStylePrefs(prefRow?.stylePrefs);
  const lookPrefs: LookLayoutPrefs = {
    slotDefaults: sanitizeOutfitSlotDefaults(outfitPrefs.outfitSlotDefaults),
    visualLayers: sanitizeVisualLayers(outfitPrefs.outfitVisualLayers),
    comboLayouts: sanitizeComboLayouts(outfitPrefs.outfitComboLayouts),
    layerArrangements: sanitizeLayerArrangements(outfitPrefs.outfitLayerArrangements),
    layerOrder: sanitizeLayerOrder(outfitPrefs.outfitLayerOrder),
  };

  const tripView: PlannerTrip = {
    id: trip.id,
    name: trip.name,
    destination: trip.destination,
    latitude: trip.latitude,
    longitude: trip.longitude,
    countryCode: trip.countryCode,
    timezone: trip.timezone,
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

  const parseMap = (json: string): Record<string, string[]> => {
    try {
      const parsed = JSON.parse(json) as Record<string, string[]>;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  };

  const assignments = parseMap(trip.assignments);
  const gearAssignments = parseMap(trip.gearAssignments);
  // Make sure every current bag has an entry so the UI renders empty bags.
  for (const bag of bags) {
    if (!assignments[bag.id]) assignments[bag.id] = [];
    if (!gearAssignments[bag.id]) gearAssignments[bag.id] = [];
  }
  // Gear deleted from the library leaves its id behind in this JSON, which no
  // foreign key cleans up — see `deleteGear`. Drop anything unresolvable here
  // so a stale id can't count toward a bag meter.
  const liveGear = new Set(gear.map((g) => g.id));
  for (const bagId of Object.keys(gearAssignments)) {
    gearAssignments[bagId] = gearAssignments[bagId].filter((id) => liveGear.has(id));
  }

  return (
    // Wider than the rest of SmartPakker: this page runs the plan and the bag
    // contents side by side, and 5xl squeezes both.
    <main className="mx-auto max-w-7xl px-6 py-12">
      <nav className="mb-6 text-xs text-ink-muted">
        <Link href="/closet/smartpakker" className="hover:text-ink">
          ← Trip Packing Assistant
        </Link>
      </nav>

      <TripPlanner
        trip={tripView}
        bags={bags}
        items={items}
        gear={gear}
        initialRequirements={parseTripRequirements(trip.requirements)}
        initialClimate={climate}
        initialAssignments={assignments}
        initialGearAssignments={gearAssignments}
        lookPrefs={lookPrefs}
        temperatureUnit={readTemperatureUnit(outfitPrefs.temperatureUnit)}
      />
    </main>
  );
}
