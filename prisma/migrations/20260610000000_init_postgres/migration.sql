-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "stylePrefs" TEXT,
    "credits" INTEGER NOT NULL DEFAULT 0,
    "autoGenerateGhost" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WardrobeItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "category" TEXT NOT NULL,
    "subcategory" TEXT,
    "colors" TEXT NOT NULL,
    "priceCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "retailer" TEXT,
    "productUrl" TEXT,
    "material" TEXT,
    "pattern" TEXT,
    "styleTags" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "originalImagePath" TEXT NOT NULL,
    "originalThumbZoom" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "originalMirror" BOOLEAN NOT NULL DEFAULT false,
    "ghostImagePath" TEXT,
    "ghostViews" TEXT,
    "extraImagePaths" TEXT,
    "isWishlist" BOOLEAN NOT NULL DEFAULT false,
    "timesWorn" INTEGER NOT NULL DEFAULT 0,
    "lastWornAt" TIMESTAMP(3),
    "weightGrams" INTEGER,
    "volumeLiters" DOUBLE PRECISION,
    "notes" TEXT,
    "sourceData" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WardrobeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TryOnGeneration" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "resultImagePath" TEXT NOT NULL,
    "creditsUsed" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TryOnGeneration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonPhoto" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "imagePath" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Outfit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "itemIds" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Outfit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VirtualTryOn" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "personPhotoId" TEXT NOT NULL,
    "outfitId" TEXT,
    "itemIds" TEXT NOT NULL,
    "prompt" TEXT,
    "resultImagePath" TEXT NOT NULL,
    "creditsUsed" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VirtualTryOn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleListing" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'for_sale',
    "askingCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "condition" TEXT,
    "title" TEXT,
    "description" TEXT,
    "marketplaces" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SaleListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutfitLayout" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "frameHeight" INTEGER NOT NULL,
    "pieces" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutfitLayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackingBag" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "volumeLiters" DOUBLE PRECISION NOT NULL,
    "maxWeightKg" DOUBLE PRECISION,
    "silhouette" TEXT NOT NULL DEFAULT 'duffel',
    "imagePath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PackingBag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackingTrip" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "climateData" TEXT,
    "bagIds" TEXT NOT NULL DEFAULT '[]',
    "assignments" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PackingTrip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "WardrobeItem_userId_idx" ON "WardrobeItem"("userId");

-- CreateIndex
CREATE INDEX "WardrobeItem_userId_category_idx" ON "WardrobeItem"("userId", "category");

-- CreateIndex
CREATE INDEX "TryOnGeneration_userId_idx" ON "TryOnGeneration"("userId");

-- CreateIndex
CREATE INDEX "TryOnGeneration_itemId_idx" ON "TryOnGeneration"("itemId");

-- CreateIndex
CREATE INDEX "PersonPhoto_userId_idx" ON "PersonPhoto"("userId");

-- CreateIndex
CREATE INDEX "Outfit_userId_idx" ON "Outfit"("userId");

-- CreateIndex
CREATE INDEX "VirtualTryOn_userId_idx" ON "VirtualTryOn"("userId");

-- CreateIndex
CREATE INDEX "VirtualTryOn_personPhotoId_idx" ON "VirtualTryOn"("personPhotoId");

-- CreateIndex
CREATE UNIQUE INDEX "SaleListing_itemId_key" ON "SaleListing"("itemId");

-- CreateIndex
CREATE INDEX "SaleListing_userId_idx" ON "SaleListing"("userId");

-- CreateIndex
CREATE INDEX "SaleListing_userId_status_idx" ON "SaleListing"("userId", "status");

-- CreateIndex
CREATE INDEX "OutfitLayout_userId_idx" ON "OutfitLayout"("userId");

-- CreateIndex
CREATE INDEX "PackingBag_userId_idx" ON "PackingBag"("userId");

-- CreateIndex
CREATE INDEX "PackingTrip_userId_idx" ON "PackingTrip"("userId");

-- AddForeignKey
ALTER TABLE "WardrobeItem" ADD CONSTRAINT "WardrobeItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TryOnGeneration" ADD CONSTRAINT "TryOnGeneration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TryOnGeneration" ADD CONSTRAINT "TryOnGeneration_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "WardrobeItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonPhoto" ADD CONSTRAINT "PersonPhoto_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Outfit" ADD CONSTRAINT "Outfit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VirtualTryOn" ADD CONSTRAINT "VirtualTryOn_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VirtualTryOn" ADD CONSTRAINT "VirtualTryOn_personPhotoId_fkey" FOREIGN KEY ("personPhotoId") REFERENCES "PersonPhoto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VirtualTryOn" ADD CONSTRAINT "VirtualTryOn_outfitId_fkey" FOREIGN KEY ("outfitId") REFERENCES "Outfit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleListing" ADD CONSTRAINT "SaleListing_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleListing" ADD CONSTRAINT "SaleListing_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "WardrobeItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutfitLayout" ADD CONSTRAINT "OutfitLayout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackingBag" ADD CONSTRAINT "PackingBag_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackingTrip" ADD CONSTRAINT "PackingTrip_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

