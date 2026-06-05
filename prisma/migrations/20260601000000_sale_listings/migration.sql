-- CreateTable
CREATE TABLE "SaleListing" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'for_sale',
    "askingCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "condition" TEXT,
    "title" TEXT,
    "description" TEXT,
    "marketplaces" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SaleListing_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SaleListing_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "WardrobeItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "SaleListing_itemId_key" ON "SaleListing"("itemId");

-- CreateIndex
CREATE INDEX "SaleListing_userId_idx" ON "SaleListing"("userId");

-- CreateIndex
CREATE INDEX "SaleListing_userId_status_idx" ON "SaleListing"("userId", "status");
