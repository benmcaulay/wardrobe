/**
 * Bag silhouette presets for SmartPakker. Used as a fallback shape/label when
 * the user hasn't uploaded a photo of the bag, and to seed a sensible default
 * volume in the "add bag" form. Pure module — safe to import on the client.
 */

export type BagSilhouette = {
  id: string;
  label: string;
  /** Default litres pre-filled when this silhouette is picked. */
  typicalLiters: number;
  /** Aspect ratio (width / height) used to draw the fill-meter shape. */
  aspect: number;
};

export const BAG_SILHOUETTES: BagSilhouette[] = [
  { id: "tote", label: "Tote / personal item", typicalLiters: 18, aspect: 1.1 },
  { id: "backpack", label: "Backpack", typicalLiters: 30, aspect: 0.72 },
  { id: "carryon", label: "Carry-on", typicalLiters: 40, aspect: 0.66 },
  { id: "duffel", label: "Duffel", typicalLiters: 60, aspect: 1.6 },
  { id: "checked", label: "Checked suitcase", typicalLiters: 90, aspect: 0.74 },
];

export const DEFAULT_SILHOUETTE_ID = "duffel";

const BY_ID = new Map(BAG_SILHOUETTES.map((s) => [s.id, s]));

export function isSilhouetteId(value: string): boolean {
  return BY_ID.has(value);
}

export function getSilhouette(id: string | null | undefined): BagSilhouette {
  return (id && BY_ID.get(id)) || BY_ID.get(DEFAULT_SILHOUETTE_ID)!;
}
