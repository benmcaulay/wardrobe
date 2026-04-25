/*
  Warnings:

  - You are about to drop the `Outfit` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ReferencePhoto` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `itemIds` on the `TryOnGeneration` table. All the data in the column will be lost.
  - You are about to drop the column `referencePhotoId` on the `TryOnGeneration` table. All the data in the column will be lost.
  - Added the required column `itemId` to the `TryOnGeneration` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "Outfit_userId_idx";

-- DropIndex
DROP INDEX "ReferencePhoto_userId_idx";

-- AlterTable
ALTER TABLE "WardrobeItem" ADD COLUMN "ghostImagePath" TEXT;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Outfit";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "ReferencePhoto";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TryOnGeneration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "resultImagePath" TEXT NOT NULL,
    "creditsUsed" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TryOnGeneration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TryOnGeneration_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "WardrobeItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_TryOnGeneration" ("createdAt", "id", "resultImagePath", "userId") SELECT "createdAt", "id", "resultImagePath", "userId" FROM "TryOnGeneration";
DROP TABLE "TryOnGeneration";
ALTER TABLE "new_TryOnGeneration" RENAME TO "TryOnGeneration";
CREATE INDEX "TryOnGeneration_userId_idx" ON "TryOnGeneration"("userId");
CREATE INDEX "TryOnGeneration_itemId_idx" ON "TryOnGeneration"("itemId");
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "stylePrefs" TEXT,
    "credits" INTEGER NOT NULL DEFAULT 0,
    "autoGenerateGhost" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_User" ("createdAt", "email", "id", "name", "stylePrefs") SELECT "createdAt", "email", "id", "name", "stylePrefs" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
