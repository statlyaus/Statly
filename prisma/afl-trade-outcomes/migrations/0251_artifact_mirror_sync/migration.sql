-- Finished evidence-store mirror syncs (#737).
--
-- A sync records when it started and finished, after its copy succeeded. Every location recorded
-- before a sync started was written to the store first (write-first custody), so its bytes were on
-- disk when that sync began and are in the mirror. The monthly restore test samples only those
-- locations. Rows are append-only, and a sync names the mirror its store has recorded.

CREATE TABLE "outcome_artifact_mirror_sync" (
  "sync_id" TEXT NOT NULL,
  "store_id" TEXT NOT NULL,
  "mirror_locator" TEXT NOT NULL,
  "started_at" TIMESTAMPTZ(3) NOT NULL,
  "finished_at" TIMESTAMPTZ(3) NOT NULL,
  "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "outcome_artifact_mirror_sync_pkey" PRIMARY KEY ("sync_id"),
  CONSTRAINT "outcome_artifact_mirror_sync_store_fkey" FOREIGN KEY ("store_id")
    REFERENCES "outcome_artifact_store"("store_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_artifact_mirror_sync_shape_check" CHECK (
    "sync_id" ~ '^artifact-mirror-sync:[a-z0-9-]{8,80}$'
    AND "finished_at" >= "started_at" AND "recorded_at" >= "finished_at")
);

CREATE INDEX "outcome_artifact_mirror_sync_latest_idx"
  ON "outcome_artifact_mirror_sync"("store_id", "finished_at" DESC);

CREATE TRIGGER "outcome_artifact_mirror_sync_no_write"
BEFORE DELETE OR UPDATE ON "outcome_artifact_mirror_sync"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_authority_mutation"();

CREATE FUNCTION validate_outcome_artifact_mirror_sync_insert() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM outcome_artifact_store store
      WHERE store.store_id=NEW.store_id AND store.mirror_locator=NEW.mirror_locator) THEN
    RAISE EXCEPTION 'A mirror sync names the mirror its store has recorded';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "outcome_artifact_mirror_sync_insert_guard"
BEFORE INSERT ON "outcome_artifact_mirror_sync"
FOR EACH ROW EXECUTE FUNCTION validate_outcome_artifact_mirror_sync_insert();
