/**
 * One-time migration: copy all wardrobe data from the legacy SQLite dev.db
 * into the Postgres DATABASE_URL. Opens dev.db read-only — the file is never
 * modified or deleted.
 *
 * Usage:
 *   pnpm db:migrate-from-sqlite
 *   pnpm db:migrate-from-sqlite -- --force   # re-run even if Postgres has rows
 *
 * Prerequisites:
 *   docker compose up -d db   (or colima + docker-compose up -d db)
 *   pnpm prisma migrate deploy
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const ROOT = process.cwd();
const DEFAULT_SQLITE = path.join(ROOT, "prisma", "dev.db");
const force = process.argv.includes("--force");

function querySqlite(dbPath: string, sql: string): Record<string, unknown>[] {
  const out = execFileSync("sqlite3", ["-json", dbPath, sql], { encoding: "utf8" });
  if (!out.trim()) return [];
  return JSON.parse(out) as Record<string, unknown>[];
}

function scalarSqlite(dbPath: string, sql: string): number {
  const out = execFileSync("sqlite3", [dbPath, sql], { encoding: "utf8" }).trim();
  return Number(out || 0);
}

function parseDate(v: unknown): Date {
  if (v == null || v === "") throw new Error("expected a date value");
  if (v instanceof Date) return v;
  if (typeof v === "number") return new Date(v);
  const s = String(v);
  if (/^\d+$/.test(s)) return new Date(Number(s));
  return new Date(s);
}

function parseDateOrNull(v: unknown): Date | null {
  if (v == null || v === "") return null;
  return parseDate(v);
}

function parseBool(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || v === "true";
}

async function main() {
  const sqlitePath = process.env.SQLITE_PATH ?? DEFAULT_SQLITE;
  if (!existsSync(sqlitePath)) {
    console.error(`SQLite database not found: ${sqlitePath}`);
    process.exit(1);
  }
  if (!process.env.DATABASE_URL?.startsWith("postgres")) {
    console.error("DATABASE_URL must be a PostgreSQL URL (see .env.example).");
    process.exit(1);
  }

  console.log(`Reading (read-only): ${path.relative(ROOT, sqlitePath)}`);
  const prisma = new PrismaClient();

  try {
    const existingUsers = await prisma.user.count();
    if (existingUsers > 0 && !force) {
      console.error(
        `Postgres already has ${existingUsers} user(s). Run with --force to import anyway (may hit unique constraints).`,
      );
      process.exit(1);
    }

    const userCount = scalarSqlite(sqlitePath, "SELECT COUNT(*) FROM User");
    const itemCount = scalarSqlite(sqlitePath, "SELECT COUNT(*) FROM WardrobeItem");
    const tripCount = scalarSqlite(sqlitePath, "SELECT COUNT(*) FROM PackingTrip");
    console.log(`Found in SQLite: ${userCount} user, ${itemCount} items, ${tripCount} trips`);

    const savedOutfitCount = scalarSqlite(
      sqlitePath,
      "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='SavedOutfit'",
    )
      ? scalarSqlite(sqlitePath, "SELECT COUNT(*) FROM SavedOutfit")
      : 0;
    if (savedOutfitCount > 0) {
      console.warn(
        `Skipping ${savedOutfitCount} SavedOutfit row(s) — that legacy table has no Postgres equivalent.`,
      );
    }

    await prisma.$transaction(async (tx) => {
      const users = querySqlite(sqlitePath, "SELECT * FROM User");
      for (const row of users) {
        await tx.user.create({
          data: {
            id: String(row.id),
            email: String(row.email),
            name: row.name != null ? String(row.name) : null,
            stylePrefs: row.stylePrefs != null ? String(row.stylePrefs) : null,
            credits: Number(row.credits ?? 0),
            autoGenerateGhost: parseBool(row.autoGenerateGhost),
            createdAt: parseDate(row.createdAt),
          },
        });
      }
      console.log(`  User: ${users.length}`);

      const items = querySqlite(sqlitePath, "SELECT * FROM WardrobeItem");
      for (const row of items) {
        await tx.wardrobeItem.create({
          data: {
            id: String(row.id),
            userId: String(row.userId),
            name: String(row.name),
            brand: row.brand != null ? String(row.brand) : null,
            category: String(row.category),
            subcategory: row.subcategory != null ? String(row.subcategory) : null,
            colors: String(row.colors),
            priceCents: row.priceCents != null ? Number(row.priceCents) : null,
            currency: String(row.currency ?? "USD"),
            retailer: row.retailer != null ? String(row.retailer) : null,
            productUrl: row.productUrl != null ? String(row.productUrl) : null,
            material: row.material != null ? String(row.material) : null,
            pattern: row.pattern != null ? String(row.pattern) : null,
            styleTags: String(row.styleTags),
            season: String(row.season),
            originalImagePath: String(row.originalImagePath),
            originalThumbZoom: Number(row.originalThumbZoom ?? 1),
            originalMirror: parseBool(row.originalMirror),
            ghostImagePath: row.ghostImagePath != null ? String(row.ghostImagePath) : null,
            ghostViews: row.ghostViews != null ? String(row.ghostViews) : null,
            extraImagePaths: row.extraImagePaths != null ? String(row.extraImagePaths) : null,
            isWishlist: parseBool(row.isWishlist),
            timesWorn: Number(row.timesWorn ?? 0),
            lastWornAt: parseDateOrNull(row.lastWornAt),
            weightGrams: row.weightGrams != null ? Number(row.weightGrams) : null,
            volumeLiters: row.volumeLiters != null ? Number(row.volumeLiters) : null,
            notes: row.notes != null ? String(row.notes) : null,
            sourceData: row.sourceData != null ? String(row.sourceData) : null,
            createdAt: parseDate(row.createdAt),
          },
        });
      }
      console.log(`  WardrobeItem: ${items.length}`);

      const photos = querySqlite(sqlitePath, "SELECT * FROM PersonPhoto");
      for (const row of photos) {
        await tx.personPhoto.create({
          data: {
            id: String(row.id),
            userId: String(row.userId),
            imagePath: String(row.imagePath),
            label: row.label != null ? String(row.label) : null,
            createdAt: parseDate(row.createdAt),
          },
        });
      }
      console.log(`  PersonPhoto: ${photos.length}`);

      const outfits = querySqlite(sqlitePath, "SELECT * FROM Outfit");
      for (const row of outfits) {
        await tx.outfit.create({
          data: {
            id: String(row.id),
            userId: String(row.userId),
            name: String(row.name),
            itemIds: String(row.itemIds),
            createdAt: parseDate(row.createdAt),
          },
        });
      }
      console.log(`  Outfit: ${outfits.length}`);

      const layouts = querySqlite(sqlitePath, "SELECT * FROM OutfitLayout");
      for (const row of layouts) {
        await tx.outfitLayout.create({
          data: {
            id: String(row.id),
            userId: String(row.userId),
            name: String(row.name),
            frameHeight: Number(row.frameHeight),
            pieces: String(row.pieces),
            createdAt: parseDate(row.createdAt),
            updatedAt: parseDate(row.updatedAt ?? row.createdAt),
          },
        });
      }
      console.log(`  OutfitLayout: ${layouts.length}`);

      const bags = querySqlite(sqlitePath, "SELECT * FROM PackingBag");
      for (const row of bags) {
        await tx.packingBag.create({
          data: {
            id: String(row.id),
            userId: String(row.userId),
            name: String(row.name),
            volumeLiters: Number(row.volumeLiters),
            maxWeightKg: row.maxWeightKg != null ? Number(row.maxWeightKg) : null,
            silhouette: String(row.silhouette ?? "duffel"),
            imagePath: row.imagePath != null ? String(row.imagePath) : null,
            createdAt: parseDate(row.createdAt),
          },
        });
      }
      console.log(`  PackingBag: ${bags.length}`);

      const trips = querySqlite(sqlitePath, "SELECT * FROM PackingTrip");
      for (const row of trips) {
        await tx.packingTrip.create({
          data: {
            id: String(row.id),
            userId: String(row.userId),
            name: String(row.name),
            destination: String(row.destination),
            startDate: parseDate(row.startDate),
            endDate: parseDate(row.endDate),
            climateData: row.climateData != null ? String(row.climateData) : null,
            bagIds: String(row.bagIds ?? "[]"),
            assignments: String(row.assignments ?? "{}"),
            createdAt: parseDate(row.createdAt),
            updatedAt: parseDate(row.updatedAt ?? row.createdAt),
          },
        });
      }
      console.log(`  PackingTrip: ${trips.length}`);

      const listings = querySqlite(sqlitePath, "SELECT * FROM SaleListing");
      for (const row of listings) {
        await tx.saleListing.create({
          data: {
            id: String(row.id),
            userId: String(row.userId),
            itemId: String(row.itemId),
            status: String(row.status ?? "for_sale"),
            askingCents: row.askingCents != null ? Number(row.askingCents) : null,
            soldPriceCents: row.soldPriceCents != null ? Number(row.soldPriceCents) : null,
            currency: String(row.currency ?? "USD"),
            condition: row.condition != null ? String(row.condition) : null,
            title: row.title != null ? String(row.title) : null,
            description: row.description != null ? String(row.description) : null,
            marketplaces: String(row.marketplaces ?? "[]"),
            createdAt: parseDate(row.createdAt),
            updatedAt: parseDate(row.updatedAt ?? row.createdAt),
          },
        });
      }
      console.log(`  SaleListing: ${listings.length}`);

      const vtons = querySqlite(sqlitePath, "SELECT * FROM VirtualTryOn");
      for (const row of vtons) {
        await tx.virtualTryOn.create({
          data: {
            id: String(row.id),
            userId: String(row.userId),
            personPhotoId: String(row.personPhotoId),
            outfitId: row.outfitId != null ? String(row.outfitId) : null,
            itemIds: String(row.itemIds),
            prompt: row.prompt != null ? String(row.prompt) : null,
            resultImagePath: String(row.resultImagePath),
            creditsUsed: Number(row.creditsUsed ?? 1),
            createdAt: parseDate(row.createdAt),
          },
        });
      }
      console.log(`  VirtualTryOn: ${vtons.length}`);

      const gens = querySqlite(sqlitePath, "SELECT * FROM TryOnGeneration");
      for (const row of gens) {
        await tx.tryOnGeneration.create({
          data: {
            id: String(row.id),
            userId: String(row.userId),
            itemId: String(row.itemId),
            resultImagePath: String(row.resultImagePath),
            creditsUsed: Number(row.creditsUsed ?? 1),
            createdAt: parseDate(row.createdAt),
          },
        });
      }
      console.log(`  TryOnGeneration: ${gens.length}`);
    });

    const verify = await prisma.wardrobeItem.count();
    console.log(`\nDone. Postgres now has ${verify} wardrobe items.`);
    console.log(`${path.relative(ROOT, sqlitePath)} was left untouched.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
