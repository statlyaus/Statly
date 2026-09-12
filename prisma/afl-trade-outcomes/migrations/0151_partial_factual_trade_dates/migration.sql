-- Year-only trade facts retain their season on outcome_event. Never invent a day.
ALTER TABLE outcome_event_version ALTER COLUMN event_date DROP NOT NULL;
ALTER TABLE outcome_event_version ADD CONSTRAINT outcome_event_date_precision_check
  CHECK (event_date IS NOT NULL OR kind = 'trade');

-- A partial-date proposal uses the existing single-session draft coverage rules.
-- Only the date contract changes; reviewed content and its digest remain untouched.
ALTER FUNCTION outcome_external_draft_sessions_exact(TEXT,JSONB)
  RENAME TO outcome_external_draft_sessions_exact_before_partial_dates;
CREATE FUNCTION outcome_external_draft_sessions_exact(target_candidate TEXT, proposal JSONB)
RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$
  SELECT outcome_external_draft_sessions_exact_before_partial_dates(target_candidate,
    CASE WHEN proposal->>'schemaVersion'='afl-trade-external-canonical-promotion-proposal/v4'
      THEN jsonb_set(proposal,'{schemaVersion}',to_jsonb('afl-trade-external-canonical-promotion-proposal/v1'::TEXT))
      ELSE proposal END);
$$;

-- Preserve all existing authority checks; require an exact known predecessor fragment.
DO $migration$
DECLARE original TEXT; old_fragment CONSTANT TEXT := $old$extract(year FROM proposed.occurred_on)::integer IS DISTINCT FROM actual.season_year$old$;
BEGIN
  SELECT pg_get_functiondef('validate_outcome_external_canonical_promotion_insert()'::regprocedure) INTO original;
  IF (length(original)-length(replace(original,old_fragment,'')))/length(old_fragment)<>1 THEN
    RAISE EXCEPTION 'Expected exact partial-date predecessor in validate_outcome_external_canonical_promotion_insert()';
  END IF;
  EXECUTE replace(original,old_fragment,$new$(proposed.occurred_on IS NOT NULL AND extract(year FROM proposed.occurred_on)::integer IS DISTINCT FROM actual.season_year)
        OR (proposed.occurred_on IS NULL AND (
          (NEW.proposal_json->'content')->>'schemaVersion' IS DISTINCT FROM 'afl-trade-external-canonical-promotion-proposal/v4'
          OR proposed.season_year>extract(year FROM ((NEW.proposal_json->'content')->>'proposedAt')::timestamptz AT TIME ZONE 'Australia/Melbourne')
          OR proposed.season_year>extract(year FROM NEW.promoted_at AT TIME ZONE 'Australia/Melbourne')
          OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements((NEW.proposal_json->'content')->'transactionDateCoverage') item
            WHERE item->>'transactionId'=proposed.transaction_id AND item->'occurredOn'='null'::JSONB)))$new$);
END $migration$;

-- Preserve all existing authority checks; require an exact known predecessor fragment.
DO $migration$
DECLARE original TEXT; old_fragment CONSTANT TEXT := $old$extract(year FROM proposed.occurred_on)::integer IS DISTINCT FROM actual.season_year$old$;
BEGIN
  SELECT pg_get_functiondef('validate_outcome_external_promotion_review_insert()'::regprocedure) INTO original;
  IF (length(original)-length(replace(original,old_fragment,'')))/length(old_fragment)<>1 THEN
    RAISE EXCEPTION 'Expected exact partial-date predecessor in validate_outcome_external_promotion_review_insert()';
  END IF;
  EXECUTE replace(original,old_fragment,$new$(proposed.occurred_on IS NOT NULL AND extract(year FROM proposed.occurred_on)::integer IS DISTINCT FROM actual.season_year)
        OR (proposed.occurred_on IS NULL AND (
          (content)->>'schemaVersion' IS DISTINCT FROM 'afl-trade-external-canonical-promotion-proposal/v4'
          OR proposed.season_year>extract(year FROM ((content)->>'proposedAt')::timestamptz AT TIME ZONE 'Australia/Melbourne')
          OR proposed.season_year>extract(year FROM NEW.decided_at AT TIME ZONE 'Australia/Melbourne')
          OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements((content)->'transactionDateCoverage') item
            WHERE item->>'transactionId'=proposed.transaction_id AND item->'occurredOn'='null'::JSONB)))$new$);
END $migration$;

-- Preserve all existing authority checks; require an exact known predecessor fragment.
DO $migration$
DECLARE original TEXT; old_fragment CONSTANT TEXT := $old$value.event_date=(coverage->>'occurredOn')::date$old$;
BEGIN
  SELECT pg_get_functiondef('finalize_outcome_external_canonical_promotion()'::regprocedure) INTO original;
  IF (length(original)-length(replace(original,old_fragment,'')))/length(old_fragment)<>1 THEN
    RAISE EXCEPTION 'Expected exact partial-date predecessor in finalize_outcome_external_canonical_promotion()';
  END IF;
  EXECUTE replace(original,old_fragment,$new$value.event_date IS NOT DISTINCT FROM (coverage->>'occurredOn')::date$new$);
END $migration$;

-- Preserve all existing authority checks; require an exact known predecessor fragment.
DO $migration$
DECLARE original TEXT; old_fragment CONSTANT TEXT := $old$OR target_time IS NULL OR target_time > cutoff OR target_effective_time > cutoff THEN$old$;
BEGIN
  SELECT pg_get_functiondef('validate_outcome_release_event_version_membership()'::regprocedure) INTO original;
  IF (length(original)-length(replace(original,old_fragment,'')))/length(old_fragment)<>1 THEN
    RAISE EXCEPTION 'Expected exact partial-date predecessor in validate_outcome_release_event_version_membership()';
  END IF;
  EXECUTE replace(original,old_fragment,$new$OR target_time IS NULL OR target_time > cutoff OR target_effective_time > cutoff
     OR (target_effective_time IS NULL AND (
       target_kind IS DISTINCT FROM 'trade'::"OutcomeEventKind"
       OR target_season_year IS NULL
       OR make_date(target_season_year+1,1,1)::timestamp AT TIME ZONE 'UTC' > cutoff)) THEN$new$);
END $migration$;

-- Preserve all existing authority checks; require an exact known predecessor fragment.
DO $migration$
DECLARE original TEXT; old_fragment CONSTANT TEXT := $old$OR version.recorded_at>parent.knowledge_cutoff_at OR version.event_date>parent.knowledge_cutoff_at::DATE)$old$;
BEGIN
  SELECT pg_get_functiondef('authenticate_outcome_private_valuation_cohort_input(text,text)'::regprocedure) INTO original;
  IF (length(original)-length(replace(original,old_fragment,'')))/length(old_fragment)<>1 THEN
    RAISE EXCEPTION 'Expected exact partial-date predecessor in authenticate_outcome_private_valuation_cohort_input(text,text)';
  END IF;
  EXECUTE replace(original,old_fragment,$new$OR version.event_date IS NULL
      OR version.recorded_at>parent.knowledge_cutoff_at OR version.event_date>parent.knowledge_cutoff_at::DATE)$new$);
END $migration$;
