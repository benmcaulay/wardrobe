-- AlterTable
ALTER TABLE "WardrobeItem" ADD COLUMN     "owners" TEXT NOT NULL DEFAULT '[]';

-- Backfill: every pre-existing item belongs to the primary owner ("me" in the
-- default roster seeded in stylePrefs.owners). New items set owners explicitly.
UPDATE "WardrobeItem" SET "owners" = '["me"]' WHERE "owners" = '[]';
