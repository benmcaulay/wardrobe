-- CreateTable
CREATE TABLE "ProductSearchEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "cached" BOOLEAN NOT NULL DEFAULT false,
    "resultCount" INTEGER NOT NULL DEFAULT 0,
    "costTenthCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductSearchEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductSearchEvent_userId_createdAt_idx" ON "ProductSearchEvent"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "ProductSearchEvent" ADD CONSTRAINT "ProductSearchEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
