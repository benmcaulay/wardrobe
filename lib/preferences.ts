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

/**
 * The 10 style tags offered as chips on the item form. If a legacy item has
 * tags outside this list, the form still renders them so the user can clear
 * them — but new items pick from this set.
 */
export const COMMON_STYLE_TAGS = [
  "minimal",
  "classic",
  "casual",
  "romantic",
  "streetwear",
  "vintage",
  "workwear",
  "cozy",
  "tailored",
  "going-out",
] as const;

export const FAVORITE_COLOR_OPTIONS: readonly { hex: string; name: string }[] = [
  { hex: "#111111", name: "black" },
  { hex: "#ffffff", name: "white" },
  { hex: "#8a8a8a", name: "gray" },
  { hex: "#c0392b", name: "red" },
  { hex: "#d97a3b", name: "orange" },
  { hex: "#d9b94a", name: "yellow" },
  { hex: "#4a8c5a", name: "green" },
  { hex: "#4a6fb0", name: "blue" },
  { hex: "#7a4fb0", name: "purple" },
];

export const SIZE_SLOTS = [
  { key: "top", label: "Top" },
  { key: "bottom", label: "Bottom" },
  { key: "shoe", label: "Shoe" },
] as const;

export type SizeSlotKey = (typeof SIZE_SLOTS)[number]["key"];
