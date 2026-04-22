export const STYLE_OPTIONS = [
  "minimal",
  "classic",
  "romantic",
  "streetwear",
  "preppy",
  "vintage",
  "workwear",
  "going-out",
  "cozy",
  "relaxed",
  "tailored",
  "athletic",
] as const;

export const FAVORITE_COLOR_OPTIONS: readonly { hex: string; name: string }[] = [
  { hex: "#1a1613", name: "black" },
  { hex: "#f5f2ea", name: "ivory" },
  { hex: "#2b2521", name: "charcoal" },
  { hex: "#7a8c6f", name: "sage" },
  { hex: "#b5553a", name: "terracotta" },
  { hex: "#5a6b85", name: "indigo" },
  { hex: "#d9ccb3", name: "sand" },
  { hex: "#3b2a20", name: "cognac" },
  { hex: "#c5cfbc", name: "pale-sage" },
  { hex: "#4c5b3c", name: "olive" },
  { hex: "#efe6d8", name: "cream" },
  { hex: "#a24c4c", name: "brick" },
];

export const SIZE_SLOTS = [
  { key: "top", label: "Top" },
  { key: "bottom", label: "Bottom" },
  { key: "shoe", label: "Shoe" },
] as const;

export type SizeSlotKey = (typeof SIZE_SLOTS)[number]["key"];
