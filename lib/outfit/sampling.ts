/**
 * Turning compatibility scores into an order to try candidates in.
 *
 * The builder's "randomize" button is pressed repeatedly and expects something
 * different each time, so the scorer cannot simply take the argmax — that turns
 * one button press into the same outfit forever. Uniform shuffling is the
 * current behaviour and ignores the scores entirely.
 *
 * Softmax sampling without replacement is the middle: good combinations come up
 * far more often, every valid combination stays reachable, and the temperature
 * is one number that moves the whole thing between "safe" and "surprising".
 *
 * This is also the hook Phase 4 needs. Thompson sampling for the explore slot
 * is the same operation with the score drawn from a posterior instead of read
 * from a fixed prior, so the slate work replaces what produces the scores, not
 * what consumes them.
 */

/** Mulberry32 — same generator as lib/services/_rng.ts, minus the node:crypto
 *  seeding, so this runs in the browser. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * How sharply scores translate into preference.
 *
 * Scores live in [0, 1] and real gaps between candidates are often ~0.1, so the
 * exponent needs to be large enough for that to matter. At the default a 0.1
 * advantage is about e^0.8 ≈ 2.2× more likely to be tried first — a clear
 * preference that still leaves the weaker option regularly reachable.
 */
export const DEFAULT_TEMPERATURE = 0.125;

/** Below this, treat the draw as deterministic and avoid dividing by ~zero. */
const MIN_TEMPERATURE = 1e-3;

export type Scored<T> = { item: T; score: number };

/**
 * Order candidates by sampling without replacement from a softmax over scores.
 *
 * Returns a full ordering rather than a single pick because the caller
 * backtracks: when the best candidate leads to a dead end it needs the next
 * one, and re-sampling at that point would break the without-replacement
 * property and could loop on the same item.
 */
export function scoredOrder<T>(
  scored: readonly Scored<T>[],
  rng: () => number,
  temperature: number = DEFAULT_TEMPERATURE,
): T[] {
  if (scored.length <= 1) return scored.map((s) => s.item);

  if (temperature < MIN_TEMPERATURE) {
    return [...scored].sort((a, b) => b.score - a.score).map((s) => s.item);
  }

  // Subtract the max before exponentiating — standard softmax stabilisation.
  // Without it a high score and a low temperature overflow to Infinity, and the
  // weights become NaN rather than a sharp distribution.
  const max = Math.max(...scored.map((s) => s.score));
  const pool = scored.map((s) => ({
    item: s.item,
    weight: Math.exp((s.score - max) / temperature),
  }));

  const out: T[] = [];
  let remaining = pool.reduce((sum, p) => sum + p.weight, 0);

  while (pool.length > 0) {
    // Degenerate weights (all zero, or NaN leaking in from a bad score) would
    // otherwise make the cumulative walk fall off the end and return undefined.
    if (!Number.isFinite(remaining) || remaining <= 0) {
      out.push(...pool.map((p) => p.item));
      break;
    }

    let target = rng() * remaining;
    let index = pool.length - 1;
    for (let i = 0; i < pool.length; i += 1) {
      target -= pool[i].weight;
      if (target <= 0) {
        index = i;
        break;
      }
    }

    const [chosen] = pool.splice(index, 1);
    remaining -= chosen.weight;
    out.push(chosen.item);
  }

  return out;
}
