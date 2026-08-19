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
import {
  buildSlate,
  slotsForPinned,
  usablePropensity,
  BASE_SLOTS,
  SLATE_POLICY_ID,
  type SlateStrategy,
} from "@/lib/outfit/slate";
import {
  DEFAULT_SAMPLE_SIZE,
  focusExclusions,
  sampleSizeFor,
  slotsForCategories,
  type TrainingFocus,
  type TrainingMode,
} from "@/lib/outfit/training-focus";
import { PRIOR_STDEV } from "@/lib/outfit/posterior";
import { loadStyleRules } from "@/lib/wear/style-rules-server";
import { buildAffinity } from "@/lib/wear/affinity-server";
import { recordPreference } from "@/lib/wear/record";

export type TrainingOutfit = {
  key: string;
  items: { id: string; name: string; imagePath: string; colors: Color[] }[];
  /**
   * P(this exact set | policy) — the product of the per-slot softmax
   * probabilities that produced it.
   *
   * Returned so the client can hand it back with the answer. Without the round
   * trip the number is gone: it exists only while the slate is being built, and
   * it is impossible to reconstruct afterwards because the sampler's slot order
   * and candidate pool are not recorded anywhere.
   *
   * Every training arm is `explore`, so this is conditional on that round's
   * Thompson draw rather than marginal over draws. That makes these rows
   * mutually comparable — they are all drawn the same way — and *not*
   * comparable with a marginal propensity from some future non-explore surface.
   * `strategy` is logged alongside so the boundary is visible in the data.
   */
  propensity: number;
  strategy: SlateStrategy;
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
      where: { userId: user.id, kind: { in: ["train_pick", "train_rate", "train_item"] } },
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
      propensity: proposal.propensity,
      strategy: proposal.strategy,
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

/**
 * "This one." Records `chosen ≻ every other outfit shown`, one comparison each.
 *
 * Takes the whole round rather than a chosen set and a pooled remainder, because
 * the pooled form could only ever express one comparison. A tap on one of n
 * outfits expresses n−1 of them, so at the eight-outfit setting the old shape
 * discarded roughly six sevenths of the answer — and made the loser side
 * lopsided enough that a model could fit its composition as taste. The mode hint
 * already promised the stronger reading: "your pick beat every other outfit on
 * screen".
 *
 * `propensity` is the chosen arm's P(set | policy), echoed back from the round
 * (`TrainingOutfit.propensity`). It is what makes off-policy evaluation possible
 * — `pnpm eval:ranker` can compare a future ranker against this one on these
 * rows instead of needing a live A/B test — and it cannot be recovered after the
 * fact, which is why it is collected now rather than when a second ranker exists.
 * A missing or malformed value is stored as null; see `usablePropensity`.
 */
export async function recordTrainingPick(
  arms: string[][],
  chosenArm: number,
  propensity?: number | null,
): Promise<TrainingResponse> {
  const user = await requireUser();
  if (!Array.isArray(arms) || arms.length < 2) {
    return { ok: false, error: "Nothing to compare" };
  }
  if (!Number.isInteger(chosenArm) || chosenArm < 0 || chosenArm >= arms.length) {
    return { ok: false, error: "No pick to record" };
  }

  // Both sets are derived here rather than sent: the chosen and pooled forms have
  // to agree with `arms` or a reader gets two different answers about the same
  // tap, and the client has no reason to be the one deciding that.
  const chosenIds = [...new Set(arms[chosenArm])].filter(Boolean);
  if (chosenIds.length === 0) return { ok: false, error: "Nothing to compare" };
  const chosen = new Set(chosenIds);
  const rejectedIds = [
    ...new Set(arms.flatMap((arm, index) => (index === chosenArm ? [] : arm))),
  ].filter((id) => id && !chosen.has(id));
  if (rejectedIds.length === 0) return { ok: false, error: "Nothing to compare" };

  await recordPreference({
    userId: user.id,
    kind: "train_pick",
    itemIds: chosenIds,
    // Still written, so anything reading the old shape keeps working — including
    // the 53 pooled rows this now sits alongside.
    rejectedIds,
    arms,
    chosenArm,
    // Every training arm explores, so the propensity above is conditional on the
    // round's Thompson draw. Logged so an estimator can segment on it rather
    // than discovering the distinction by being wrong.
    context: { surface: "training", strategy: "explore" },
    policyId: SLATE_POLICY_ID,
    propensity: usablePropensity(propensity),
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
  propensity?: number | null,
): Promise<TrainingResponse> {
  const user = await requireUser();
  if (itemIds.length === 0) return { ok: false, error: "Nothing to rate" };

  await recordPreference({
    userId: user.id,
    kind: "train_rate",
    itemIds: liked ? itemIds : [NEUTRAL_ANCHOR],
    rejectedIds: liked ? [NEUTRAL_ANCHOR] : itemIds,
    context: { surface: "training", liked, strategy: "explore" },
    policyId: SLATE_POLICY_ID,
    // The propensity of the outfit that was shown — the same number whether it
    // was liked or passed. Which side of the comparison it landed on is the
    // *reward*, not the probability of showing it.
    propensity: usablePropensity(propensity),
  });

  return { ok: true, answered: await countAnswered(user.id) };
}

function countAnswered(userId: string): Promise<number> {
  return prisma.preferenceEvent.count({
    where: { userId, kind: { in: ["train_pick", "train_rate", "train_item"] } },
  });
}

/**
 * ── Piece rounds: the affinity signal, on its own ──────────────────────────
 *
 * Every other training mode asks about an outfit, which is compatibility
 * evidence with item taste tangled into it. §1 is explicit that affinity and
 * compatibility are different quantities that must not be conflated, and until
 * now nothing collected the first one directly: a three-piece pick spreads its
 * weight across three garments and no answer can say which piece earned it.
 *
 * `pnpm eval:ranker` showed what that costs. Layer 2's coefficients came out as
 * a colour preference — the same thing Layer 1's dominant term already encodes —
 * because outfit-level colour averages were the clearest signal in the data. One
 * garment at a time removes the averaging.
 */

export type TrainingPiece = {
  id: string;
  name: string;
  imagePath: string;
  colors: Color[];
  category: string;
  /** How little is known about this garment, 0..1. Drives the queue order. */
  novelty: number;
};

export type PieceRound = {
  pieces: TrainingPiece[];
  /** Pieces rated so far, and how many the closet holds. */
  rated: number;
  total: number;
};

/**
 * The garments worth asking about next.
 *
 * Ordered by posterior uncertainty — `noveltyScore`, the same quantity the
 * explore slot and the dormancy lens read — so the round leads with the pieces
 * the model knows least about. Rating one lowers its uncertainty, so it falls out
 * of the queue on its own and the sweep converges instead of re-asking.
 *
 * Deliberately deterministic. A sampled order would re-show a garment the user
 * just judged, and there is nothing to explore here: the question is about one
 * piece in isolation, so there is no slate whose composition could be varied.
 */
export async function getPieceRound(requested?: number): Promise<PieceRound> {
  const user = await requireUser();
  const count = sampleSizeFor("pieces", requested ?? DEFAULT_SAMPLE_SIZE);

  const [rows, personal, rated] = await Promise.all([
    prisma.wardrobeItem.findMany({
      where: { userId: user.id, isWishlist: false, saleListing: { is: null } },
      select: {
        id: true,
        name: true,
        category: true,
        colors: true,
        effectiveWears: true,
        originalImagePath: true,
        ghostImagePath: true,
      },
    }),
    buildAffinity(user.id),
    prisma.preferenceEvent.count({ where: { userId: user.id, kind: "train_item" } }),
  ]);

  const pieces = rows
    .map((row) => ({
      id: row.id,
      name: row.name,
      category: row.category,
      imagePath: row.ghostImagePath ?? row.originalImagePath,
      colors: decode<Color[]>(row.colors, []),
      // Read from the posterior rather than recomputed, so the queue and the
      // explore slot cannot disagree about which garments are under-explored.
      novelty:
        (personal.posterior.stdev.get(row.id) ?? PRIOR_STDEV) / PRIOR_STDEV,
    }))
    .sort((a, b) => b.novelty - a.novelty || a.id.localeCompare(b.id))
    .slice(0, count);

  return { pieces, rated, total: rows.length };
}

/**
 * "I like this piece" / "I don't."
 *
 * Stored against NEUTRAL_ANCHOR exactly as an outfit rating is, so it joins the
 * same Bradley-Terry fit with no special case. Unlike an outfit rating it also
 * trains the shared coefficients: a single garment against the anchor is a real
 * feature contrast, because a centred feature vector means "how this differs from
 * the average garment" and one piece — unlike a three-piece look — is a fair draw
 * from the closet. See `isFeatureContrast` in lib/outfit/bradley-terry.ts.
 *
 * No propensity: the decision being logged is a judgement about one garment, not
 * a choice among alternatives, so there is no ranking policy whose value an
 * off-policy estimator could recover from it. Logging a number here would invite
 * exactly the mistake §5B warns about.
 */
export async function recordPieceRating(
  itemId: string,
  liked: boolean,
): Promise<TrainingResponse> {
  const user = await requireUser();
  if (!itemId) return { ok: false, error: "Nothing to rate" };

  // Scoped to the caller's own closet: a stray id would otherwise attach one
  // person's taste to another person's garment.
  const owned = await prisma.wardrobeItem.findFirst({
    where: { id: itemId, userId: user.id, isWishlist: false },
    select: { id: true },
  });
  if (!owned) return { ok: false, error: "Unknown piece" };

  await recordPreference({
    userId: user.id,
    kind: "train_item",
    itemIds: liked ? [owned.id] : [NEUTRAL_ANCHOR],
    rejectedIds: liked ? [NEUTRAL_ANCHOR] : [owned.id],
    context: { surface: "training", liked, mode: "pieces" },
    policyId: SLATE_POLICY_ID,
  });

  return { ok: true, answered: await countAnswered(user.id) };
}
