"use server";

/**
 * The observation lenses (docs/OUTFIT_INTELLIGENCE.md §6).
 *
 * Four independent readings of the closet, deliberately **never fused into a
 * single score**:
 *
 *   dormancy   — "last worn 14 months ago"
 *   redundancy — "you own four similar white tees"
 *   value      — "pieces like this hold their value"
 *   marginal   — internal only; suppresses dormancy on load-bearing pieces
 *
 * Nothing here says "sell this", and there is no code path that could. The user
 * assembles that decision themselves; the product's job is to put honest facts
 * in front of them and then be quiet. Dormancy and value are returned
 * separately precisely so a caller cannot accidentally render them as one
 * verdict.
 */

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { decode, type Color, type Season } from "@/lib/json";
import {
  assessDormancy,
  dormancyReadiness,
  rankDormant,
  type DormancyReadiness,
} from "@/lib/outfit/dormancy";
import { computeMarginalValue } from "@/lib/outfit/marginal-value";
import { findRedundancyClusters } from "@/lib/outfit/redundancy";
import { CURRENT_EMBEDDING_MODEL, decodeEmbedding } from "@/lib/wear/embedding";
import { getDailyContext } from "@/lib/actions/daily-outfit";

export type LensItem = {
  id: string;
  name: string;
  imagePath: string;
  colors: Color[];
};

export type DormantFinding = LensItem & {
  /** Plain-language, descriptive. Never an instruction. */
  line: string;
};

export type RedundancyFinding = {
  category: string;
  items: LensItem[];
  line: string;
};

export type ValueFinding = LensItem & { line: string };

export type ClosetLenses = {
  readiness: DormancyReadiness;
  dormant: DormantFinding[];
  redundant: RedundancyFinding[];
  valuable: ValueFinding[];
};

function describeGap(days: number | null): string {
  if (days == null) return "Never worn since you added it.";
  if (days >= 730) return `Last worn about ${Math.floor(days / 365)} years ago.`;
  if (days >= 60) return `Last worn about ${Math.round(days / 30)} months ago.`;
  return `Last worn ${days} days ago.`;
}

export async function getClosetLenses(): Promise<ClosetLenses> {
  const user = await requireUser();

  const [items, embeddings, wearAgg, earliest, context, sold] = await Promise.all([
    prisma.wardrobeItem.findMany({
      where: { userId: user.id, isWishlist: false },
      select: {
        id: true,
        name: true,
        category: true,
        subcategory: true,
        material: true,
        pattern: true,
        colors: true,
        season: true,
        owners: true,
        effectiveWears: true,
        lastWornAt: true,
        protectedAt: true,
        createdAt: true,
        priceCents: true,
        brand: true,
        originalImagePath: true,
        ghostImagePath: true,
      },
    }),
    prisma.itemEmbedding.findMany({
      where: { model: CURRENT_EMBEDDING_MODEL, item: { userId: user.id, isWishlist: false } },
      select: { itemId: true, vector: true },
    }),
    prisma.wearEvent.count({ where: { userId: user.id } }),
    prisma.wearEvent.findFirst({
      where: { userId: user.id },
      orderBy: { wornOn: "asc" },
      select: { wornOn: true },
    }),
    getDailyContext(),
    // Real resale outcomes — the only honest basis for a value statement.
    prisma.listingPlacement.findMany({
      where: { userId: user.id, soldPriceCents: { not: null } },
      select: { soldPriceCents: true, listing: { select: { item: { select: { brand: true } } } } },
    }),
  ]);

  const now = new Date();
  const readiness = dormancyReadiness({
    wearEvents: wearAgg,
    earliestWearAt: earliest?.wornOn ?? null,
    now,
  });

  const toLensItem = (row: (typeof items)[number]): LensItem => ({
    id: row.id,
    name: row.name,
    imagePath: row.ghostImagePath ?? row.originalImagePath,
    colors: decode<Color[]>(row.colors, []),
  });

  // ── Lens 3 (internal): what the closet is built on ──
  const marginal = computeMarginalValue({
    items: items.map((row) => ({
      id: row.id,
      category: row.category,
      subcategory: row.subcategory,
      name: row.name,
      material: row.material,
      pattern: row.pattern,
      colors: decode<Color[]>(row.colors, []),
    })),
  });

  // ── Lens 1: dormancy, only if there is enough history to mean anything ──
  const dormant: DormantFinding[] = [];
  if (readiness.ready) {
    const assessed = items.map((row) =>
      assessDormancy({
        itemId: row.id,
        effectiveWears: row.effectiveWears,
        lastWornAt: row.lastWornAt,
        addedAt: row.createdAt,
        seasons: decode<Season[]>(row.season, []),
        ownerCount: decode<string[]>(row.owners, []).length,
        protectedAt: row.protectedAt,
        marginalValue: marginal.get(row.id) ?? 0,
        band: context.band,
        now,
      }),
    );
    const byId = new Map(items.map((row) => [row.id, row]));
    for (const result of rankDormant(assessed).slice(0, 12)) {
      const row = byId.get(result.itemId);
      if (!row) continue;
      dormant.push({ ...toLensItem(row), line: describeGap(result.daysSinceWorn) });
    }
  }

  // ── Lens 2: redundancy ──
  const vectors = new Map(
    embeddings.map((entry) => [entry.itemId, decodeEmbedding(new Uint8Array(entry.vector))]),
  );
  const clusters = findRedundancyClusters(
    items
      .filter((row) => vectors.has(row.id))
      .map((row) => ({ id: row.id, category: row.category, vector: vectors.get(row.id)! })),
  );
  const byId = new Map(items.map((row) => [row.id, row]));
  const redundant: RedundancyFinding[] = clusters.slice(0, 6).map((cluster) => {
    const members = cluster.itemIds.map((id) => byId.get(id)).filter(Boolean) as typeof items;
    return {
      category: cluster.category,
      items: members.map(toLensItem),
      line: `You have ${members.length} very similar ${cluster.category} pieces.`,
    };
  });

  // ── Lens 4: value awareness, positively framed ──
  const soldByBrand = new Map<string, number[]>();
  for (const placement of sold) {
    const brand = placement.listing.item.brand?.trim().toLowerCase();
    if (!brand || placement.soldPriceCents == null) continue;
    const bucket = soldByBrand.get(brand);
    if (bucket) bucket.push(placement.soldPriceCents);
    else soldByBrand.set(brand, [placement.soldPriceCents]);
  }

  const valuable: ValueFinding[] = [];
  for (const row of items) {
    const brand = row.brand?.trim().toLowerCase();
    const comparables = brand ? soldByBrand.get(brand) : undefined;
    if (!comparables || comparables.length === 0) continue;
    const median = [...comparables].sort((a, b) => a - b)[Math.floor(comparables.length / 2)];
    valuable.push({
      ...toLensItem(row),
      line: `Pieces like this have sold for about $${Math.round(median / 100)}.`,
    });
    if (valuable.length >= 8) break;
  }

  return { readiness, dormant, redundant, valuable };
}
