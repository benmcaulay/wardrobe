-- AlterTable
ALTER TABLE "PackingTrip" ADD COLUMN     "countryCode" TEXT,
ADD COLUMN     "gearAssignments" TEXT NOT NULL DEFAULT '{}',
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "timezone" TEXT;

-- CreateTable
CREATE TABLE "PackingGear" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'misc',
    "icon" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "weightGrams" INTEGER,
    "volumeLiters" DOUBLE PRECISION,
    "notes" TEXT,
    "essential" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PackingGear_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PackingGear_userId_idx" ON "PackingGear"("userId");

-- AddForeignKey
ALTER TABLE "PackingGear" ADD CONSTRAINT "PackingGear_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
