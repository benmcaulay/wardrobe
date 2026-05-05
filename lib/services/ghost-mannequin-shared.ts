/**
 * Pure helpers split from ghostMannequin.ts so client components can import
 * them without pulling sharp / fs into the browser bundle.
 */

export type GhostMannequinCategory =
  | "upperbody"
  | "lowerbody"
  | "footwear"
  | "dress"
  | "full";

/** Map a wardrobe item category to the ghost-mannequin category enum. */
export function mapCategoryToGhost(category: string): GhostMannequinCategory {
  switch (category) {
    case "top":
    case "outerwear":
    case "accessory":
      return "upperbody";
    case "bottom":
      return "lowerbody";
    case "shoes":
      // Shoes are not "lower-body apparel" for prompt purposes — that wording
      // describes pants/skirts and steers image models toward the wrong garment class.
      return "footwear";
    case "dress":
      return "dress";
    default:
      return "full";
  }
}
