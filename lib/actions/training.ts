"use server";

/**
 * Training rounds — "help me get better" (docs/OUTFIT_INTELLIGENCE.md §10).
 *
 * ── Why this is the highest-leverage surface in the system ──────────────────
 *
 * Choice data is what Layer 2 learns from, and until now the only source was
 * the daily proposal: one comparison per day, because you only get dressed
 * once. A training round produces one every few seconds. It decouples *how fast
 * the model learns* from *how often the user gets dressed*, which was the
 * binding constraint on the whole personalization layer.
 *
 * Two shapes, both reducing to the same thing:
 *
 *   pick  — three outfits, choose one. A clean `chosen ≻ the other two` under
 *           identical context, which is exactly Bradley-Terry's input.
 *   rate  — one outfit, like or pass. A unary judgement, turned into a
 *           comparison against NEUTRAL_ANCHOR so it can join the same fit.
 *
 * Rounds are built from a Thompson draw on every arm rather than the usual
 * safe/alternative/explore split: the goal here is an *informative* comparison,
 * not a good outfit, and Thompson naturally over-samples the garments we know
 * least about. Asking someone to choose between three things you already knew
 * they liked teaches you nothing.
 */

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { decode, type Color, type Season } from "@/lib/json";
import { NEUTRAL_ANCHOR } from "@/lib/outfit/bradley-terry";
import { buildSlate, slotsForPinned, BASE_SLOTS, SLATE_POLICY_ID } from "@/lib/outfit/slate";
import {
  DEFAULT_SAMPLE_SIZE,
  focusExclusions,
  sampleSizeFor,
  slotsForCategories,
  type TrainingFocus,
  type TrainingMode,
} from "@/lib/outfit/training-focus";
import { loadStyleRules } from "@/lib/wear/style-rules-server";
import { buildAffinity } from "@/lib/wear/affinity-server";
import { recordPreference } from "@/lib/wear/record";

export type TrainingOutfit = {
  key: string;
  items: { id: string; name: string; imagePath: string; colors: Color[] }[];
};

export type TrainingRound = {
  outfits: TrainingOutfit[];
  /** Comparisons recorded so far — the user's sense of progress. */
  answered: number;
  /** Echoed back so the client can tell a clamped round from what it asked for. */
  mode: TrainingMode;
  sampleSize: number;
};

export type TrainingRoundInput = {
  mode?: TrainingMode;
  /** Outfits per round, 2–8 for pick/rate. Swipe is always 1. */
  sampleSize?: number;
  focus?: TrainingFocus;
};

/**
 * Build one round.
 *
 * `sampleSize` outfits for pick/rate, one for swipe. Deliberately weather- and
 * occasion-free: a training round is about taste in the abstract, and pinning it
 * to today's forecast would only teach the model about today.
 *
 * Focus narrows it — pinned pieces appear in every outfit, category and colour
 * filters restrict the free ones. Both are applied as exclusions before the
 * slate is built, so the constraint is structural rather than a preference the
 * sampler might overrule.
 */
export async function getTrainingRound(input: TrainingRoundInput = {}): Promise<TrainingRound> {
  const user = await requireUser();
  const mode = input.mode ?? "pick";
  const focus = input.focus ?? {};
  const count = sampleSizeFor(mode, input.sampleSize ?? DEFAULT_SAMPLE_SIZE);

  const [rows, personal, rules, answered] = await Promise.all([
    prisma.wardrobeItem.findMany({
      where: { userId: user.id, isWishlist: false, saleListing: { is: null } },
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
    }),
    buildAffinity(user.id),
    loadStyleRules(user.id),
    prisma.preferenceEvent.count({
      where: { userId: user.id, kind: { in: ["train_pick", "train_rate"] } },
    }),
  ]);

  const byId = new Map(rows.map((row) => [row.id, row]));
  const candidates = rows.map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    subcategory: row.subcategory,
    material: row.material,
    pattern: row.pattern,
    colors: decode<Color[]>(row.colors, []),
    season: decode<Season[]>(row.season, []),
  }));

  // Only pin pieces the user actually owns and can wear — a stale id from the
  // client would otherwise make every proposal fail its own pin check and
  // return an empty round with no explanation.
  const pinned = (focus.pinnedItemIds ?? []).filter((id) => byId.has(id));
  // A category focus decides the outfit's shape, not just which pieces are
  // eligible for a fixed one. Absent a focus the default top/bottom/shoes shape
  // stands.
  const shape = slotsForCategories(focus.categories) ?? BASE_SLOTS;
  const proposals = buildSlate(candidates, slotsForPinned(candidates, pinned, shape), {
    context: { affinity: personal.affinity },
    posterior: personal.posterior,
    rules,
    // Every arm explores: the point is to learn, not to flatter.
    uniformStrategy: "explore",
    count,
    pinned,
    exclude: focusExclusions(candidates, { ...focus, pinnedItemIds: pinned }),
  });

  return {
    answered,
    mode,
    sampleSize: count,
    outfits: proposals.map((proposal) => ({
      key: [...proposal.itemIds].sort().join(","),
      items: proposal.itemIds
        .map((id) => byId.get(id))
        .filter((row): row is NonNullable<typeof row> => !!row)
        .map((row) => ({
          id: row.id,
          name: row.name,
          imagePath: row.ghostImagePath ?? row.originalImagePath,
          colors: decode<Color[]>(row.colors, []),
        })),
    })),
  };
}

export type TrainingResponse = { ok: true; answered: number } | { ok: false; error: string };

/** "This one." Records `chosen ≻ every other outfit shown`. */
export async function recordTrainingPick(
  chosenIds: string[],
  rejectedIds: string[],
): Promise<TrainingResponse> {
  const user = await requireUser();
  if (chosenIds.length === 0 || rejectedIds.length === 0) {
    return { ok: false, error: "Nothing to compare" };
  }

  await recordPreference({
    userId: user.id,
    kind: "train_pick",
    itemIds: chosenIds,
    rejectedIds,
    context: { surface: "training" },
    policyId: SLATE_POLICY_ID,
  });

  return { ok: true, answered: await countAnswered(user.id) };
}

/**
 * Like or pass on a single outfit.
 *
 * Stored as a comparison against NEUTRAL_ANCHOR — liked ≻ anchor, anchor ≻
 * passed — so a unary judgement joins the same Bradley-Terry fit as everything
 * else, without inventing a comparison between two outfits the user never saw
 * side by side.
 */
export async function recordTrainingRate(
  itemIds: string[],
  liked: boolean,
): Promise<TrainingResponse> {
  const user = await requireUser();
  if (itemIds.length === 0) return { ok: false, error: "Nothing to rate" };

  await recordPreference({
    userId: user.id,
    kind: "train_rate",
    itemIds: liked ? itemIds : [NEUTRAL_ANCHOR],
    rejectedIds: liked ? [NEUTRAL_ANCHOR] : itemIds,
    context: { surface: "training", liked },
    policyId: SLATE_POLICY_ID,
  });

  return { ok: true, answered: await countAnswered(user.id) };
}

function countAnswered(userId: string): Promise<number> {
  return prisma.preferenceEvent.count({
    where: { userId, kind: { in: ["train_pick", "train_rate"] } },
  });
}
