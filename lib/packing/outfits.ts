/**
 * Turning a packed bag into a day-by-day plan.
 *
 * This is the output contract the whole feature was missing. A packing *list*
 * can be badly wrong and still look plausible — the bag that contained four
 * bottoms and no tops rendered as a perfectly tidy list of eleven items. A
 * *schedule* cannot hide that: Tuesday either has a shirt or it doesn't.
 *
 * It also gets the wardrobe-database payoff that generic packing apps can't
 * reach. They know garment types; this knows the actual garments and their
 * colours, so it can say "Tue: the grey tee, the black jeans, the white
 * trainers" and check that those three things go together.
 *
 * Colour is the only signal rich enough to do that check on real data — 100%
 * populated from a closed 15-name vocabulary, against `styleTags` at 7.2% and
 * saved `Outfit` rows at zero. So compatibility here means colour coherence,
 * not formality or occasion, and the rule is the oldest one in dressing: at
 * most one thing shouting at a time.
 *
 * Pure and deterministic like the rest of lib/packing, so the client can
 * recompute the grid the instant the user swaps a piece.
 */
import type { Color } from "@/lib/json";
import { dominantRole } from "./palette";
import { coveredDays, WEARS_PER_ITEM, type CategoryBucket } from "./plan";

export type OutfitPiece = {
  id: string;
  bucket: CategoryBucket;
  colors?: Color[];
};

export type DayOutfit = {
  /** 1-based day of the trip. */
  day: number;
  /** Pieces for the day, in wearing order: layer, top, bottom, shoes. */
  itemIds: string[];
  /** False when the bag couldn't dress this day at all. */
  complete: boolean;
  /**
   * True when the look has at most one attention-grabbing colour. False means
   * we dressed the day anyway because being clothed beats being coordinated.
   */
  coherent: boolean;
  /**
   * True when something in the look is past its wear budget — you own enough to
   * be dressed today, but only by re-wearing something already worn.
   *
   * This is what reconciles the grid with `coveredDays` in ./plan.ts. That
   * function counts days you can dress in *clean* clothes and is what the
   * packing warning reports; the grid never leaves a day blank if the bag can
   * cover it at all. Without this flag the two would contradict each other —
   * "covers 6 of 10 days" beside "10 of 10 days covered".
   */
  rewear: boolean;
};

/**
 * At most one statement colour per look.
 *
 * Neutrals and near-neutrals combine with anything, so they never count against
 * a look. Two accents — a red shirt with green trousers — is the one thing a
 * simple rule can reliably catch, and catching it is most of the value.
 */
export function outfitIsCoherent(pieces: readonly OutfitPiece[]): boolean {
  return pieces.filter((p) => dominantRole(p.colors) === "accent").length <= 1;
}

/**
 * Per-piece wear allowance, used only to drive *rotation* — which shirt comes
 * up next. It deliberately does NOT decide the re-wear flag: rounding 1.5 wears
 * per top to an integer here would disagree with `coveredDays`, which works in
 * aggregate (four tops at 1.5 = six clean days, not four). The flag comes from
 * `coveredDays` itself so the grid and the packing warning can't drift apart.
 */
function wearBudget(bucket: CategoryBucket): number {
  return Math.max(1, Math.round(WEARS_PER_ITEM[bucket] ?? 1));
}

type Tracked = OutfitPiece & { wearsLeft: number; lastWornDay: number };

function track(pieces: readonly OutfitPiece[], bucket: CategoryBucket, mult = 1): Tracked[] {
  return pieces
    .filter((p) => p.bucket === bucket)
    .map((p) => ({ ...p, wearsLeft: wearBudget(bucket) * mult, lastWornDay: -99 }));
}

/**
 * Pick the piece that has gone longest unworn and still has wears left, so a
 * trip rotates through the bag instead of wearing item one every day. Ties
 * break on id, which keeps the whole function deterministic.
 */
function freshest(candidates: readonly Tracked[], day: number): Tracked | null {
  const usable = candidates.filter((c) => c.wearsLeft > 0);
  const pool = usable.length > 0 ? usable : candidates; // out of clean clothes
  if (pool.length === 0) return null;
  return [...pool].sort(
    (a, b) => a.lastWornDay - b.lastWornDay || a.id.localeCompare(b.id),
  )[0];
}

/**
 * Build the day-by-day plan for a packed bag.
 *
 * Greedy and rotation-aware: each day takes the least recently worn top and
 * bottom that still have wears left, then swaps one of them for an alternative
 * if the pair would clash. Shoes and outerwear repeat daily, which is what
 * people actually do.
 */
export function planDailyOutfits(input: {
  packed: readonly OutfitPiece[];
  days: number;
  /** Include the jacket in every look — set for cool/cold/wet trips. */
  includeOuterwear?: boolean;
  /** Laundry stretches every piece; must match what the packer used. */
  wearMultiplier?: number;
}): DayOutfit[] {
  const days = Math.max(0, Math.floor(input.days));
  if (days === 0) return [];

  const tops = track(input.packed, "top", input.wearMultiplier ?? 1);
  const bottoms = track(input.packed, "bottom", input.wearMultiplier ?? 1);
  const dresses = track(input.packed, "dress", input.wearMultiplier ?? 1);
  const shoes = track(input.packed, "shoes", input.wearMultiplier ?? 1);
  const outerwear = track(input.packed, "outerwear", input.wearMultiplier ?? 1);

  // Days you can dress in clean clothes, from the same aggregate model the
  // packing warning reports. Everything past this is a re-wear, by definition
  // rather than by a second, subtly different calculation.
  const counts: Partial<Record<CategoryBucket, number>> = {};
  for (const p of input.packed) counts[p.bucket] = (counts[p.bucket] ?? 0) + 1;
  const cleanDays = coveredDays(counts, days, input.wearMultiplier ?? 1);

  const out: DayOutfit[] = [];

  for (let day = 1; day <= days; day += 1) {
    const shoe = freshest(shoes, day);
    const layer = input.includeOuterwear ? freshest(outerwear, day) : null;

    // A dress is a whole look on its own — use one when it's the freshest
    // option, otherwise build top + bottom.
    const dress = freshest(dresses, day);
    const top = freshest(tops, day);
    const bottom = freshest(bottoms, day);

    const preferDress = !!dress && (!top || !bottom || dress.lastWornDay < top.lastWornDay);

    let core: Tracked[] = [];
    if (preferDress && dress) {
      core = [dress];
    } else if (top && bottom) {
      core = [top, bottom];
      // If the pair clashes, try another bottom, then another top, before
      // giving up and wearing it anyway.
      if (!outfitIsCoherent([...core, ...(layer ? [layer] : [])])) {
        const altBottom = bottoms
          .filter((b) => b.id !== bottom.id && b.wearsLeft > 0)
          .find((b) => outfitIsCoherent([top, b, ...(layer ? [layer] : [])]));
        if (altBottom) {
          core = [top, altBottom];
        } else {
          const altTop = tops
            .filter((t) => t.id !== top.id && t.wearsLeft > 0)
            .find((t) => outfitIsCoherent([t, bottom, ...(layer ? [layer] : [])]));
          if (altTop) core = [altTop, bottom];
        }
      }
    } else if (dress) {
      core = [dress];
    }

    const worn = [...(layer ? [layer] : []), ...core, ...(shoe ? [shoe] : [])];
    const rewear = day > cleanDays;
    for (const piece of worn) {
      piece.wearsLeft -= 1;
      piece.lastWornDay = day;
    }

    // "Complete" means you could actually leave the house: something covering
    // the torso and legs, plus shoes.
    const hasCore = core.length > 0 && (core[0].bucket === "dress" || core.length === 2);
    out.push({
      day,
      itemIds: worn.map((p) => p.id),
      complete: hasCore && !!shoe,
      coherent: outfitIsCoherent(worn),
      rewear,
    });
  }

  return out;
}

/** How many days of the plan are actually wearable. */
export function completeDayCount(plan: readonly DayOutfit[]): number {
  return plan.filter((d) => d.complete).length;
}

/** Days you can only dress by re-wearing something. */
export function rewearDayCount(plan: readonly DayOutfit[]): number {
  return plan.filter((d) => d.complete && d.rewear).length;
}

/** Distinct looks in the plan, so the UI can say "6 outfits across 8 days". */
export function distinctOutfitCount(plan: readonly DayOutfit[]): number {
  const seen = new Set(plan.filter((d) => d.complete).map((d) => [...d.itemIds].sort().join("|")));
  return seen.size;
}
