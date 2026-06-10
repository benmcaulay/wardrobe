import { PrismaClient } from "@prisma/client";
import path from "node:path";
import sharp from "sharp";
import { putObject } from "../lib/storage";

const prisma = new PrismaClient();

type SeedItem = {
  name: string;
  brand: string;
  category: string;
  subcategory: string;
  colors: { hex: string; name: string }[];
  priceCents: number;
  retailer: string;
  productUrl: string;
  material: string;
  pattern: string | null;
  styleTags: string[];
  season: string[];
  isWishlist?: boolean;
};

const SEED_ITEMS: SeedItem[] = [
  {
    name: "Boxy Oxford Shirt",
    brand: "Everlane",
    category: "top",
    subcategory: "shirt",
    colors: [{ hex: "#f5f2ea", name: "ivory" }],
    priceCents: 8800,
    retailer: "Everlane",
    productUrl: "https://example.com/oxford",
    material: "Cotton",
    pattern: null,
    styleTags: ["classic", "workwear", "minimal"],
    season: ["spring", "summer", "fall"],
  },
  {
    name: "Wide Leg Trouser",
    brand: "COS",
    category: "bottom",
    subcategory: "trousers",
    colors: [{ hex: "#2b2521", name: "charcoal" }],
    priceCents: 14500,
    retailer: "COS",
    productUrl: "https://example.com/trouser",
    material: "Wool blend",
    pattern: null,
    styleTags: ["tailored", "minimal"],
    season: ["fall", "winter"],
  },
  {
    name: "Midi Slip Dress",
    brand: "Reformation",
    category: "dress",
    subcategory: "slip",
    colors: [{ hex: "#7a8c6f", name: "sage" }],
    priceCents: 22800,
    retailer: "Reformation",
    productUrl: "https://example.com/slip",
    material: "Silk",
    pattern: null,
    styleTags: ["romantic", "going-out"],
    season: ["spring", "summer"],
  },
  {
    name: "Cropped Denim Jacket",
    brand: "Levi's",
    category: "outerwear",
    subcategory: "jacket",
    colors: [{ hex: "#5a6b85", name: "indigo" }],
    priceCents: 9800,
    retailer: "Levi's",
    productUrl: "https://example.com/jacket",
    material: "Denim",
    pattern: null,
    styleTags: ["casual", "classic"],
    season: ["spring", "fall"],
  },
  {
    name: "Leather Loafers",
    brand: "G.H. Bass",
    category: "shoes",
    subcategory: "loafer",
    colors: [{ hex: "#3b2a20", name: "cognac" }],
    priceCents: 17500,
    retailer: "Bass",
    productUrl: "https://example.com/loafer",
    material: "Leather",
    pattern: null,
    styleTags: ["preppy", "classic"],
    season: ["spring", "fall", "winter"],
  },
  {
    name: "Canvas Tote",
    brand: "Baggu",
    category: "accessory",
    subcategory: "bag",
    colors: [{ hex: "#d9ccb3", name: "sand" }],
    priceCents: 4200,
    retailer: "Baggu",
    productUrl: "https://example.com/tote",
    material: "Canvas",
    pattern: null,
    styleTags: ["everyday", "minimal"],
    season: ["spring", "summer", "fall"],
  },
  {
    name: "Silk Hair Scarf",
    brand: "Madewell",
    category: "accessory",
    subcategory: "scarf",
    colors: [{ hex: "#b5553a", name: "terracotta" }],
    priceCents: 3400,
    retailer: "Madewell",
    productUrl: "https://example.com/scarf",
    material: "Silk",
    pattern: "floral",
    styleTags: ["romantic", "vintage"],
    season: ["spring", "summer"],
  },
  {
    name: "Cashmere Crewneck",
    brand: "Quince",
    category: "top",
    subcategory: "sweater",
    colors: [{ hex: "#c5cfbc", name: "pale-sage" }],
    priceCents: 6500,
    retailer: "Quince",
    productUrl: "https://example.com/cashmere",
    material: "Cashmere",
    pattern: null,
    styleTags: ["cozy", "minimal"],
    season: ["fall", "winter"],
    isWishlist: true,
  },
];

async function writePlaceholder(userId: string, idx: number, color: string): Promise<string> {
  const key = path.posix.join(userId, `seed-${idx}.jpg`);
  const thumbKey = path.posix.join(userId, `seed-${idx}-thumb.jpg`);
  const full = await sharp({
    create: { width: 1024, height: 1024, channels: 3, background: color },
  })
    .jpeg({ quality: 82 })
    .toBuffer();
  const thumb = await sharp({
    create: { width: 400, height: 400, channels: 3, background: color },
  })
    .jpeg({ quality: 78 })
    .toBuffer();
  await putObject(key, full, "image/jpeg");
  await putObject(thumbKey, thumb, "image/jpeg");
  return key;
}

async function main() {
  const user = await prisma.user.upsert({
    where: { email: "demo@local.test" },
    update: {},
    create: { email: "demo@local.test", name: "Demo", credits: 100 },
  });

  const existing = await prisma.wardrobeItem.count({ where: { userId: user.id } });
  if (existing > 0) {
    console.log(`Seed skipped — user already has ${existing} items.`);
    return;
  }

  for (let i = 0; i < SEED_ITEMS.length; i++) {
    const item = SEED_ITEMS[i];
    const imagePath = await writePlaceholder(user.id, i, item.colors[0].hex);
    await prisma.wardrobeItem.create({
      data: {
        userId: user.id,
        name: item.name,
        brand: item.brand,
        category: item.category,
        subcategory: item.subcategory,
        colors: JSON.stringify(item.colors),
        priceCents: item.priceCents,
        retailer: item.retailer,
        productUrl: item.productUrl,
        material: item.material,
        pattern: item.pattern,
        styleTags: JSON.stringify(item.styleTags),
        season: JSON.stringify(item.season),
        originalImagePath: imagePath,
        isWishlist: item.isWishlist ?? false,
      },
    });
  }

  console.log(`Seeded ${SEED_ITEMS.length} items for ${user.email}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
