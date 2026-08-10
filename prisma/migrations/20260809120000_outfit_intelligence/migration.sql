-- AlterTable
ALTER TABLE "WardrobeItem" ADD COLUMN     "effectiveWears" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "protectedAt" TIMESTAMP(3);

-- Seed the confidence-weighted mirror from the existing integer counter. Every
-- pre-existing wear was recorded explicitly, so it carries full confidence.
UPDATE "WardrobeItem" SET "effectiveWears" = "timesWorn" WHERE "timesWorn" > 0;

-- CreateTable
CREATE TABLE "WearEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "wornOn" DATE NOT NULL,
    "outfitId" TEXT,
    "source" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "confirmedAt" TIMESTAMP(3),
    "tempHighC" DOUBLE PRECISION,
    "climateBand" TEXT,
    "precipMm" DOUBLE PRECISION,
    "occasion" TEXT,
    "wearerId" TEXT,
    "placeLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WearEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreferenceEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "itemIds" TEXT NOT NULL,
    "rejectedIds" TEXT NOT NULL DEFAULT '[]',
    "contextJson" TEXT,
    "policyId" TEXT,
    "propensity" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreferenceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemEmbedding" (
    "itemId" TEXT NOT NULL,
    "vector" BYTEA NOT NULL,
    "dims" INTEGER NOT NULL DEFAULT 512,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemEmbedding_pkey" PRIMARY KEY ("itemId")
);

-- CreateTable
CREATE TABLE "WearEventItem" (
    "wearEventId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,

    CONSTRAINT "WearEventItem_pkey" PRIMARY KEY ("wearEventId","itemId")
);

-- CreateIndex
CREATE INDEX "WearEventItem_itemId_idx" ON "WearEventItem"("itemId");

-- CreateIndex
CREATE INDEX "WearEvent_userId_wornOn_idx" ON "WearEvent"("userId", "wornOn");

-- CreateIndex
CREATE INDEX "WearEvent_userId_source_idx" ON "WearEvent"("userId", "source");

-- CreateIndex
CREATE INDEX "WearEvent_outfitId_idx" ON "WearEvent"("outfitId");

-- CreateIndex
CREATE INDEX "PreferenceEvent_userId_kind_idx" ON "PreferenceEvent"("userId", "kind");

-- CreateIndex
CREATE INDEX "PreferenceEvent_userId_createdAt_idx" ON "PreferenceEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ItemEmbedding_model_idx" ON "ItemEmbedding"("model");

-- AddForeignKey
ALTER TABLE "WearEvent" ADD CONSTRAINT "WearEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WearEventItem" ADD CONSTRAINT "WearEventItem_wearEventId_fkey" FOREIGN KEY ("wearEventId") REFERENCES "WearEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WearEventItem" ADD CONSTRAINT "WearEventItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "WardrobeItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreferenceEvent" ADD CONSTRAINT "PreferenceEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemEmbedding" ADD CONSTRAINT "ItemEmbedding_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "WardrobeItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
