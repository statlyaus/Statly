ALTER TABLE "DraftEvent"
ADD COLUMN "lockedAt" DATETIME;

ALTER TABLE "DraftEvent"
ADD COLUMN "lockedBy" TEXT;

CREATE INDEX "DraftEvent_lockedAt_createdAt_idx" ON "DraftEvent"("lockedAt", "createdAt");
