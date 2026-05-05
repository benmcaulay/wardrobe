-- The `cutoutImagePath` column was a holdover from the original
-- bg-removal-on-upload step that was removed in the "Drop cutout step" pass.
-- Nothing reads or writes it anymore, so drop it from the table.
ALTER TABLE "WardrobeItem" DROP COLUMN "cutoutImagePath";
