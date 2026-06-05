-- AlterTable: packing estimate overrides on wardrobe items
ALTER TABLE "WardrobeItem" ADD COLUMN "weightGrams" INTEGER;
ALTER TABLE "WardrobeItem" ADD COLUMN "volumeLiters" REAL;

-- CreateTable
CREATE TABLE "PackingBag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "volumeLiters" REAL NOT NULL,
    "maxWeightKg" REAL,
    "silhouette" TEXT NOT NULL DEFAULT 'duffel',
    "imagePath" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PackingBag_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PackingTrip" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "climateData" TEXT,
    "bagIds" TEXT NOT NULL DEFAULT '[]',
    "assignments" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PackingTrip_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PackingBag_userId_idx" ON "PackingBag"("userId");

-- CreateIndex
CREATE INDEX "PackingTrip_userId_idx" ON "PackingTrip"("userId");
