"use server";

/**
 * The daily outfit proposal (docs/OUTFIT_INTELLIGENCE.md §5B).
 *
 * This is the data engine. Surface A (the spin builder) makes the product feel
 * smart; this is the one that manufactures training data, because every
 * interaction here is a *choice* under known context:
 *
 *   accept  → a confidence-1 WearEvent with weather and occasion attached,
 *             plus `chosen ≻ the other two`
 *   reroll  → the two rejected sets, under identical context
 *   dismiss → all three rejected
 *
 * Every response carries a policyId and an exact propensity so a future ranker
 * can be evaluated against this one offline (IPS/SNIPS) rather than needing a
 * live A/B test.
 */

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { decode, encode, parseStylePrefs, type Color, type Season } from "@/lib/json";
import { buildSlate, slotsForBand, SLATE_POLICY_ID, type Proposal } from "@/lib/outfit/slate";
import { getClimateSummary, weatherEnabled, type ClimateBand } from "@/lib/services/weather";
import { searchPlaces } from "@/lib/services/geocode";
import { placeLabel, type Place } from "@/lib/places";
import { loadStyleRules } from "@/lib/wear/style-rules-server";
import { buildAffinity } from "@/lib/wear/affinity-server";
import { recordPreference, recordWear } from "@/lib/wear/record";
import { parseOccasion, type Occasion } from "@/lib/wear/occasions";
import { wornOnFromISODate, wornOnFromLocalDate } from "@/lib/wear/rollup";

export type ProposalItem = {
  id: string;
  name: string;
  category: string;
  imagePath: string;
  colors: Color[];
};

export type DailyContext = {
  location: string | null;
  band: ClimateBand | null;
  highC: number | null;
  rainChance: number | null;
  source: "forecast" | "climatology" | "unknown" | "manual" | "none";
};

export type DailyProposal = {
  /** Stable within a slate so the client can report which one was chosen. */
  key: string;
  /** Which arm produced it — segment on this before any off-policy estimate. */
  strategy: "safe" | "alternative" | "explore";
  items: ProposalItem[];
  score: number;
  propensity: number;
};

export type DailySlateResponse = {
  policyId: string;
  context: DailyContext;
  proposals: DailyProposal[];
};

type ScoringRow = {
  id: string;
  name: string;
  category: string;
  subcategory: string | null;
  material: string | null;
  pattern: string | null;
  colors: string;
  season: string;
  originalImagePath: string;
  ghostImagePath: string | null;
};

async function loadWearablePool(userId: string): Promise<ScoringRow[]> {
  return prisma.wardrobeItem.findMany({
    where: {
      userId,
      // Wishlist items aren't owned yet, and anything sold is gone. Proposing
      // either is the fastest way to make the feature feel broken.
      isWishlist: false,
      saleListing: { is: null },
    },
    select: {
      id: true,
      name: true,
      category: true,
      subcategory: true,
      material: true,
      pattern: true,
      colors: true,
      season: true,
      originalImagePath: true,
      ghostImagePath: true,
    },
  });
}

function toScorable(row: ScoringRow) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    subcategory: row.subcategory,
    material: row.material,
    pattern: row.pattern,
    colors: decode<Color[]>(row.colors, []),
    season: decode<Season[]>(row.season, []),
  };
}

/**
 * Which calendar day to fetch the weather for.
 *
 * The caller's local date, when it sends one. The server clock can't answer
 * this: at 18:00 in California it is already tomorrow in UTC, so a server-dated
 * "today" would quietly hand the user tomorrow's forecast all evening.
 */
function localDay(localISODate?: string): Date {
  if (localISODate && /^\d{4}-\d{2}-\d{2}$/.test(localISODate)) {
    const [y, m, d] = localISODate.split("-").map(Number);
    const parsed = new Date(Date.UTC(y, m - 1, d));
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

/** Today's weather where the user gets dressed. Never throws. */
export async function getDailyContext(localISODate?: string): Promise<DailyContext> {
  const user = await requireUser();
  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { stylePrefs: true },
  });
  const location = parseStylePrefs(dbUser?.stylePrefs).homeLocation?.trim() || null;

  if (!location || !weatherEnabled()) {
    return { location, band: null, highC: null, rainChance: null, source: "none" };
  }

  const today = localDay(localISODate);
  const summary = await getClimateSummary({ destination: location, start: today, end: today });

  // "unknown" means the provider had nothing — report it rather than passing a
  // placeholder band into the scorer, which would dress the user for a climate
  // nobody measured.
  if (summary.source === "unknown") {
    return { location, band: null, highC: null, rainChance: null, source: "unknown" };
  }

  return {
    location: summary.destination,
    band: summary.band,
    highC: summary.avgHighC,
    rainChance: summary.rainChance,
    source: summary.source,
  };
}

/**
 * Place candidates for the home-location picker.
 *
 * Same provider the trip destination picker uses, exposed here so the outfits
 * weather card can offer real places instead of a free-text box that only
 * geocodes after you remember to press Save.
 */
export async function searchHomePlaces(query: string): Promise<Place[]> {
  await requireUser();
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  return searchPlaces(trimmed);
}

export async function setHomeLocation(
  location: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  const trimmed = location.trim();
  if (trimmed.length > 120) return { ok: false, error: "That location is too long." };

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { stylePrefs: true },
  });
  const prefs = parseStylePrefs(dbUser?.stylePrefs);

  await prisma.user.update({
    where: { id: user.id },
    data: { stylePrefs: encode({ ...prefs, homeLocation: trimmed || undefined }) },
  });
  revalidatePath("/closet/outfits");
  return { ok: true };
}

export type SpinSignalsResponse = {
  context: DailyContext;
  /**
   * Item id → learned affinity, 0..1. A plain object rather than a Map because
   * this crosses the server-action boundary; the client rebuilds the Map.
   */
  affinity: Record<string, number>;
};

/**
 * Everything a smart spin needs, fetched once so spinning itself stays local.
 *
 * The generator's spin button is pressed repeatedly and has to feel immediate,
 * so the model goes to the client rather than the spin coming to the server. The
 * affinity map is a few hundred numbers — cheaper to ship once than to round-trip
 * per press, and it means a smart spin still works while the network is away.
 */
export async function getSpinSignals(localISODate?: string): Promise<SpinSignalsResponse> {
  const user = await requireUser();
  const [context, personal] = await Promise.all([
    getDailyContext(localISODate),
    buildAffinity(user.id),
  ]);
  return { context, affinity: Object.fromEntries(personal.affinity) };
}

function proposalKey(itemIds: readonly string[]): string {
  return [...itemIds].sort().join(",");
}

/**
 * Build today's slate.
 *
 * `rejectedIds` are items the user has already turned down in this session;
 * they are excluded outright rather than merely down-weighted. Re-proposing a
 * piece somebody just rejected reads as not listening, and the cost of dropping
 * it for one day is negligible.
 */
export async function getDailySlate(
  rejectedIds: string[] = [],
  localISODate?: string,
): Promise<DailySlateResponse> {
  const user = await requireUser();
  const [rows, context, personal, rules] = await Promise.all([
    loadWearablePool(user.id),
    getDailyContext(localISODate),
    buildAffinity(user.id),
    loadStyleRules(user.id),
  ]);

  const byId = new Map(rows.map((row) => [row.id, row]));
  const proposals = buildSlate(rows.map(toScorable), slotsForBand(context.band), {
    context: { band: context.band, affinity: personal.affinity },
    posterior: personal.posterior,
    rules,
    ruleContext: { band: context.band },
    exclude: new Set(rejectedIds),
    count: 3,
  });

  return {
    policyId: SLATE_POLICY_ID,
    context,
    proposals: proposals.map((proposal: Proposal) => ({
      key: proposalKey(proposal.itemIds),
      strategy: proposal.strategy,
      score: proposal.score,
      propensity: proposal.propensity,
      items: proposal.itemIds
        .map((id) => byId.get(id))
        .filter((row): row is ScoringRow => !!row)
        .map((row) => ({
          id: row.id,
          name: row.name,
          category: row.category,
          imagePath: row.ghostImagePath ?? row.originalImagePath,
          colors: decode<Color[]>(row.colors, []),
        })),
    })),
  };
}

export type SlateDecisionInput = {
  /** Item ids of the proposal acted on. */
  chosenIds: string[];
  /** Arm that produced the acted-on proposal; logged for off-policy analysis. */
  strategy?: string;
  /** Item ids of every proposal that was passed over, flattened. */
  rejectedIds: string[];
  propensity?: number | null;
  occasion?: string | null;
  /** Caller's local calendar date, "YYYY-MM-DD". */
  wornOnISO?: string;
};

export type DecisionResponse = { ok: true } | { ok: false; error: string };

/**
 * "I'm wearing this."
 *
 * Writes the wear *and* the comparison. The wear is what the dormancy and
 * recurrence models read; the comparison is what the preference model reads.
 * Recording only the wear would throw away the more informative half — a wear
 * says what happened, a choice says what was preferred over what.
 */
export async function acceptProposal(input: SlateDecisionInput): Promise<DecisionResponse> {
  const user = await requireUser();
  if (input.chosenIds.length === 0) return { ok: false, error: "Nothing to log" };

  const context = await getDailyContext();
  const wornOn =
    (input.wornOnISO ? wornOnFromISODate(input.wornOnISO) : null) ??
    wornOnFromLocalDate(new Date());
  const occasion: Occasion | null = parseOccasion(input.occasion);

  await recordWear({
    userId: user.id,
    itemIds: input.chosenIds,
    wornOn,
    source: "explicit",
    context: {
      climateBand: context.band,
      tempHighC: context.highC,
      occasion,
      placeLabel: context.location,
    },
  });

  await recordPreference({
    userId: user.id,
    kind: "accept",
    itemIds: input.chosenIds,
    rejectedIds: input.rejectedIds,
    context: { band: context.band, occasion, surface: "daily", strategy: input.strategy },
    policyId: SLATE_POLICY_ID,
    propensity: input.propensity ?? null,
  });

  revalidatePath("/closet/outfits");
  revalidatePath("/closet");
  return { ok: true };
}

/**
 * "Show me something else."
 *
 * The single most valuable signal in the system: a clean pairwise comparison
 * under identical context, which is exactly what Bradley-Terry consumes. No
 * wear is written — nothing was worn.
 */
export async function rerollProposal(input: SlateDecisionInput): Promise<DecisionResponse> {
  const user = await requireUser();
  if (input.rejectedIds.length === 0) return { ok: false, error: "Nothing to reject" };

  const context = await getDailyContext();
  await recordPreference({
    userId: user.id,
    kind: "reroll",
    // `itemIds` is what the choice was *about*; on a reroll the user chose the
    // unseen alternative, so the rejected set is the informative half and
    // itemIds mirrors it rather than being left empty (the write path requires
    // a non-empty subject).
    itemIds: input.rejectedIds,
    rejectedIds: input.rejectedIds,
    context: { band: context.band, surface: "daily" },
    policyId: SLATE_POLICY_ID,
    propensity: input.propensity ?? null,
  });
  return { ok: true };
}

/** "None of these." Rejects the whole slate at once. */
export async function dismissSlate(input: SlateDecisionInput): Promise<DecisionResponse> {
  const user = await requireUser();
  if (input.rejectedIds.length === 0) return { ok: false, error: "Nothing to dismiss" };

  const context = await getDailyContext();
  await recordPreference({
    userId: user.id,
    kind: "dismiss",
    itemIds: input.rejectedIds,
    rejectedIds: input.rejectedIds,
    context: { band: context.band, surface: "daily" },
    policyId: SLATE_POLICY_ID,
    propensity: input.propensity ?? null,
  });
  return { ok: true };
}
