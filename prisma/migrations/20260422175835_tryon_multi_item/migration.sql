/*
  Warnings:

  - You are about to drop the column `itemId` on the `TryOnGeneration` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TryOnGeneration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "itemIds" TEXT NOT NULL DEFAULT '[]',
    "referencePhotoId" TEXT NOT NULL,
    "resultImagePath" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TryOnGeneration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_TryOnGeneration" ("createdAt", "id", "referencePhotoId", "resultImagePath", "userId") SELECT "createdAt", "id", "referencePhotoId", "resultImagePath", "userId" FROM "TryOnGeneration";
DROP TABLE "TryOnGeneration";
ALTER TABLE "new_TryOnGeneration" RENAME TO "TryOnGeneration";
CREATE INDEX "TryOnGeneration_userId_idx" ON "TryOnGeneration"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
