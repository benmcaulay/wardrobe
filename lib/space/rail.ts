/**
 * The Rail: one closet rod, hangers positioned by when the piece was last worn.
 *
 * A grid gives every garment the same amount of room, which is the one thing a
 * real closet never does. Laid out on a time axis instead, the pieces you
 * actually wear crowd into the near end and the ones you don't sit alone with
 * empty rod either side — so the gaps in the picture are the gaps in the
 * closet, and nobody had to be told anything.
 *
 * That is the whole reason this renders spacing rather than text. The dormancy
 * lens (lib/outfit/dormancy.ts) is careful never to instruct, and the surfaces
 * that show it are careful never to grow a CTA (see lenses-client.tsx). A
 * position on an axis is a fact of the same kind as "last worn 14 months ago" —
 * it states where the piece falls and stops. Nothing in this module may return
 * a verdict, a rank, or a suggestion, and nothing downstream should add one.
 *
 * Pure: epoch ms in, offsets out, "now" always passed in.
 */

/** A piece as the rail needs it. */
export type RailInput = {
  id: string;
  /** Null means never worn since it was added. */
  lastWornAtMs: number | null;
};

export type RailHanger = {
  id: string;
  /** Whole days since last worn, or null for never-worn. */
  daysSince: number | null;
  /** Position along the rod, 0 (worn most recently) to 1 (longest ago). */
  offset: number;
  /**
   * Which row of the rod this hangs from. 0 unless a neighbour is close enough
   * to collide — garments on a real rail overlap rather than push each other
   * apart, and pushing them apart is what would destroy the gaps.
   */
  lane: number;
  /**
   * How many hangers are already sitting on this exact spot in this exact lane.
   *
   * Purely for the renderer, and deliberately separate from `offset`: once the
   * lanes are full, extra hangers land on top of one another, and a closet with
   * a dozen never-worn pieces showed four tiles with eight invisible behind
   * them. The component fans by a few pixels per `stack` so the pile reads as a
   * pile. The *data* is still one offset — nudging `offset` itself would make
   * the module report a wear date it does not have.
   */
  stack: number;
};

/** A stretch of rod with nothing on it. */
export type RailGap = {
  fromOffset: number;
  toOffset: number;
  /** How much time the empty stretch covers. */
  days: number;
};

export type RailLayout = {
  /** Ordered near end first. */
  hangers: RailHanger[];
  /** Empty stretches between dated pieces only — see `neverWornOffset`. */
  gaps: RailGap[];
  /** Days between the most and least recently worn piece. 0 when undefined. */
  spanDays: number;
  /** How many hangers are parked at the far end because they've never been worn. */
  neverWornCount: number;
  /** Where those hangers sit, so the caller can label that end of the rod. */
  neverWornOffset: number;
  /** Rows needed to draw it, i.e. max lane + 1. */
  lanes: number;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Fraction of the rod one hanger visually occupies. Two hangers closer than
 * this are treated as overlapping and the later one drops to the next lane.
 */
export const DEFAULT_HANGER_FRACTION = 0.035;

/**
 * Smallest empty stretch worth naming, as a fraction of the rod.
 *
 * Below this the "gap" is just the space between two hangers and labelling it
 * would turn an honest picture into a nagging one.
 */
export const DEFAULT_MIN_GAP_FRACTION = 0.12;

/**
 * Smallest empty stretch worth naming, in days.
 *
 * The fraction alone is not enough, because the axis normalizes: a closet worn
 * entirely in the last three days has a rod spanning three days, so a
 * *one-day* gap is 33% of it and clears any fraction threshold. Labelling
 * "1 day of empty rail" on a closet somebody is wearing every day is the exact
 * nagging this view is built to avoid. Three weeks is the point at which a
 * hole in a wardrobe is a fact about the wardrobe rather than about the week.
 */
export const DEFAULT_MIN_GAP_DAYS = 21;

/**
 * Rows of hangers the rod can show before pieces are allowed to overlap.
 *
 * There has to be a cap. A closet with forty never-worn pieces puts forty
 * hangers on one offset, and one-lane-each would grow the rod to the height of
 * the page. Past the cap they hang over each other, which is what forty
 * garments on one hook look like anyway.
 */
export const DEFAULT_MAX_LANES = 4;

/**
 * Where never-worn pieces hang, and therefore where the dated axis has to stop.
 *
 * They cannot share offset 1 with the most dormant dated piece: "never worn" is
 * a longer gap than any gap we can measure, so it belongs further along the rod
 * than the longest one we can put a number on. The dated pieces compress into
 * [0, this] and the remainder is visibly empty rod.
 */
export const NEVER_WORN_OFFSET = 1;
const DATED_AXIS_END_WITH_NEVER_WORN = 0.84;

export function layOutRail(
  items: readonly RailInput[],
  nowMs: number,
  opts?: {
    hangerFraction?: number;
    minGapFraction?: number;
    minGapDays?: number;
    maxLanes?: number;
  },
): RailLayout {
  const hangerFraction = opts?.hangerFraction ?? DEFAULT_HANGER_FRACTION;
  const minGapFraction = opts?.minGapFraction ?? DEFAULT_MIN_GAP_FRACTION;
  const minGapDays = opts?.minGapDays ?? DEFAULT_MIN_GAP_DAYS;
  const maxLanes = Math.max(1, opts?.maxLanes ?? DEFAULT_MAX_LANES);

  const measured = items.map((item) => ({
    id: item.id,
    daysSince:
      item.lastWornAtMs == null
        ? null
        : // Clamped at 0: a wear logged later today would otherwise read as
          // negative days and place the hanger off the near end of the rod.
          Math.max(0, Math.floor((nowMs - item.lastWornAtMs) / MS_PER_DAY)),
  }));

  const dated = measured.filter((m): m is { id: string; daysSince: number } => m.daysSince != null);
  const neverWornCount = measured.length - dated.length;

  const minDays = dated.length ? Math.min(...dated.map((d) => d.daysSince)) : 0;
  const maxDays = dated.length ? Math.max(...dated.map((d) => d.daysSince)) : 0;
  const spanDays = maxDays - minDays;

  /*
   * Never-worn pieces sit at the far end — the extreme of the same axis, not a
   * separate bucket. "Never" really is the longest gap there is, and giving it
   * its own section would have invented a category the closet doesn't have.
   * `neverWornCount` is returned so the caller can say so in words.
   */
  const datedEnd = neverWornCount > 0 ? DATED_AXIS_END_WITH_NEVER_WORN : 1;
  const offsetOf = (daysSince: number | null): number => {
    if (daysSince == null) return NEVER_WORN_OFFSET;
    if (spanDays <= 0) return 0;
    return round4(((daysSince - minDays) / spanDays) * datedEnd);
  };

  const hangers: RailHanger[] = measured
    .map((m) => ({
      id: m.id,
      daysSince: m.daysSince,
      offset: offsetOf(m.daysSince),
      lane: 0,
      stack: 0,
    }))
    // Tie-break on id so the layout is stable across renders for identical
    // timestamps — without it two pieces worn the same day can swap lanes on
    // every refresh.
    .sort((a, b) => a.offset - b.offset || a.id.localeCompare(b.id));

  /*
   * Greedy lane assignment: keep the last offset placed in each lane, and drop
   * a hanger into the first lane whose occupant is far enough away. Opening a
   * new lane is preferred over nudging the offset, because the offset is the
   * data — moving a hanger to make room would erase the gap this whole view
   * exists to show. Past `maxLanes` they overlap instead, cycling lanes so the
   * pile fans rather than stacking every hanger on one row.
   */
  const laneTails: number[] = [];
  const occupancy = new Map<string, number>();
  let overflowLane = 0;
  for (const hanger of hangers) {
    const clear = laneTails.findIndex((tail) => hanger.offset - tail >= hangerFraction);
    if (clear !== -1) {
      laneTails[clear] = hanger.offset;
      hanger.lane = clear;
    } else if (laneTails.length < maxLanes) {
      hanger.lane = laneTails.length;
      laneTails.push(hanger.offset);
    } else {
      hanger.lane = overflowLane;
      laneTails[overflowLane] = hanger.offset;
      overflowLane = (overflowLane + 1) % maxLanes;
    }

    const spot = `${hanger.lane}:${hanger.offset}`;
    const already = occupancy.get(spot) ?? 0;
    hanger.stack = already;
    occupancy.set(spot, already + 1);
  }

  /*
   * Gaps run between consecutive *occupied* offsets, measured on the rod rather
   * than between list neighbours, so a cluster of six pieces worn last week
   * counts as one position and not six tiny gaps.
   *
   * Never-worn offsets are excluded: the stretch of rod before them is real and
   * visible, but its duration is unknown, and emitting "14 months of empty
   * rail" from an axis position we invented would be exactly the fabricated
   * number lib/sell/metrics.ts refuses to print.
   */
  const gaps: RailGap[] = [];
  const occupied = [
    ...new Set(hangers.filter((h) => h.daysSince != null).map((h) => h.offset)),
  ].sort((a, b) => a - b);
  for (let i = 1; i < occupied.length; i += 1) {
    const from = occupied[i - 1];
    const to = occupied[i];
    if (to - from < minGapFraction) continue;
    // Divided back out by `datedEnd` so the day count reads off the real time
    // span rather than the compressed axis.
    const days = Math.round(((to - from) / datedEnd) * spanDays);
    if (days < minGapDays) continue;
    gaps.push({ fromOffset: from, toOffset: to, days });
  }

  return {
    hangers,
    gaps,
    spanDays,
    neverWornCount,
    neverWornOffset: NEVER_WORN_OFFSET,
    lanes: Math.max(1, laneTails.length),
  };
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/**
 * "3 weeks of rail with nothing on it".
 *
 * Descriptive, never evaluative — no "wasted", no "dead", no "should".
 */
export function formatRailGap(gap: RailGap): string {
  const days = gap.days;
  if (days <= 0) return "a gap in the rail";
  if (days < 14) return `${days} ${days === 1 ? "day" : "days"} of empty rail`;
  if (days < 60) {
    const weeks = Math.round(days / 7);
    return `${weeks} ${weeks === 1 ? "week" : "weeks"} of empty rail`;
  }
  if (days < 730) {
    const months = Math.round(days / 30);
    return `${months} ${months === 1 ? "month" : "months"} of empty rail`;
  }
  const years = Math.floor(days / 365);
  return `${years}+ ${years === 1 ? "year" : "years"} of empty rail`;
}

/**
 * "Worn 3 months ago" / "Never worn".
 *
 * A tooltip, so it is a fragment rather than a sentence. Deliberately not
 * shared with `describeGap` in lib/actions/closet-lenses.ts, which produces
 * full sentences for a prose list ("Last worn about 3 months ago.") and whose
 * exact wording is load-bearing in a section that must never read as advice.
 * Two registers, two strings; merging them would force one of the two surfaces
 * to say something slightly wrong.
 */
export function formatLastWorn(daysSince: number | null): string {
  if (daysSince == null) return "Never worn";
  if (daysSince === 0) return "Worn today";
  if (daysSince === 1) return "Worn yesterday";
  if (daysSince < 14) return `Worn ${daysSince} days ago`;
  if (daysSince < 60) return `Worn ${Math.round(daysSince / 7)} weeks ago`;
  if (daysSince < 730) return `Worn ${Math.round(daysSince / 30)} months ago`;
  return `Worn ${Math.floor(daysSince / 365)}+ years ago`;
}
