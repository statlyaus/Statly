CREATE OR REPLACE FUNCTION "validate_outcome_spell_metric_head"()
RETURNS TRIGGER AS $$
DECLARE
  version_row RECORD;
  current_head RECORD;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('acquisition-spell-metric-head:' || NEW."subject_key", 0)
  );
  SELECT v."expected_head_revision",v."head_revision",v."recorded_at",b."finalized_at"
    INTO version_row
    FROM "outcome_acquisition_spell_metric_version" v
    JOIN "outcome_acquisition_spell_metric_batch" b ON b."batch_id"=v."batch_id"
   WHERE v."spell_metric_version_id"=NEW."spell_metric_version_id";
  IF NOT FOUND OR version_row."finalized_at" IS NOT NULL OR
     NEW."revision"<>version_row."head_revision" OR
     NEW."updated_at"<>version_row."recorded_at" THEN
    RAISE EXCEPTION 'Spell metric head must bind the exact open-batch version';
  END IF;
  IF TG_OP='INSERT' THEN
    SELECT "revision","updated_at" INTO current_head
      FROM "outcome_acquisition_spell_metric_head"
     WHERE "subject_key"=NEW."subject_key";
    IF FOUND THEN
      IF current_head."revision"<>version_row."expected_head_revision" OR
         NEW."revision"<>current_head."revision"+1 OR
         NEW."updated_at"<current_head."updated_at" THEN
        RAISE EXCEPTION 'Spell metric head compare-and-swap revision is stale';
      END IF;
    ELSIF version_row."expected_head_revision"<>0 OR NEW."revision"<>1 THEN
      RAISE EXCEPTION 'Initial spell metric head must use revision one';
    END IF;
  ELSIF NEW."subject_key"<>OLD."subject_key" OR
        OLD."revision"<>version_row."expected_head_revision" OR
        NEW."revision"<>OLD."revision"+1 OR
        NEW."updated_at"<OLD."updated_at" THEN
    RAISE EXCEPTION 'Spell metric head compare-and-swap revision is stale';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
