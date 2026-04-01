ALTER TABLE "Draft"
ADD COLUMN "pickStartedAt" DATETIME;

ALTER TABLE "Draft"
ADD COLUMN "pickDeadlineAt" DATETIME;

ALTER TABLE "Draft"
ADD COLUMN "pausedRemainingSeconds" INTEGER;
