-- Nightly custody readback, and the health that reviewed registration requires.
--
-- A readback run reads located evidence back from its store and compares every byte's SHA-256 and
-- length with the custody row: every located raw_source row in full and a random sample of the other
-- located classes. Unlocated custody (bytes recorded as lost) is outside the run; reviewed
-- registration already refuses to cite it (ARTIFACT_UNLOCATED). A run row is written once, when the
-- run finishes, and is append-only.
--
-- outcome_artifact_custody_healthy(environment) is true when that environment's latest finished run
-- finished under 48 hours ago with zero failures. Reviewed registration requires it; season-spell
-- registration and HPN builds cite no evidence bytes and do not.

CREATE TABLE "outcome_artifact_readback_run" (
  "run_id" TEXT NOT NULL,
  "environment" "OutcomeEnvironment" NOT NULL,
  "store_id" TEXT NOT NULL,
  "started_at" TIMESTAMPTZ(3) NOT NULL,
  "finished_at" TIMESTAMPTZ(3) NOT NULL,
  "rows_checked" INTEGER NOT NULL,
  "failures" INTEGER NOT NULL,
  "failing_artifact_ids" JSONB NOT NULL,
  "checked_by_class" JSONB NOT NULL,
  "sample_policy" JSONB NOT NULL,
  "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "outcome_artifact_readback_run_pkey" PRIMARY KEY ("run_id"),
  CONSTRAINT "outcome_artifact_readback_run_store_fkey" FOREIGN KEY ("store_id")
    REFERENCES "outcome_artifact_store"("store_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_artifact_readback_run_shape_check" CHECK (
    "run_id" ~ '^artifact-readback-run:[a-z0-9-]{8,80}$'
    AND "finished_at" >= "started_at" AND "recorded_at" >= "finished_at"
    AND "rows_checked" >= 0 AND "failures" >= 0 AND "failures" <= "rows_checked"
    AND jsonb_typeof("failing_artifact_ids") = 'array'
    AND jsonb_array_length("failing_artifact_ids") = "failures"
    AND jsonb_typeof("checked_by_class") = 'object'
    AND jsonb_typeof("sample_policy") = 'object')
);

CREATE INDEX "outcome_artifact_readback_run_latest_idx"
  ON "outcome_artifact_readback_run"("environment", "finished_at" DESC);

CREATE TRIGGER "outcome_artifact_readback_run_no_write"
BEFORE DELETE OR UPDATE ON "outcome_artifact_readback_run"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_authority_mutation"();

-- A run reads one store, which must belong to the run's environment.
CREATE FUNCTION validate_outcome_artifact_readback_run_insert() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM outcome_artifact_store store
      WHERE store.store_id=NEW.store_id AND store.environment=NEW.environment) THEN
    RAISE EXCEPTION 'A custody readback run reads a registered store in its own environment';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "outcome_artifact_readback_run_insert_guard"
BEFORE INSERT ON "outcome_artifact_readback_run"
FOR EACH ROW EXECUTE FUNCTION validate_outcome_artifact_readback_run_insert();

CREATE FUNCTION outcome_artifact_custody_healthy(target_environment "OutcomeEnvironment")
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT COALESCE((
    SELECT latest.failures = 0 AND latest.finished_at > clock_timestamp() - interval '48 hours'
      FROM outcome_artifact_readback_run latest
     WHERE latest.environment = target_environment
     ORDER BY latest.finished_at DESC, latest.run_id DESC
     LIMIT 1), FALSE)
$$;

COMMENT ON FUNCTION outcome_artifact_custody_healthy("OutcomeEnvironment") IS
  'True when the environment''s latest finished custody readback run finished under 48 hours ago with zero failures.';
