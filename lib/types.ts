import type { Color } from "./json";
import { DEFAULT_CATEGORIES } from "./categories";

export type Season = "spring" | "summer" | "fall" | "winter";

export type { Color };

/** Controlled form shape shared by /closet/add and /closet/[itemId]. */
export type ItemFormValue = {
  name: string;
  brand: string;
  category: string;
  subcategory: string;
  colors: Color[];
  priceCents: number | null;
  currency: string;
  material: string;
  pattern: string;
  styleTags: string[];
  season: Season[];
  notes: string;
  isWishlist: boolean;
};

export const CATEGORIES: string[] = [...DEFAULT_CATEGORIES];
export const SEASONS: Season[] = ["spring", "summer", "fall", "winter"];
