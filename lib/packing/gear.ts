/**
 * The things in your bag that aren't clothes.
 *
 * SmartPakker could plan a week's outfits down to the litre and had nowhere to
 * put a passport. The bag meters were therefore always wrong — not by a little,
 * either: a charger, a wash bag and a pair of shoes' worth of toiletries is
 * comfortably 2kg and 4 litres that the plan believed was free space.
 *
 * Gear is deliberately NOT run through the packing algorithm. That code reasons
 * about garments — it counts tops against days, scores warmth against the
 * climate band, and checks an outfit is coherent — and none of those questions
 * mean anything for a toothbrush. Gear does exactly one thing to the plan: it
 * takes up room. So it lands in its own assignment map and feeds the same
 * volume and weight meters, and the planner never sees it.
 *
 * Pure and deterministic like the rest of lib/packing, so the estimates below
 * can be tested without a database.
 */

export type GearCategory =
  | "documents"
  | "tech"
  | "toiletries"
  | "health"
  | "comfort"
  | "misc";

/**
 * A fallback weight and volume per category.
 *
 * Nobody weighs their toothbrush, so `weightGrams` and `volumeLiters` are
 * nullable on the record and these stand in. They are rough by construction,
 * which is why anything derived from them is labelled as an estimate wherever
 * it's shown — the alternative, defaulting an unknown weight to zero, quietly
 * tells you a full wash bag is free.
 */
export const GEAR_CATEGORIES: {
  id: GearCategory;
  label: string;
  /** Icon name from components/icons.tsx. */
  icon: string;
  /** Per-unit fallbacks when the user hasn't measured the thing. */
  estWeightGrams: number;
  estVolumeLiters: number;
}[] = [
  { id: "documents", label: "Documents", icon: "passport", estWeightGrams: 60, estVolumeLiters: 0.2 },
  { id: "tech", label: "Tech", icon: "plug", estWeightGrams: 250, estVolumeLiters: 0.6 },
  { id: "toiletries", label: "Toiletries", icon: "toiletries", estWeightGrams: 180, estVolumeLiters: 0.5 },
  { id: "health", label: "Health", icon: "pills", estWeightGrams: 120, estVolumeLiters: 0.3 },
  { id: "comfort", label: "Comfort", icon: "water-bottle", estWeightGrams: 300, estVolumeLiters: 1 },
  { id: "misc", label: "Everything else", icon: "pouch", estWeightGrams: 200, estVolumeLiters: 0.7 },
];

const BY_ID = new Map(GEAR_CATEGORIES.map((c) => [c.id, c]));

export const DEFAULT_GEAR_CATEGORY: GearCategory = "misc";

export function isGearCategory(value: string): value is GearCategory {
  return BY_ID.has(value as GearCategory);
}

/** Coerce whatever is in the database column to a category we know. */
export function parseGearCategory(value: string | null | undefined): GearCategory {
  return value && isGearCategory(value) ? value : DEFAULT_GEAR_CATEGORY;
}

export function gearCategoryLabel(category: GearCategory): string {
  return BY_ID.get(category)?.label ?? "Everything else";
}

/** The icon for a piece of gear: its own if it picked one, else its category's. */
export function gearIconName(gear: { category: GearCategory; icon?: string | null }): string {
  return gear.icon || BY_ID.get(gear.category)?.icon || "pouch";
}

export type GearLike = {
  category: GearCategory;
  quantity: number;
  weightGrams: number | null;
  volumeLiters: number | null;
};

/**
 * What one line of gear actually costs a bag.
 *
 * `estimated` is true when either number came from the category fallback rather
 * than from the user. The UI uses it to mark the row, so a bag reading "94%
 * full" can be trusted exactly as far as the measurements behind it.
 */
export function gearFootprint(gear: GearLike): {
  weightGrams: number;
  volumeLiters: number;
  estimated: boolean;
} {
  const fallback = BY_ID.get(gear.category) ?? BY_ID.get(DEFAULT_GEAR_CATEGORY)!;
  const quantity = Math.max(1, Math.round(gear.quantity || 1));
  const estimated = gear.weightGrams == null || gear.volumeLiters == null;
  const weight = gear.weightGrams ?? fallback.estWeightGrams;
  const volume = gear.volumeLiters ?? fallback.estVolumeLiters;
  return {
    weightGrams: Math.round(weight * quantity),
    volumeLiters: Math.round(volume * quantity * 10) / 10,
    estimated,
  };
}

/**
 * Starter gear, offered as one-tap adds on an empty library.
 *
 * An empty list with an "Add gear" button is a chore nobody does; the same list
 * pre-populated with the eleven things everyone actually packs is thirty
 * seconds of tapping. Weights are real measured figures for typical examples,
 * so a bag built entirely from presets still totals up honestly.
 */
export const GEAR_PRESETS: {
  name: string;
  category: GearCategory;
  icon?: string;
  weightGrams: number;
  volumeLiters: number;
  essential?: boolean;
}[] = [
  { name: "Passport", category: "documents", icon: "passport", weightGrams: 35, volumeLiters: 0.1, essential: true },
  { name: "Wallet", category: "documents", icon: "wallet", weightGrams: 110, volumeLiters: 0.2, essential: true },
  { name: "Keys", category: "documents", icon: "keys", weightGrams: 80, volumeLiters: 0.1, essential: true },
  { name: "Phone charger", category: "tech", icon: "plug", weightGrams: 90, volumeLiters: 0.2, essential: true },
  { name: "Power bank", category: "tech", icon: "battery", weightGrams: 350, volumeLiters: 0.3 },
  { name: "Travel plug adapter", category: "tech", icon: "plug", weightGrams: 60, volumeLiters: 0.1 },
  { name: "Laptop + charger", category: "tech", icon: "laptop", weightGrams: 1800, volumeLiters: 2.5 },
  { name: "Headphones", category: "tech", icon: "headphones", weightGrams: 250, volumeLiters: 0.6 },
  { name: "Wash bag", category: "toiletries", icon: "pouch", weightGrams: 700, volumeLiters: 2.5, essential: true },
  { name: "Toothbrush + paste", category: "toiletries", icon: "toothbrush", weightGrams: 120, volumeLiters: 0.2 },
  { name: "Shampoo + body wash", category: "toiletries", icon: "toiletries", weightGrams: 300, volumeLiters: 0.4 },
  { name: "Medication", category: "health", icon: "pills", weightGrams: 120, volumeLiters: 0.2 },
  { name: "Water bottle", category: "comfort", icon: "water-bottle", weightGrams: 280, volumeLiters: 0.8 },
  { name: "Umbrella", category: "comfort", icon: "umbrella", weightGrams: 340, volumeLiters: 0.7 },
  { name: "Book", category: "comfort", icon: "book", weightGrams: 320, volumeLiters: 0.6 },
  { name: "Packing cubes", category: "misc", icon: "packing-cube", weightGrams: 220, volumeLiters: 0.4 },
];

/**
 * Suggest gear the trip implies but the bags don't contain.
 *
 * Kept to things we can actually justify from data the trip already has — a
 * rain chance, a cold band, a long stay — rather than a generic checklist.
 * Returns the names of *library* gear that isn't packed, so a suggestion is
 * always one tap from being acted on and never invents an item you don't own.
 */
export function suggestGear(input: {
  /** Gear in the user's library, with whether it's currently in a bag. */
  library: { id: string; name: string; category: GearCategory; packed: boolean }[];
  rainChance: number | null;
  band: string | null;
  days: number;
}): { id: string; name: string; reason: string }[] {
  const unpacked = input.library.filter((g) => !g.packed);
  const out: { id: string; name: string; reason: string }[] = [];
  const seen = new Set<string>();

  const suggest = (match: RegExp, reason: string) => {
    for (const gear of unpacked) {
      if (seen.has(gear.id) || !match.test(gear.name.toLowerCase())) continue;
      seen.add(gear.id);
      out.push({ id: gear.id, name: gear.name, reason });
      return;
    }
  };

  if (input.rainChance != null && input.rainChance >= 0.3) {
    suggest(/umbrella|rain|poncho/, `${Math.round(input.rainChance * 100)}% chance of rain`);
  }
  if (input.band === "cold" || input.band === "cool") {
    suggest(/balm|lotion|moistur|cream/, "cold, dry air");
  }
  if (input.days >= 5) {
    suggest(/laundry|detergent|wash bag/, `${input.days} days away`);
  }
  // Essentials are the ones it genuinely hurts to forget, so they're worth
  // flagging with no further justification than "you always take this".
  for (const gear of unpacked) {
    if (seen.has(gear.id)) continue;
    if (out.length >= 4) break;
    if (gear.category === "documents") {
      seen.add(gear.id);
      out.push({ id: gear.id, name: gear.name, reason: "you'd notice this one at the airport" });
    }
  }

  return out.slice(0, 4);
}
