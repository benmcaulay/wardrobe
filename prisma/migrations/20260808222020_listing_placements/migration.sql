-- CreateTable
CREATE TABLE "ListingPlacement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "askingCents" INTEGER,
    "soldPriceCents" INTEGER,
    "feeCents" INTEGER,
    "feeEstimated" BOOLEAN NOT NULL DEFAULT true,
    "shippingCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "listedAt" TIMESTAMP(3),
    "soldAt" TIMESTAMP(3),
    "externalUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ListingPlacement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ListingPlacement_userId_idx" ON "ListingPlacement"("userId");

-- CreateIndex
CREATE INDEX "ListingPlacement_userId_status_idx" ON "ListingPlacement"("userId", "status");

-- CreateIndex
CREATE INDEX "ListingPlacement_userId_platform_status_idx" ON "ListingPlacement"("userId", "platform", "status");

-- CreateIndex
CREATE INDEX "ListingPlacement_userId_soldAt_idx" ON "ListingPlacement"("userId", "soldAt");

-- CreateIndex
CREATE UNIQUE INDEX "ListingPlacement_listingId_platform_key" ON "ListingPlacement"("listingId", "platform");

-- AddForeignKey
ALTER TABLE "ListingPlacement" ADD CONSTRAINT "ListingPlacement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingPlacement" ADD CONSTRAINT "ListingPlacement_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "SaleListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: SaleListing.marketplaces recorded *intent* (which platforms the
-- user meant to post to) as a JSON string[]. Fan that out into one placement
-- per platform so the new per-platform screens have something to show.
--
-- listedAt/soldAt are deliberately left NULL. We genuinely don't know when a
-- piece went live or sold — createdAt/updatedAt move on any edit — and
-- inventing those dates would make "avg days to sell" a fiction. Time-to-sell
-- therefore only counts sales logged from here on, which is the honest answer.
INSERT INTO "ListingPlacement" (
  "id", "userId", "listingId", "platform", "status",
  "askingCents", "currency", "feeEstimated", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  sl."userId",
  sl."id",
  mp.platform,
  CASE
    -- A sold listing that named exactly one platform can only have sold there.
    WHEN sl."status" = 'sold' AND mp.platform_count = 1 THEN 'sold'
    WHEN sl."status" IN ('listed', 'sold') THEN 'listed'
    ELSE 'draft'
  END,
  sl."askingCents",
  COALESCE(NULLIF(sl."currency", ''), 'USD'),
  true,
  sl."createdAt",
  sl."updatedAt"
FROM "SaleListing" sl
CROSS JOIN LATERAL (
  SELECT
    elem AS platform,
    COUNT(*) OVER () AS platform_count
  FROM jsonb_array_elements_text(
    CASE
      WHEN sl."marketplaces" ~ '^\s*\[' THEN sl."marketplaces"::jsonb
      ELSE '[]'::jsonb
    END
  ) AS elem
) mp
WHERE mp.platform IN ('depop','poshmark','mercari','vinted','ebay','grailed','facebook')
ON CONFLICT ("listingId", "platform") DO NOTHING;

-- Carry the sale price onto the one placement we could attribute above.
UPDATE "ListingPlacement" lp
SET "soldPriceCents" = sl."soldPriceCents"
FROM "SaleListing" sl
WHERE lp."listingId" = sl."id"
  AND lp."status" = 'sold'
  AND sl."soldPriceCents" IS NOT NULL;
