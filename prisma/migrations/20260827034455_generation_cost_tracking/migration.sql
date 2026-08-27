-- AlterTable
ALTER TABLE "TryOnGeneration" ADD COLUMN     "costTenthCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "model" TEXT;

-- AlterTable
ALTER TABLE "VirtualTryOn" ADD COLUMN     "costTenthCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "model" TEXT;
