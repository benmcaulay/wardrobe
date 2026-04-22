import { describe, it, expect, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { analyzeGarment } from "../lib/services/vision";
import { reverseImageSearch } from "../lib/services/reverseImageSearch";
import { scrapeProduct } from "../lib/services/productScraper";
import { removeBackground } from "../lib/services/backgroundRemoval";
import { generateTryOn } from "../lib/services/virtualTryOn";
import { UPLOADS_ROOT } from "../lib/uploads";

const TEST_USER = "__test_services__";
const TEST_DIR = path.join(UPLOADS_ROOT, TEST_USER);

async function cleanup() {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
}
afterAll(cleanup);

async function writeTestImage(name: string, color: string): Promise<string> {
  await fs.mkdir(TEST_DIR, { recursive: true });
  const abs = path.join(TEST_DIR, name);
  await sharp({ create: { width: 800, height: 800, channels: 3, background: color } })
    .jpeg({ quality: 80 })
    .toFile(abs);
  return path.posix.join(TEST_USER, name);
}

describe("vision.analyzeGarment", () => {
  it("returns a VisionResult shape", async () => {
    const result = await analyzeGarment("user/foo.jpg");
    expect(["top", "bottom", "dress", "outerwear", "shoes", "accessory"]).toContain(result.category);
    expect(typeof result.subcategory).toBe("string");
    expect(result.colors.length).toBeGreaterThanOrEqual(1);
    for (const c of result.colors) {
      expect(c.hex).toMatch(/^#[0-9a-f]{6}$/i);
      expect(typeof c.name).toBe("string");
    }
    expect(result.styleTags.length).toBeGreaterThanOrEqual(2);
    expect(result.season.length).toBeGreaterThanOrEqual(1);
    for (const s of result.season) {
      expect(["spring", "summer", "fall", "winter"]).toContain(s);
    }
  });

  it("is deterministic for the same input", async () => {
    const a = await analyzeGarment("user/same.jpg");
    const b = await analyzeGarment("user/same.jpg");
    expect(a).toEqual(b);
  });

  it("produces different output for different inputs", async () => {
    const a = await analyzeGarment("user/a.jpg");
    const b = await analyzeGarment("user/b.jpg");
    expect(a).not.toEqual(b);
  });
});

describe("reverseImageSearch", () => {
  it("returns 2..4 matches sorted by confidence (desc)", async () => {
    const matches = await reverseImageSearch("user/foo.jpg");
    expect(matches.length).toBeGreaterThanOrEqual(2);
    expect(matches.length).toBeLessThanOrEqual(4);
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i - 1].confidence).toBeGreaterThanOrEqual(matches[i].confidence);
    }
    for (const m of matches) {
      expect(m.priceCents).toBeGreaterThan(0);
      expect(m.confidence).toBeGreaterThan(0);
      expect(m.confidence).toBeLessThanOrEqual(1);
      expect(m.url).toMatch(/^https?:\/\//);
    }
  });

  it("is deterministic for the same input", async () => {
    const a = await reverseImageSearch("user/abc.jpg");
    const b = await reverseImageSearch("user/abc.jpg");
    expect(a).toEqual(b);
  });
});

describe("scrapeProduct", () => {
  it("returns a ProductMetadata shape", async () => {
    const meta = await scrapeProduct("https://everlane.com/products/linen-shirt");
    expect(meta.productUrl).toBe("https://everlane.com/products/linen-shirt");
    expect(meta.brand.length).toBeGreaterThan(0);
    expect(meta.currency).toBe("USD");
    expect(meta.priceCents).toBeGreaterThan(0);
    expect(meta.colors.length).toBeGreaterThanOrEqual(1);
  });

  it("tolerates bad URLs", async () => {
    const meta = await scrapeProduct("not-a-real-url");
    expect(meta.productUrl).toBe("not-a-real-url");
    expect(meta.priceCents).toBeGreaterThan(0);
  });

  it("is deterministic for the same URL", async () => {
    const a = await scrapeProduct("https://cos.com/products/wool-trouser");
    const b = await scrapeProduct("https://cos.com/products/wool-trouser");
    expect(a).toEqual(b);
  });
});

describe("removeBackground", () => {
  it("returns a null cutout (no-op stub)", async () => {
    const r = await removeBackground("anything.jpg");
    expect(r.cutoutImagePath).toBeNull();
  });
});

describe("generateTryOn", () => {
  it("writes a composite file + thumbnail and returns a DB-relative path", async () => {
    const personPath = await writeTestImage("person.jpg", "#d9ccb3");
    const garmentPath = await writeTestImage("garment.jpg", "#7a8c6f");
    const result = await generateTryOn({
      userId: TEST_USER,
      personImagePath: personPath,
      garmentImagePaths: [garmentPath],
    });
    expect(result.resultImagePath.startsWith(`${TEST_USER}/tryon-`)).toBe(true);
    const abs = path.join(UPLOADS_ROOT, result.resultImagePath);
    const meta = await sharp(abs).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(1024);
    expect(meta.height).toBe(1366);

    // Thumbnail companion
    const thumbRel = result.resultImagePath.replace(/\.jpg$/, "-thumb.jpg");
    const thumbMeta = await sharp(path.join(UPLOADS_ROOT, thumbRel)).metadata();
    expect(thumbMeta.width).toBeLessThanOrEqual(400);
    expect(thumbMeta.height).toBeLessThanOrEqual(400);
  });

  it("composites multiple garments in one call", async () => {
    const personPath = await writeTestImage("person.jpg", "#d9ccb3");
    const g1 = await writeTestImage("g1.jpg", "#7a8c6f");
    const g2 = await writeTestImage("g2.jpg", "#b5553a");
    const g3 = await writeTestImage("g3.jpg", "#5a6b85");
    const result = await generateTryOn({
      userId: TEST_USER,
      personImagePath: personPath,
      garmentImagePaths: [g1, g2, g3],
    });
    const meta = await sharp(path.join(UPLOADS_ROOT, result.resultImagePath)).metadata();
    expect(meta.width).toBe(1024);
    expect(meta.height).toBe(1366);
  });

  it("is deterministic for the same inputs regardless of garment order", async () => {
    const personPath = await writeTestImage("person.jpg", "#d9ccb3");
    const g1 = await writeTestImage("g1.jpg", "#7a8c6f");
    const g2 = await writeTestImage("g2.jpg", "#b5553a");
    const a = await generateTryOn({
      userId: TEST_USER,
      personImagePath: personPath,
      garmentImagePaths: [g1, g2],
    });
    const b = await generateTryOn({
      userId: TEST_USER,
      personImagePath: personPath,
      garmentImagePaths: [g2, g1],
    });
    expect(a.resultImagePath).toBe(b.resultImagePath);
  });

  it("throws when no garments are provided", async () => {
    const personPath = await writeTestImage("person.jpg", "#d9ccb3");
    await expect(
      generateTryOn({
        userId: TEST_USER,
        personImagePath: personPath,
        garmentImagePaths: [],
      }),
    ).rejects.toThrow();
  });

  it("throws on traversal-unsafe paths", async () => {
    await expect(
      generateTryOn({
        userId: TEST_USER,
        personImagePath: "../etc/passwd",
        garmentImagePaths: ["../etc/passwd"],
      }),
    ).rejects.toThrow();
  });
});
