-- AlterTable
ALTER TABLE "User" ADD COLUMN     "styleVector" BYTEA,
ADD COLUMN     "styleVectorModel" TEXT,
ADD COLUMN     "styleVectorHash" TEXT;
