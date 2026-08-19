/**
 * Does the outfit ranker beat chance?
 * Run with: pnpm eval:ranker   (JSON=1 for machine-readable output)
 *
 * ── The question ────────────────────────────────────────────────────────────
 *
 * docs/OUTFIT_INTELLIGENCE.md §8 says to run an offline evaluation "before
 * shipping anything". All six phases in §9 shipped without one, so five layers
 * of scoring are live and nothing has ever checked whether any of them beat
 * uniform random. This script is that check.
 *
 * It replays the logged choice history: for each recorded decision, score the
 * outfit the user picked against the outfits they passed over, and count how
 * often the ranker agrees with them. Then ablate — zero one term at a time — to
 * see which layers are carrying the result and which are along for the ride.
 *
 * ── What it can and cannot answer ───────────────────────────────────────────
 *
 * Reads the *dev database*, so it measures one real closet and one person's
 * taste. That is the population the feature has, and a number from it is worth
 * more than a synthetic benchmark — but it is not a claim about users in
 * general, and the sample sizes it prints are the first thing to read.
 *
 * lib/eval/ranker.ts holds the metrics, pure and unit-tested. This file is only
 * data loading and reporting.
 */

import { PrismaClient } from "@prisma/client";
import { decode, type Color, type Season } from "@/lib/json";
import { hasBilinearWeights } from "@/lib/outfit/bilinear";
import { scoreOutfit, type ScorableItem, type ScoringContext } from "@/lib/outfit/compatibility";
import { fitBradleyTerry, NEUTRAL_ANCHOR } from "@/lib/outfit/bradley-terry";
import { buildFeatureMap, describeWeights } from "@/lib/outfit/features";
import { mulberry32 } from "@/lib/outfit/sampling";
import { decodeEmbedding } from "@/lib/wear/embedding";
import { decodeArms, isPreferenceKind } from "@/lib/wear/signals";
import {
  ABLATIONS,
  accuracyForPerCase,
  affinityFromCases,
  comparisonsFor,
  FULL_WEIGHTS,
  looAccuracy,
  looAffinityMaps,
  makeScorer,
  MIN_SNIPS_SAMPLE,
  protectRate,
  randomControl,
  rateAuc,
  rivalsFor,
  snips,
  type Accuracy,
  type EvalCase,
  type RatedOutfit,
  type SnipsInput,
  type TermWeights,
} from "@/lib/eval/ranker";

const prisma = new PrismaClient();
const AS_JSON = process.env.JSON === "1";
/** Fixed so two runs of the control produce the same number. */
const RANDOM_SEED = Number(process.env.SEED ?? 20260810);

function safeIds(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function bandOf(contextJson: string | null): string | null {
  if (!contextJson) return null;
  try {
    const parsed = JSON.parse(contextJson) as { band?: unknown };
    return typeof parsed.band === "string" ? parsed.band : null;
  } catch {
    return null;
  }
}

function likedOf(contextJson: string | null): boolean | null {
  if (!contextJson) return null;
  try {
    const parsed = JSON.parse(contextJson) as { liked?: unknown };
    return typeof parsed.liked === "boolean" ? parsed.liked : null;
  } catch {
    return null;
  }
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

async function main() {
  const userId =
    process.env.USER_ID ??
    (await prisma.user.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } }))?.id;
  if (!userId) throw new Error("No user in the database — seed one first (pnpm db:seed)");

  const [rows, embeddingRows, events, totalItems, protectedItems] = await Promise.all([
    // Every non-wishlist item, including sold and for-sale ones: the log
    // references what was in the closet *then*, and dropping since-listed items
    // would silently delete cases rather than measure them.
    prisma.wardrobeItem.findMany({
      where: { userId, isWishlist: false },
      select: {
        id: true,
        name: true,
        category: true,
        subcategory: true,
        material: true,
        pattern: true,
        colors: true,
        season: true,
      },
    }),
    prisma.itemEmbedding.findMany({ select: { itemId: true, vector: true } }),
    prisma.preferenceEvent.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        kind: true,
        itemIds: true,
        rejectedIds: true,
        contextJson: true,
        policyId: true,
        propensity: true,
        armsJson: true,
        chosenArm: true,
      },
    }),
    prisma.wardrobeItem.count({ where: { userId, isWishlist: false } }),
    prisma.wardrobeItem.count({ where: { userId, isWishlist: false, protectedAt: { not: null } } }),
  ]);

  const byId = new Map<string, ScorableItem>(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        name: row.name,
        category: row.category,
        subcategory: row.subcategory,
        material: row.material,
        pattern: row.pattern,
        colors: decode<Color[]>(row.colors, []),
        season: decode<Season[]>(row.season, []),
      },
    ]),
  );

  const embeddings = new Map<string, Float32Array>();
  for (const row of embeddingRows) {
    if (byId.has(row.itemId)) embeddings.set(row.itemId, decodeEmbedding(row.vector));
  }

  // Centred on the whole closet, not on the compared subset — see buildFeatureMap.
  const { features } = buildFeatureMap(byId.values());

  // ── Case construction ────────────────────────────────────────────────────
  //
  // Three disjoint groups, because they answer different questions:
  //   contrastive — chosen vs. passed-over, both sides real garments
  //   rated       — unary like/pass, one side is NEUTRAL_ANCHOR
  //   unusable    — rerolls (nothing was chosen) and rows whose items are gone
  const contrastive: EvalCase[] = [];
  const rated: RatedOutfit[] = [];
  const ratedPieces: RatedOutfit[] = [];
  const signalCases: EvalCase[] = [];
  let unusable = 0;
  let missingItems = 0;

  for (const event of events) {
    if (!isPreferenceKind(event.kind)) continue;
    const chosenRaw = safeIds(event.itemIds);
    const rejectedRaw = safeIds(event.rejectedIds);

    const evalCase: EvalCase = {
      id: event.id,
      kind: event.kind,
      policyId: event.policyId,
      band: bandOf(event.contextJson),
      chosen: chosenRaw,
      rejectedPool: rejectedRaw,
      arms: decodeArms(event.armsJson),
      chosenArm: event.chosenArm,
      propensity: event.propensity,
    };
    // Fed to the Bradley-Terry fit exactly as buildAffinity would, anchors and
    // all — the in-sample affinity map has to match production's.
    signalCases.push(evalCase);

    if (event.kind === "train_item") {
      const liked = likedOf(event.contextJson);
      const itemId = (liked === false ? rejectedRaw : chosenRaw).find(
        (id) => id !== NEUTRAL_ANCHOR,
      );
      if (liked == null || !itemId) {
        unusable += 1;
        continue;
      }
      if (!byId.has(itemId)) {
        missingItems += 1;
        continue;
      }
      ratedPieces.push({ itemIds: [itemId], liked });
      continue;
    }

    if (event.kind === "train_rate") {
      const liked = likedOf(event.contextJson);
      const outfit = (liked === false ? rejectedRaw : chosenRaw).filter(
        (id) => id !== NEUTRAL_ANCHOR,
      );
      if (liked == null || outfit.length === 0) {
        unusable += 1;
        continue;
      }
      if (outfit.some((id) => !byId.has(id))) {
        missingItems += 1;
        continue;
      }
      rated.push({ itemIds: outfit, liked });
      continue;
    }

    const chosen = chosenRaw.filter((id) => id !== NEUTRAL_ANCHOR);
    const rejectedPool = rejectedRaw.filter((id) => id !== NEUTRAL_ANCHOR);
    // A reroll records what was turned down with nothing to compare it against,
    // so it cannot be read as chosen ≻ rival. It still trains nothing in Layer 2
    // (polarity −1), which is why it only appears in this count.
    if (chosen.length === 0 || rejectedPool.length === 0) {
      unusable += 1;
      continue;
    }
    if ([...chosen, ...rejectedPool].some((id) => !byId.has(id))) {
      missingItems += 1;
      continue;
    }
    contrastive.push({ ...evalCase, chosen, rejectedPool });
  }

  const contextFor = (evalCase: EvalCase): ScoringContext => ({
    band: (evalCase.band ?? null) as ScoringContext["band"],
    embeddings,
  });
  // One context for the whole-set metrics. Training rounds are deliberately
  // weather-free (§10), so most cases carry no band and the climate term has no
  // opinion on them either way.
  const flatContext: ScoringContext = { embeddings };

  // In-sample affinity: what production would have used, fit on everything.
  const inSampleAffinity = affinityFromCases(signalCases, features);

  // ── Term coverage ────────────────────────────────────────────────────────
  //
  // Which terms actually had an opinion. A term that is null everywhere is
  // inert, and no ablation of it can move a number — worth knowing before
  // reading the ablation table as evidence about design.
  const coverage = { color: 0, formality: 0, climate: 0, bilinear: 0, affinity: 0 };
  for (const evalCase of contrastive) {
    const items = evalCase.chosen
      .map((id) => byId.get(id))
      .filter((item): item is ScorableItem => !!item);
    const breakdown = scoreOutfit(items, {
      ...contextFor(evalCase),
      affinity: inSampleAffinity,
    });
    if (breakdown.color != null) coverage.color += 1;
    if (breakdown.formality != null) coverage.formality += 1;
    if (breakdown.climate != null) coverage.climate += 1;
    if (breakdown.bilinear != null) coverage.bilinear += 1;
    if (breakdown.affinity != null) coverage.affinity += 1;
  }

  // ── Ablations, on leave-one-out folds ────────────────────────────────────
  //
  // Every row uses an affinity map fit without the case being scored. The folds
  // depend only on the cases, so they are computed once and shared across the
  // eight weight sets.
  const affinityMaps = looAffinityMaps(contrastive, features);
  const ablationResults = ABLATIONS.map((ablation) => ({
    label: ablation.label,
    result: looAccuracy(contrastive, byId, contextFor, ablation.weights, affinityMaps),
  }));

  // ── Contextual vs identity Bradley-Terry ─────────────────────────────────
  //
  // The same held-out cases scored under both Layer 2 models. Identity is what
  // shipped before: one free parameter per garment, 183 of them against 59
  // comparisons. Contextual shares a coefficient vector over features, so a
  // choice about one garment informs every similar one.
  const identityMaps = looAffinityMaps(contrastive);
  const AFFINITY_ONLY: TermWeights = {
    color: 0,
    formality: 0,
    climate: 0,
    bilinear: 0,
    affinity: FULL_WEIGHTS.affinity,
  };
  const modelComparison = [
    {
      label: "full, identity BT",
      result: looAccuracy(contrastive, byId, contextFor, FULL_WEIGHTS, identityMaps),
    },
    {
      label: "full, contextual BT",
      result: looAccuracy(contrastive, byId, contextFor, FULL_WEIGHTS, affinityMaps),
    },
    {
      label: "affinity only, identity BT",
      result: looAccuracy(contrastive, byId, contextFor, AFFINITY_ONLY, identityMaps),
    },
    {
      label: "affinity only, contextual BT",
      result: looAccuracy(contrastive, byId, contextFor, AFFINITY_ONLY, affinityMaps),
    },
  ];

  // Coverage is the other half of the story: the identity model can only hold an
  // opinion about items it has seen compared, and the report should say how many
  // that leaves out.
  const identityCoverage = identityMaps[0]?.size ?? 0;
  const contextualCoverage = affinityMaps[0]?.size ?? 0;

  // The fitted coefficients, on the whole log — what the model learned about
  // this person's taste, in readable terms.
  const wholeFit = fitBradleyTerry(signalCases.flatMap(comparisonsFor), {
    anchorId: NEUTRAL_ANCHOR,
    features,
  });

  // The same thing scored with production's whole-log affinity map. Kept only as
  // a contamination gauge, so it has to differ from the row above in exactly one
  // respect — hence the same per-case context, not the flat one.
  const contaminated = accuracyForPerCase(contrastive, byId, (evalCase) =>
    makeScorer(byId, { ...contextFor(evalCase), affinity: inSampleAffinity }, FULL_WEIGHTS),
  );
  const identityContaminated = accuracyForPerCase(contrastive, byId, (evalCase) =>
    makeScorer(
      byId,
      { ...contextFor(evalCase), affinity: affinityFromCases(signalCases) },
      FULL_WEIGHTS,
    ),
  );

  const control = randomControl(contrastive, byId, (replicate) =>
    mulberry32(RANDOM_SEED + replicate),
  );

  // ── Rate AUC ─────────────────────────────────────────────────────────────
  //
  // Affinity fit on the *pick* rows only, so the rated outfits are genuinely
  // held out — the whole-log map includes these very judgements.
  const pickOnlyAffinity = affinityFromCases(
    signalCases.filter((evalCase) => evalCase.kind !== "train_rate"),
    features,
  );
  const auc = rateAuc(
    rated,
    makeScorer(byId, { ...flatContext, affinity: pickOnlyAffinity }, FULL_WEIGHTS),
  );
  const aucLayer1 = rateAuc(
    rated,
    makeScorer(byId, flatContext, { ...FULL_WEIGHTS, affinity: 0 }),
  );

  // Item-level AUC. Held out by construction from the *pick* map, which never
  // saw a train_item row; the in-sample column is there to show the gap.
  const pieceAuc = rateAuc(
    ratedPieces,
    makeScorer(byId, { ...flatContext, affinity: pickOnlyAffinity }, AFFINITY_ONLY),
  );
  const pieceAucInSample = rateAuc(
    ratedPieces,
    makeScorer(byId, { ...flatContext, affinity: inSampleAffinity }, AFFINITY_ONLY),
  );

  // ── SNIPS ────────────────────────────────────────────────────────────────
  //
  // Target propensity is left equal to the logged one, so every importance
  // weight is 1 and the estimate reduces to the mean observed reward. That is
  // the correct null case: with no second ranker to compare against there is no
  // target policy, and the point of running it now is to prove the plumbing —
  // and to surface how few rows carry a propensity at all.
  const snipsRows: SnipsInput[] = contrastive
    .filter((evalCase) => evalCase.propensity != null)
    .map((evalCase) => ({
      reward: evalCase.kind === "accept" ? 1 : 0,
      logged: evalCase.propensity as number,
      target: evalCase.propensity as number,
    }));
  const snipsResult = snips(snipsRows);
  const propensityCoverage = {
    withPropensity: events.filter((event) => event.propensity != null).length,
    total: events.length,
  };

  const byPolicy = new Map<string, number>();
  for (const evalCase of contrastive) {
    const key = evalCase.policyId ?? "(none)";
    byPolicy.set(key, (byPolicy.get(key) ?? 0) + 1);
  }

  const rivalShapes = contrastive.map((evalCase) => rivalsFor(evalCase, byId));
  const cappedCases = rivalShapes.filter((shape) => shape.capped).length;
  const loggedArmCases = rivalShapes.filter((shape) => shape.logged).length;
  // How many comparisons the log now yields, against one per answer before.
  const comparisonCount = contrastive.flatMap(comparisonsFor).length;

  if (AS_JSON) {
    console.log(
      JSON.stringify(
        {
          userId,
          closet: { items: totalItems, embedded: embeddings.size },
          cases: {
            contrastive: contrastive.length,
            rated: rated.length,
            unusable,
            missingItems,
            byPolicy: Object.fromEntries(byPolicy),
            loggedArmCases,
            comparisonCount,
          },
          coverage,
          bilinearWeightsLoaded: hasBilinearWeights(),
          ablations: ablationResults,
          modelComparison,
          layer2Coverage: { identity: identityCoverage, contextual: contextualCoverage },
          weights: describeWeights(wholeFit.weights),
          featureCredit: wholeFit.featureCredit,
          contaminatedFull: contaminated,
          contaminatedIdentity: identityContaminated,
          control,
          auc,
          aucLayer1,
          pieceAuc,
          pieceAucInSample,
          ratedPieces: ratedPieces.length,
          snips: snipsResult,
          propensityCoverage,
          protectRate: protectRate(protectedItems, totalItems),
        },
        null,
        2,
      ),
    );
    return;
  }

  const line = (label: string, value: string) => `  ${label.padEnd(30)}${value}`;
  const row = (label: string, accuracy: Accuracy) =>
    `  ${label.padEnd(30)}${pct(accuracy.pairwise).padStart(7)} ±${pct(accuracy.pairwiseStderr).padStart(5)}  ${pct(accuracy.top1).padStart(7)}   ${String(accuracy.cases).padStart(4)}  ${String(accuracy.pairs).padStart(5)}`;

  console.log("\n══ Ranker evaluation (docs/OUTFIT_INTELLIGENCE.md §8) ══\n");
  console.log("Data");
  console.log(line("closet items", String(totalItems)));
  console.log(line("with embeddings", `${embeddings.size} (${pct(embeddings.size / Math.max(1, totalItems))})`));
  console.log(line("preference events", String(events.length)));
  console.log(line("contrastive cases", String(contrastive.length)));
  console.log(line("rated (like/pass) cases", String(rated.length)));
  console.log(line("unusable (no rival logged)", String(unusable)));
  console.log(
    line(
      "rivals read from the log",
      `${loggedArmCases}/${contrastive.length} cases (rest reconstructed)`,
    ),
  );
  console.log(
    line("comparisons for the fit", `${comparisonCount} from ${contrastive.length} answers`),
  );
  console.log(line("dropped (item deleted)", String(missingItems)));
  for (const [policy, count] of byPolicy) {
    console.log(line(`  policy ${policy}`, `${count} cases`));
  }
  if (byPolicy.size > 1) {
    console.log(
      "\n  ! Cases span more than one policy id. §5B: rows from different rankers are\n" +
        "    not comparable. Re-run with USER_ID set, or segment before drawing conclusions.",
    );
  }
  if (cappedCases > 0) {
    console.log(line("rival enumeration capped on", `${cappedCases} cases — accuracy is partial`));
  }

  console.log("\nTerm coverage (how often each term had an opinion, over contrastive cases)");
  const n = Math.max(1, contrastive.length);
  console.log(line("colour", pct(coverage.color / n)));
  console.log(line("formality", pct(coverage.formality / n)));
  console.log(line("climate", pct(coverage.climate / n)));
  console.log(
    line("bilinear", `${pct(coverage.bilinear / n)}  (weights loaded: ${hasBilinearWeights()})`),
  );
  console.log(line("affinity (layer 2)", pct(coverage.affinity / n)));

  console.log("\nAblations — Layer 2 refit per case, leaving that case out");
  console.log(`  ${"".padEnd(30)}pairwise         top-1  cases  pairs`);
  for (const ablation of ablationResults) console.log(row(ablation.label, ablation.result));
  console.log(
    `\n  chance level                  ${pct(control.mean).padStart(7)} ±${pct(control.stdev).padStart(5)}  (${control.replicates} random rankers)`,
  );
  console.log(
    "\n  The control is a check on the harness, not the ranker: it should sit on 50%,\n" +
      "  and its spread is the noise floor for every row above. ± is clustered by\n" +
      "  case, not by pair — pairs within one case share a chosen outfit.",
  );

  console.log("\nLayer 2: contextual vs identity Bradley-Terry");
  console.log(`  ${"".padEnd(30)}pairwise         top-1  cases  pairs`);
  for (const entry of modelComparison) console.log(row(entry.label, entry.result));
  console.log(
    line("items with an opinion", `${identityCoverage} identity → ${contextualCoverage} contextual`),
  );

  console.log("\nContamination gauge (memorization = in-sample − leave-one-out)");
  console.log(
    line(
      "identity BT",
      `${pct(identityContaminated.pairwise)} in-sample vs ${pct(modelComparison[0].result.pairwise)} LOO`,
    ),
  );
  console.log(
    line(
      "contextual BT",
      `${pct(contaminated.pairwise)} in-sample vs ${pct(modelComparison[1].result.pairwise)} LOO`,
    ),
  );
  console.log(
    "  Production fits Layer 2 on every logged choice, so scoring a logged choice\n" +
      "  with it grades the model on its own training data. A model that generalizes\n" +
      "  has a small gap here; one that memorizes has a large one.",
  );

  console.log("\nWhat the contextual model learned (whole log, strongest first)");
  for (const { name, weight } of describeWeights(wholeFit.weights).slice(0, 6)) {
    console.log(line(`  ${name}`, weight.toFixed(4)));
  }
  console.log(
    line("feature credit", `${wholeFit.featureCredit.toFixed(2)} comparisons-equivalent`),
  );

  console.log("\nLike/pass separation (training rate mode, affinity fit on picks only)");
  console.log(
    line("AUC, full", auc.auc == null ? `n/a (liked ${auc.liked}, passed ${auc.passed})` : `${auc.auc.toFixed(3)}  (liked ${auc.liked}, passed ${auc.passed})`),
  );
  console.log(
    line(
      "AUC, layer 1 only",
      aucLayer1.auc == null ? `not yet — ${aucLayer1.reason}` : aucLayer1.auc.toFixed(3),
    ),
  );

  console.log("\nPiece ratings (single garments — the direct affinity signal)");
  // Not "of 180": the mode's queue excludes for-sale pieces, so the two
  // denominators would not match what the UI shows.
  console.log(line("rated pieces", String(ratedPieces.length)));
  console.log(
    line(
      "AUC, affinity only",
      pieceAuc.auc == null
        ? `not yet — ${pieceAuc.reason}`
        : `${pieceAuc.auc.toFixed(3)} held out  ${pieceAucInSample.auc?.toFixed(3) ?? "n/a"} in-sample  (liked ${pieceAuc.liked}, passed ${pieceAuc.passed})`,
    ),
  );
  console.log(
    "  Asks whether Layer 2 alone can tell a garment you like from one you passed\n" +
      "  on. Unlike every other row here the question is item-level, so nothing has\n" +
      "  to be disentangled from an outfit average first.",
  );

  console.log("\nOff-policy (SNIPS)");
  console.log(
    line("propensity logged on", `${propensityCoverage.withPropensity}/${propensityCoverage.total} events`),
  );
  if (snipsResult.estimate == null) {
    console.log(line("estimate", `not runnable — ${snipsResult.reason}`));
    console.log(
      `\n  Needs ${MIN_SNIPS_SAMPLE}+ rows carrying a propensity. The training surface logs one\n` +
        "  on every answer now; rows recorded before that landed carry null and cannot\n" +
        "  be backfilled, so this unlocks as new answers accumulate. Once it does, a\n" +
        "  second ranker can be scored on these rows without a live A/B test.",
    );
  } else {
    console.log(line("estimate", snipsResult.estimate.toFixed(3)));
    console.log(line("effective sample", snipsResult.effectiveSample.toFixed(1)));
  }

  console.log("\nGuardrail");
  const rate = protectRate(protectedItems, totalItems);
  console.log(
    line("protect rate", rate == null ? "n/a" : `${pct(rate)} (${protectedItems}/${totalItems})`),
  );
  console.log(
    "  Baseline for §8's guardrail: a rising rate means the dormancy lens is\n" +
      "  overreaching. Compare against this run, not against an absolute target.\n",
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
