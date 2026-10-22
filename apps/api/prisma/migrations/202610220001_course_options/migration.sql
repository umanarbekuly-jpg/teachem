ALTER TYPE "FilePurpose" ADD VALUE 'course_cover';
ALTER TABLE "Course" ALTER COLUMN "level" SET DEFAULT '';
ALTER TABLE "Course" ADD COLUMN "durationDays" INTEGER NOT NULL DEFAULT 30,
 ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
 ADD COLUMN "coverAssetId" UUID REFERENCES "FileAsset"("id") ON DELETE RESTRICT;
ALTER TABLE "Course" ADD CONSTRAINT "Course_duration_positive" CHECK ("durationDays" > 0),
 ADD CONSTRAINT "Course_tags_limit" CHECK (cardinality("tags") <= 3);
CREATE INDEX "Course_tags_idx" ON "Course" USING GIN ("tags");
ALTER TABLE "Payment" ADD COLUMN "durationDays" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_duration_positive" CHECK ("durationDays" > 0);
-- Existing amounts, expiry dates, profiles and legacy levels are deliberately retained.
