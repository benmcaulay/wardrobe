/**
 * Pure helpers split from ghostMannequin.ts so client components can import
 * them without pulling sharp / fs into the browser bundle.
 */

export type GhostMannequinCategory = "upperbody" | "lowerbody" | "dress" | "full";

/** Map a wardrobe item category to the ghost-mannequin category enum. */
export function mapCategoryToGhost(category: string): GhostMannequinCategory {
  switch (category) {
    case "top":
    case "outerwear":
    case "accessory":
      return "upperbody";
    case "bottom":
    case "shoes":
      return "lowerbody";
    case "dress":
      return "dress";
    default:
      return "full";
  }
}
