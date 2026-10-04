-- Capture the immutable duration used by each persisted clock revision and a
-- monotonic sequence for the shared draft event stream.
ALTER TABLE "Draft" ADD COLUMN "clockDurationSeconds" INTEGER;
ALTER TABLE "Draft" ADD COLUMN "eventSequence" INTEGER NOT NULL DEFAULT 0;

-- Existing outbox history remains readable through the v1 compatibility path.
-- New v2 events receive both a sequence and, for the authoritative state event,
-- a clockRevision. SQLite unique indexes permit multiple NULL legacy values.
ALTER TABLE "DraftEvent" ADD COLUMN "sequence" INTEGER;
ALTER TABLE "DraftEvent" ADD COLUMN "clockRevision" INTEGER;

CREATE UNIQUE INDEX "DraftEvent_draftId_sequence_key"
ON "DraftEvent"("draftId", "sequence");

CREATE UNIQUE INDEX "DraftEvent_draftId_clockRevision_key"
ON "DraftEvent"("draftId", "clockRevision");
