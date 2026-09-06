-- Link a packing bag to the closet item that represents it.
ALTER TABLE "PackingBag" ADD COLUMN "wardrobeItemId" TEXT;

-- One closet item per bag: the link is an identity, not a tag.
CREATE UNIQUE INDEX "PackingBag_wardrobeItemId_key" ON "PackingBag"("wardrobeItemId");
