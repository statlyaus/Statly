-- Release membership originally predated versioned acquisition-spell metrics and therefore
-- accepted only the legacy compatibility table. Preserve that path while allowing factual-v3
-- candidates to prove the same eligibility from their exact finalized versioned metric members.

DROP TRIGGER IF EXISTS "outcome_release_acquisition_spell_eligibility"
  ON "outcome_release_acquisition_spell";

CREATE OR REPLACE FUNCTION "validate_outcome_release_acquisition_spell_v2"()
RETURNS TRIGGER AS $$
DECLARE
  release_row RECORD;
  spell_row RECORD;
  candidate_row RECORD;
  candidate_uses_versioned_metrics BOOLEAN := FALSE;
  legacy_metric_count INTEGER;
  versioned_metric_count INTEGER;
  invalid_metric_count INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('outcome-release-parent:' || NEW."spell_version_id", 0)
  );
  PERFORM pg_advisory_xact_lock(
    hashtextextended('outcome-release-membership:' || NEW."release_id", 0)
  );

  SELECT manifest."effective_through", manifest."environment"::"OutcomeEnvironment"
    INTO release_row
    FROM "outcome_release_manifest" manifest
   WHERE manifest."release_id" = NEW."release_id"
   FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Release acquisition-spell membership requires one existing release cutoff';
  END IF;

  SELECT spell."status", spell."recorded_at", spell."start_date",
         spell."end_date", spell."spell_id", spell."player_id", spell."club_id",
         spell."start_event_version_id",
         spell."start_asset_version_id", spell."rule_id"
    INTO spell_row
    FROM "outcome_acquisition_spell_version" spell
   WHERE spell."spell_version_id" = NEW."spell_version_id"
   FOR KEY SHARE;
  IF NOT FOUND OR
     spell_row."status" IS DISTINCT FROM 'approved'::"OutcomeRecordStatus" OR
     spell_row."recorded_at" IS NULL OR
     spell_row."recorded_at" > release_row."effective_through" OR
     spell_row."start_date"::timestamp AT TIME ZONE 'UTC' > release_row."effective_through" THEN
    RAISE EXCEPTION 'Release acquisition-spell membership requires approved evidence within the release cutoff';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM "outcome_release_event_version" event_member
      JOIN "outcome_event_asset" asset
        ON asset."event_version_id" = spell_row."start_event_version_id"
       AND asset."asset_version_id" = spell_row."start_asset_version_id"
      JOIN "outcome_acquisition_spell_rule" rule
        ON rule."rule_id" = spell_row."rule_id"
     WHERE event_member."release_id" = NEW."release_id"
       AND event_member."event_version_id" = spell_row."start_event_version_id"
       AND asset."kind" = 'player'
       AND asset."player_id" = spell_row."player_id"
       AND asset."to_club_id" = spell_row."club_id"
       AND asset."status" = 'approved'::"OutcomeRecordStatus"
       AND rule."status" = 'approved'::"OutcomeRecordStatus"
  ) THEN
    RAISE EXCEPTION 'Released spells require their exact released event asset and approved rule';
  END IF;

  SELECT candidate."candidate_id", candidate."candidate_json", candidate."competition",
         candidate."environment", candidate."created_at", candidate."effective_through",
         candidate."status", candidate."finalized_at"
    INTO candidate_row
    FROM "outcome_factual_release_candidate" candidate
   WHERE candidate."target_release_id" = NEW."release_id"
   FOR KEY SHARE;
  IF FOUND THEN
    candidate_uses_versioned_metrics :=
      jsonb_typeof(candidate_row."candidate_json"->'members'->'spellMetrics') = 'array' AND
      jsonb_array_length(candidate_row."candidate_json"->'members'->'spellMetrics') > 0;
    IF candidate_row."status" IS DISTINCT FROM 'approved'::"OutcomeRecordStatus" OR
       candidate_row."finalized_at" IS NULL OR
       candidate_row."environment" IS DISTINCT FROM release_row."environment" OR
       candidate_row."effective_through" IS DISTINCT FROM release_row."effective_through" OR
       NOT EXISTS (
         SELECT 1
           FROM jsonb_array_elements(
             candidate_row."candidate_json"->'members'->'acquisitionSpells'
           ) planned(member_json)
          WHERE planned.member_json = NEW."membership_json"
            AND planned.member_json->>'spellVersionId' = NEW."spell_version_id"
            AND (planned.member_json->>'ordinal')::INTEGER = NEW."ordinal"
            AND planned.member_json->>'recordSha256' = NEW."record_sha256"
            AND (
              NOT (planned.member_json ? 'spellId')
              OR planned.member_json->>'spellId' = spell_row."spell_id")
            AND planned.member_json->>'playerId' = spell_row."player_id"
            AND planned.member_json->>'clubId' = spell_row."club_id"
            AND planned.member_json->>'startDate' = spell_row."start_date"::TEXT
            AND planned.member_json->>'endDate' IS NOT DISTINCT FROM spell_row."end_date"::TEXT)
    THEN
      RAISE EXCEPTION 'Released spell membership must equal the factual candidate declaration';
    END IF;
  END IF;

  SELECT count(*) INTO legacy_metric_count
    FROM "outcome_acquisition_spell_metric" metric
   WHERE metric."spell_version_id" = NEW."spell_version_id";

  IF NOT candidate_uses_versioned_metrics AND legacy_metric_count > 0 THEN
    IF EXISTS (
      SELECT 1
        FROM "outcome_acquisition_spell_metric" metric
        JOIN "outcome_metric_definition" definition
          ON definition."metric_code" = metric."metric_code"
         AND definition."definition_version" = metric."metric_definition_version"
       WHERE metric."spell_version_id" = NEW."spell_version_id"
         AND definition."status" <> 'approved'::"OutcomeRecordStatus"
    ) OR EXISTS (
      SELECT 1
        FROM "outcome_acquisition_spell_metric" metric
       WHERE metric."spell_version_id" = NEW."spell_version_id"
         AND metric."effective_through"::timestamp AT TIME ZONE 'UTC' >
             release_row."effective_through"
    ) THEN
      RAISE EXCEPTION 'Released spells require approved legacy metrics and no post-cutoff evidence';
    END IF;
    RETURN NEW;
  END IF;

  IF candidate_row."candidate_id" IS NULL THEN
    RAISE EXCEPTION 'Versioned release spell metrics require the exact finalized factual candidate';
  END IF;

  SELECT count(*) INTO versioned_metric_count
    FROM "outcome_release_spell_metric_member" member
    JOIN "outcome_acquisition_spell_metric_version" version
      ON version."spell_metric_version_id" = member."spell_metric_version_id"
   WHERE member."candidate_id" = candidate_row."candidate_id"
     AND version."spell_version_id" = NEW."spell_version_id";

  SELECT count(*) INTO invalid_metric_count
    FROM "outcome_release_spell_metric_member" member
    JOIN "outcome_acquisition_spell_metric_version" version
      ON version."spell_metric_version_id" = member."spell_metric_version_id"
    LEFT JOIN "outcome_acquisition_spell_metric_batch" batch
      ON batch."batch_id" = version."batch_id"
    LEFT JOIN "outcome_acquisition_spell_metric_policy" policy
      ON policy."policy_id" = batch."policy_id"
    LEFT JOIN "outcome_review_decision" approval
      ON approval."decision_id" = policy."approval_decision_id"
    LEFT JOIN "outcome_metric_definition" definition
      ON definition."metric_code" = version."metric_code"
     AND definition."definition_version" = version."definition_version"
    LEFT JOIN "outcome_acquisition_spell_metric_head" head
      ON head."subject_key" = member."membership_json"->>'subjectKey'
   WHERE member."candidate_id" = candidate_row."candidate_id"
     AND version."spell_version_id" = NEW."spell_version_id"
     AND (
       member."record_sha256" IS DISTINCT FROM version."fact_sha256" OR
       head."spell_metric_version_id" IS DISTINCT FROM version."spell_metric_version_id" OR
       head."revision" IS DISTINCT FROM member."head_revision" OR
       batch."spell_version_id" IS DISTINCT FROM NEW."spell_version_id" OR
       batch."environment" IS DISTINCT FROM release_row."environment" OR
       batch."competition" IS DISTINCT FROM candidate_row."competition" OR
       batch."status" IS DISTINCT FROM 'approved'::"OutcomeRecordStatus" OR
       batch."finalized_at" IS NULL OR
       batch."finalized_at" > candidate_row."created_at" OR
       policy."environment" IS DISTINCT FROM release_row."environment" OR
       policy."competition" IS DISTINCT FROM candidate_row."competition" OR
       policy."status" IS DISTINCT FROM 'approved'::"OutcomeRecordStatus" OR
       policy."created_at" > candidate_row."created_at" OR
       approval."decision" IS DISTINCT FROM 'approved' OR
       approval."decided_at" > candidate_row."created_at" OR
       EXISTS (
         SELECT 1 FROM "outcome_review_decision" successor
          WHERE successor."supersedes_decision_id" = approval."decision_id"
       ) OR
       definition."status" IS DISTINCT FROM 'approved'::"OutcomeRecordStatus" OR
       version."recorded_at" > candidate_row."created_at" OR
       version."effective_through"::timestamp AT TIME ZONE 'UTC' >
         release_row."effective_through" OR
       member."membership_json"->>'spellMetricVersionId' IS DISTINCT FROM
         version."spell_metric_version_id" OR
       member."membership_json"->>'spellVersionId' IS DISTINCT FROM
         version."spell_version_id" OR
       member."membership_json"->>'policyId' IS DISTINCT FROM policy."policy_id" OR
       member."membership_json"->>'playerId' IS DISTINCT FROM spell_row."player_id" OR
       member."membership_json"->>'clubId' IS DISTINCT FROM spell_row."club_id" OR
       member."membership_json"->>'metricCode' IS DISTINCT FROM version."metric_code" OR
       member."membership_json"->>'state' IS DISTINCT FROM version."state" OR
       member."membership_json"->>'effectiveThrough' IS DISTINCT FROM
         version."effective_through"::TEXT OR
       member."membership_json"->>'recordSha256' IS DISTINCT FROM member."record_sha256" OR
       (member."membership_json"->>'ordinal')::INTEGER IS DISTINCT FROM member."ordinal" OR
       NOT EXISTS (
         SELECT 1
           FROM jsonb_array_elements(
             candidate_row."candidate_json"->'members'->'spellMetrics'
           ) planned(member_json)
          WHERE planned.member_json = member."membership_json"
       ) OR
       (
         SELECT count(*)
           FROM "outcome_release_spell_metric_member" batch_member
           JOIN "outcome_acquisition_spell_metric_version" batch_version
             ON batch_version."spell_metric_version_id" = batch_member."spell_metric_version_id"
          WHERE batch_member."candidate_id" = candidate_row."candidate_id"
            AND batch_version."batch_id" = batch."batch_id"
       ) IS DISTINCT FROM batch."metric_count"
     );

  IF versioned_metric_count = 0 OR invalid_metric_count <> 0 THEN
    RAISE EXCEPTION 'Released spells require exact approved versioned metrics and no post-cutoff evidence';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "outcome_release_acquisition_spell_eligibility"
AFTER INSERT ON "outcome_release_acquisition_spell"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_release_acquisition_spell_v2"();
