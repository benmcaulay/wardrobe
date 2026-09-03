/**
 * Pure helpers split from ghostMannequin.ts so client components can import
 * them without pulling sharp / fs into the browser bundle.
 */

import { classifyGarmentKind, type GarmentKind } from "../categories";

export type GhostMannequinCategory =
  | "upperbody"
  | "lowerbody"
  | "footwear"
  | "headwear"
  | "dress"
  | "accessory"
  | "full";

/**
 * Hats need their own prompt shape, for the same reason footwear does.
 *
 * `GarmentKind` puts a cap under "accessory" alongside bags, belts and
 * watches, so it got the accessory prompt: "a clean retail catalog pose", with
 * nothing about orientation. The global camera tenet says head-on at 0° yaw,
 * which is unambiguous for a shirt and meaningless for a cap — head-on to the
 * front panel, the crown, or the profile? The model picked differently every
 * time, which is why a row of imported hats faces a row of different ways.
 *
 * Detected from text rather than by adding a GarmentKind, because the
 * distinction only matters to the ghost prompt. `outfitRegion` already treats
 * hats separately for its own reasons; adding a sixth kind would ripple through
 * packing, slots and the stylist for no gain.
 */
const HEADWEAR_RE =
  /\b(hat|hats|cap|caps|beanie|snapback|trucker|fitted|bucket hat|visor|headwear|balaclava|beret)\b/;

function looksLikeHeadwear(text: string): boolean {
  return HEADWEAR_RE.test(text.trim().toLowerCase());
}

/** GarmentKind is the shared taxonomy; this is the prompt-shape it selects. */
const KIND_TO_GHOST: Record<GarmentKind, GhostMannequinCategory> = {
  top: "upperbody",
  // Jackets and coats get the same shape rules as tops: level shoulders,
  // sleeves hanging straight, full length from collar to hem.
  outerwear: "upperbody",
  bottom: "lowerbody",
  dress: "dress",
  shoes: "footwear",
  accessory: "accessory",
  // Genuinely unknown — the prompt falls back to "identify the type yourself".
  other: "full",
};

/**
 * Map a wardrobe item to the ghost-mannequin prompt shape.
 *
 * ── Why this delegates ──────────────────────────────────────────────────────
 *
 * This used to switch on the canonical names ("top", "bottom", "shoes") and
 * default everything else to "full". Categories are user-editable, and this
 * closet uses natural names — so "shirt" (50 items), "sweater/hoodie" (28),
 * "hat" (42), "shorts" (14), "pants" (11) and "jacket" (9) all fell through:
 * 157 of 189 items, 83%, were generated with the generic "identify the type
 * yourself" prompt instead of the type-specific one. Every top-specific rule
 * (shoulders level, sleeves straight down, full length collar to hem) was
 * written and then never applied to a single shirt.
 *
 * lib/categories.ts already fixed this class of bug once — its own docs record
 * SmartPakker dropping 82% of a closet into "other" the same way — so the fix
 * is to use that shared classifier rather than maintain a second, worse
 * synonym table here.
 */
export function mapCategoryToGhost(category: string): GhostMannequinCategory {
  const kind = classifyGarmentKind({ category });
  if (kind === "accessory" && looksLikeHeadwear(category)) return "headwear";
  return KIND_TO_GHOST[kind];
}

/**
 * Preferred form: classification also reads subcategory and name, which rescues
 * items whose category is "None" but whose name is obvious ("Chargers AFC
 * Champs T" → a tee → upperbody).
 */
export function mapItemToGhost(item: {
  category?: string | null;
  subcategory?: string | null;
  name?: string | null;
  /** User-assigned shapes by normalised category name; beats text inference. */
  categoryShapes?: Record<string, GarmentKind> | null;
}): GhostMannequinCategory {
  const kind = classifyGarmentKind(item);
  if (kind === "accessory") {
    // Category first, then the name: "Hat" as a category is a stronger signal
    // than the word "cap" happening to appear in a product title.
    const text = `${item.category ?? ""} ${item.subcategory ?? ""} ${item.name ?? ""}`;
    if (looksLikeHeadwear(text)) return "headwear";
  }
  return KIND_TO_GHOST[kind];
}

export type GhostCategoryCheck =
  | { ok: true; category: Exclude<GhostMannequinCategory, "full"> }
  | { ok: false; error: string };

/**
 * Refuse to generate for an item whose type we cannot pin down.
 *
 * `full` means the prompt falls back to "identify the garment type yourself and
 * pick one of five type blocks", which is measurably the worst path — it is what
 * produced a cropped-off tee, because no top-specific rule about keeping the hem
 * ever reached the model. A credit spent there is a credit wasted, so this is a
 * hard gate rather than a warning.
 *
 * Distinguishes the two ways an item lands there, because the fixes differ: no
 * category at all, versus a category nothing recognises.
 */
export function requireGhostCategory(item: {
  category?: string | null;
  subcategory?: string | null;
  name?: string | null;
  categoryShapes?: Record<string, GarmentKind> | null;
}): GhostCategoryCheck {
  const mapped = mapItemToGhost(item);
  if (mapped !== "full") return { ok: true, category: mapped };

  const raw = (item.category ?? "").trim();
  const hasCategory = raw.length > 0 && raw.toLowerCase() !== "none";
  return {
    ok: false,
    error: hasCategory
      ? `Category "${raw}" isn't recognised as a garment type, so the render would have to guess. ` +
        `Either rename it to something clearer, or set its shape in Settings › Wardrobe categories.`
      : "Set a category before generating — without one the render has to guess the garment type, " +
        "which is what produces cropped or misshapen results.",
  };
}
