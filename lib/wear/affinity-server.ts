/**
 * Assembling Layer 2 for one user (docs/OUTFIT_INTELLIGENCE.md §4).
 *
 * Server-side because it needs the closet vectors and the choice log, and the
 * daily slate is already built here. Not a server *action*: nothing on the
 * client calls it, and exposing an endpoint that reads a preference history is
 * surface with no purpose.
 *
 * The fit is a few hundred parameters over a few dozen comparisons, so it runs
 * per request in milliseconds rather than needing a cache to go stale.
 */

import { prisma } from "@/lib/db";
import { decode, type Color } from "@/lib/json";
import { buildAffinityMap } from "@/lib/outfit/affinity";
import { buildFeatureMap } from "@/lib/outfit/features";
import { fitBradleyTerry, NEUTRAL_ANCHOR, type Comparison } from "@/lib/outfit/bradley-terry";
import { buildPosterior, type AffinityPosterior, type EvidenceCounts } from "@/lib/outfit/posterior";
import { comparisonsFrom, decodeArms, isPreferenceKind } from "@/lib/wear/signals";

export type AffinityResult = {
  /** Point estimate per item, for the safe and alternative slots. */
  affinity: Map<string, number>;
  /** Mean + uncertainty, for the Thompson draw in the explore slot. */
  posterior: AffinityPosterior;
};

export async function buildAffinity(userId: string): Promise<AffinityResult> {
  const [preferences, wearCounts] = await Promise.all([
    prisma.preferenceEvent.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      // Recent choices only. Taste drifts, and a comparison from two years ago
      // is not evidence about this morning.
      take: 500,
      select: {
        kind: true,
        itemIds: true,
        rejectedIds: true,
        armsJson: true,
        chosenArm: true,
      },
    }),
    // Wear evidence, not just choice evidence. An item worn fifty times is not
    // one we are uncertain about, even if it has never been in a slate — and
    // without this the explore slot would keep "discovering" the user's
    // favourite jeans.
    // Features as well as wear counts: the contextual fit needs to know what
    // each garment *is*, and the same query already had to run.
    prisma.wardrobeItem.findMany({
      where: { userId, isWishlist: false },
      select: {
        id: true,
        effectiveWears: true,
        name: true,
        category: true,
        subcategory: true,
        pattern: true,
        colors: true,
      },
    }),
  ]);

  // One row can carry several comparisons: a pick over n outfits is n−1 of them.
  // `comparisonsFrom` owns that reading, and the offline evaluator uses the same
  // function so the two cannot drift.
  const comparisons: Comparison[] = [];
  for (const event of preferences) {
    if (!isPreferenceKind(event.kind)) continue;
    comparisons.push(
      ...comparisonsFrom({
        kind: event.kind,
        itemIds: safeIds(event.itemIds),
        rejectedIds: safeIds(event.rejectedIds),
        arms: decodeArms(event.armsJson),
        chosenArm: event.chosenArm,
      }),
    );
  }

  // Contextual: strength is a function of colour geometry, garment kind and
  // formality, not of item identity. With ~60 comparisons over ~180 items the
  // identity model can only memorize — measured at 86.8% in-sample against 53.8%
  // leave-one-out before this changed (`pnpm eval:ranker`).
  const { features } = buildFeatureMap(
    wearCounts.map((row) => ({
      id: row.id,
      name: row.name,
      category: row.category,
      subcategory: row.subcategory,
      pattern: row.pattern,
      colors: decode<Color[]>(row.colors, []),
    })),
  );

  // Anchor-centred, because training ratings (§10) are unary judgements stored
  // as comparisons against NEUTRAL_ANCHOR. Centring on the mean instead would
  // let a session of mostly-likes shift the scale until "liked" no longer means
  // above-neutral.
  const fit =
    comparisons.length > 0
      ? fitBradleyTerry(comparisons, { anchorId: NEUTRAL_ANCHOR, features })
      : null;
  // No style prior any more: the global "describe your style" prompt is gone
  // (§9), so Layer 2's only learned input is choice data. What the user knows
  // that the closet doesn't is captured as rules, not as an affinity term.
  const affinity = buildAffinityMap({ fit });
  // The anchor is a modelling device, not a garment.
  affinity.delete(NEUTRAL_ANCHOR);

  const evidence = new Map<string, EvidenceCounts>();
  for (const item of wearCounts) {
    evidence.set(item.id, {
      comparisons: fit?.evidence.get(item.id) ?? 0,
      wears: item.effectiveWears,
    });
  }

  return { affinity, posterior: buildPosterior(affinity, evidence) };
}

function safeIds(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}
