import { pick, pickN, range, seededRng } from "./_rng";

// TODO: replace with a real vision call (OpenAI Vision, Anthropic Claude Vision,
// or Google Vision AI). See README.md#replacing-stubs-with-real-services.
// Anthropic Claude Vision: https://docs.anthropic.com/en/docs/build-with-claude/vision
// OpenAI Vision: https://platform.openai.com/docs/guides/vision

export type Category = "top" | "bottom" | "dress" | "outerwear" | "shoes" | "accessory";
export type Season = "spring" | "summer" | "fall" | "winter";

export type VisionResult = {
  category: Category;
  subcategory: string;
  colors: { hex: string; name: string }[];
  pattern: string | null;
  styleTags: string[];
  season: Season[];
};

const CATEGORY_SUBCATEGORIES: Record<Category, readonly string[]> = {
  top: ["t-shirt", "blouse", "shirt", "sweater", "tank", "polo"],
  bottom: ["jeans", "trousers", "shorts", "skirt", "leggings"],
  dress: ["midi", "mini", "maxi", "slip", "shirtdress"],
  outerwear: ["jacket", "coat", "blazer", "cardigan", "trench"],
  shoes: ["sneaker", "loafer", "boot", "heel", "sandal", "flat"],
  accessory: ["bag", "scarf", "hat", "belt", "jewelry", "sunglasses"],
};

const COLORS: readonly { hex: string; name: string }[] = [
  { hex: "#1a1613", name: "black" },
  { hex: "#f5f2ea", name: "ivory" },
  { hex: "#2b2521", name: "charcoal" },
  { hex: "#7a8c6f", name: "sage" },
  { hex: "#b5553a", name: "terracotta" },
  { hex: "#5a6b85", name: "indigo" },
  { hex: "#d9ccb3", name: "sand" },
  { hex: "#3b2a20", name: "cognac" },
  { hex: "#c5cfbc", name: "pale-sage" },
  { hex: "#a24c4c", name: "brick" },
  { hex: "#efe6d8", name: "cream" },
  { hex: "#4c5b3c", name: "olive" },
];

const PATTERNS = [null, null, null, null, "striped", "floral", "checked", "polka-dot"] as const;

const STYLE_TAGS_BY_CATEGORY: Record<Category, readonly string[]> = {
  top: ["minimal", "workwear", "casual", "classic", "romantic", "streetwear"],
  bottom: ["tailored", "minimal", "casual", "relaxed", "streetwear"],
  dress: ["romantic", "going-out", "classic", "minimal", "vintage"],
  outerwear: ["classic", "workwear", "streetwear", "cozy", "utility"],
  shoes: ["preppy", "classic", "athletic", "minimal", "going-out"],
  accessory: ["everyday", "minimal", "vintage", "romantic", "statement"],
};

const SEASONS_PROFILES: readonly Season[][] = [
  ["spring", "summer"],
  ["spring", "fall"],
  ["fall", "winter"],
  ["spring", "summer", "fall"],
  ["summer"],
  ["winter"],
  ["spring", "summer", "fall", "winter"],
];

const ALL_CATEGORIES = Object.keys(CATEGORY_SUBCATEGORIES) as Category[];

/**
 * Analyze a garment image. Stub implementation derives a deterministic result
 * from the image path so the same image always produces the same tags during
 * development. A real provider should return data of the same shape.
 */
export async function analyzeGarment(imagePath: string): Promise<VisionResult> {
  const rng = seededRng(imagePath);
  const category = pick(rng, ALL_CATEGORIES);
  const subcategory = pick(rng, CATEGORY_SUBCATEGORIES[category]);
  const colors = pickN(rng, COLORS, range(rng, 1, 2));
  const pattern = pick(rng, PATTERNS);
  const styleTags = pickN(rng, STYLE_TAGS_BY_CATEGORY[category], range(rng, 2, 3));
  const season = pick(rng, SEASONS_PROFILES);

  return {
    category,
    subcategory,
    colors,
    pattern,
    styleTags,
    season,
  };
}
