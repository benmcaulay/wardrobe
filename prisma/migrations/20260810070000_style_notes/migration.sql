-- The global style prompt is replaced by per-note rules; its vector columns
-- have no remaining reader.
ALTER TABLE "User" DROP COLUMN IF EXISTS "styleVector",
DROP COLUMN IF EXISTS "styleVectorModel",
DROP COLUMN IF EXISTS "styleVectorHash";

-- CreateTable
CREATE TABLE "StyleNote" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "subjectIds" TEXT NOT NULL,
    "rules" TEXT NOT NULL DEFAULT '[]',
    "summary" TEXT,
    "source" TEXT NOT NULL DEFAULT 'keywords',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StyleNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StyleNote_userId_active_idx" ON "StyleNote"("userId", "active");

-- AddForeignKey
ALTER TABLE "StyleNote" ADD CONSTRAINT "StyleNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
