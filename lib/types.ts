import type { Category, Season } from "./services/vision";
import type { Color } from "./json";

export type { Category, Season, Color };

/** Controlled form shape shared by /closet/add and /closet/[itemId]. */
export type ItemFormValue = {
  name: string;
  brand: string;
  category: Category;
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

export const CATEGORIES: Category[] = ["top", "bottom", "dress", "outerwear", "shoes", "accessory"];
export const SEASONS: Season[] = ["spring", "summer", "fall", "winter"];
