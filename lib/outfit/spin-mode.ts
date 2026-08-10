/**
 * The two ways the generator fills a frame.
 *
 * Both run through the same `pickRandomOutfit` backtracker, so slot rules,
 * colour rules and locked pieces behave identically either way — the mode only
 * decides the *order candidates are tried in*, never which combinations are
 * legal. That separation is the whole point: a smart spin can't quietly break a
 * rule the user set, and a random spin can't be accused of having an opinion.
 *
 *   random — uniform shuffle. No scoring at all, so every legal combination is
 *            equally likely. This is what people want when they're bored of
 *            their own taste and using the tool to be surprised.
 *   smart  — compatibility scoring plus the learned per-item affinity from the
 *            preference model, sampled at a low temperature. Locked pieces are
 *            already placed before scoring starts, so the open slots are scored
 *            *against what's locked* — which is what makes it autocomplete
 *            around a piece rather than around nothing.
 */

import type { ClimateBand } from "@/lib/services/weather";
import type { OutfitScoringOptions } from "@/lib/outfit-random";

export type SpinMode = "random" | "smart";

export const SPIN_MODES: readonly SpinMode[] = ["smart", "random"];

export const SPIN_MODE_LABELS: Record<SpinMode, string> = {
  smart: "Smart spin",
  random: "Random spin",
};

export const SPIN_MODE_HINTS: Record<SpinMode, string> = {
  smart: "Uses what I've learned about your taste, and builds around anything you've locked.",
  random: "Anything that fits your rules, with equal odds. No opinions.",
};

/**
 * Lower than the generator's default so a smart spin leans harder on the score
 * while staying stochastic. It has to stay stochastic: this button gets pressed
 * repeatedly, and returning the same "best" outfit every time would make it
 * useless as a generator, however well-ranked that outfit was.
 */
export const SMART_TEMPERATURE = 0.07;

export type SpinSignals = {
  /** Learned per-item affinity, 0..1. Empty until there's choice data. */
  affinity?: ReadonlyMap<string, number>;
  /** Today's climate band, so a smart spin dresses for the weather. */
  band?: ClimateBand | null;
};

/**
 * Scoring options for a mode — `undefined` for random, which is what
 * `pickRandomOutfit` reads as "uniform shuffle, no scoring".
 */
export function spinScoringOptions(
  mode: SpinMode,
  signals: SpinSignals = {},
): OutfitScoringOptions | undefined {
  if (mode === "random") return undefined;
  return {
    context: {
      band: signals.band ?? null,
      affinity: signals.affinity,
    },
    temperature: SMART_TEMPERATURE,
  };
}

/** Narrow a stored or posted value to a mode we can act on. */
export function readSpinMode(raw: unknown): SpinMode {
  return raw === "random" ? "random" : "smart";
}
