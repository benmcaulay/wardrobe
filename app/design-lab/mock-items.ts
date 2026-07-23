export type LabItem = {
  id: string;
  name: string;
  brand: string;
  category: string;
  /** CSS color for the mock garment swatch */
  hue: string;
  /** Second accent for layered mock art */
  accent: string;
  season: string;
};

export const LAB_ITEMS: LabItem[] = [
  {
    id: "1",
    name: "Flag Crew",
    brand: "Ralph Lauren",
    category: "sweater",
    hue: "#f4f1ea",
    accent: "#1a2a6c",
    season: "Fall",
  },
  {
    id: "2",
    name: "Oxide Trouser",
    brand: "Studio Nicholson",
    category: "bottom",
    hue: "#5c4a3a",
    accent: "#c9b8a6",
    season: "Fall",
  },
  {
    id: "3",
    name: "Glass Shell",
    brand: "Arc'teryx",
    category: "outerwear",
    hue: "#7a9e9f",
    accent: "#1e2a2b",
    season: "Spring",
  },
  {
    id: "4",
    name: "Acid Tee",
    brand: "Our Legacy",
    category: "top",
    hue: "#c8f542",
    accent: "#101010",
    season: "Summer",
  },
  {
    id: "5",
    name: "Ink Overcoat",
    brand: "Lemaire",
    category: "outerwear",
    hue: "#1a1613",
    accent: "#8a7a6a",
    season: "Winter",
  },
  {
    id: "6",
    name: "Coral Slip",
    brand: "Gabriela Hearst",
    category: "dress",
    hue: "#e07a5f",
    accent: "#f4e9e1",
    season: "Summer",
  },
  {
    id: "7",
    name: "Fog Runner",
    brand: "Salomon",
    category: "shoes",
    hue: "#b8c0c8",
    accent: "#3d4450",
    season: "Spring",
  },
  {
    id: "8",
    name: "Chartreuse Cap",
    brand: "Kangol",
    category: "accessory",
    hue: "#b8d92a",
    accent: "#2a2a2a",
    season: "Summer",
  },
];

export const LAB_NAV = [
  { href: "/design-lab/orbit", label: "Closet" },
  { href: "/design-lab/orbit", label: "Outfits", hash: "outfits" },
  { href: "/design-lab/orbit", label: "Try on", hash: "tryon" },
  { href: "/design-lab/orbit", label: "Pack", hash: "pack" },
  { href: "/design-lab/orbit", label: "Sell", hash: "sell" },
] as const;

export const DIRECTIONS = [
  {
    id: "orbit",
    href: "/design-lab/orbit",
    name: "Orbit",
    tagline: "Spatial depth · constellation closet",
    fonts: "Unbounded + Fragment Mono",
    beats: [
      "Z-depth garment field that drifts on pointer move",
      "Brand as orbital wordmark (slow spin on load)",
      "Nav as a left gravity rail that expands on hover",
      "Page enter: pieces cascade from deep space",
    ],
  },
  {
    id: "runway",
    href: "/design-lab/runway",
    name: "Runway",
    tagline: "Motion-first · filmstrip scroll",
    fonts: "Big Shoulders Stencil + Chakra Petch",
    beats: [
      "Horizontal closet as an infinite runway strip",
      "Category marquee that never stops",
      "Curtain wipe between panel states",
      "FAB that orbits the active tile",
    ],
  },
  {
    id: "stack",
    href: "/design-lab/stack",
    name: "Stack",
    tagline: "Layered sheets · frosted planes",
    fonts: "Gloock + Ojuju",
    beats: [
      "Offset frosted panels with parallax shear",
      "Diagonal slice background that shifts on scroll",
      "Item detail peels as a new sheet on top",
      "Typography as architecture (display fills the void)",
    ],
  },
] as const;
