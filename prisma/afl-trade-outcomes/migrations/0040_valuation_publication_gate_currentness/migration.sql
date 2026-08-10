CREATE OR REPLACE FUNCTION "validate_outcome_valuation_event_insert"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE prior_event "outcome_valuation_publication_event"%ROWTYPE;
        publication_row "outcome_valuation_publication_manifest"%ROWTYPE;
        gate_row "outcome_gate_decision"%ROWTYPE;
        event_content JSONB;
        target_record JSONB;
        gate_decision_id TEXT;
        expected_gate TEXT;
        gate_label TEXT;
        trusted_now TIMESTAMPTZ(3);
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('afl-trade-valuation-publication-registry',0));
  event_content:=NEW."event_json"->'content';
  trusted_now:=date_trunc('milliseconds',clock_timestamp());
  SELECT record INTO target_record
    FROM jsonb_array_elements(event_content->'changedRecords') record
   WHERE record->>'publicationId'=NEW."publication_id";
  IF NEW."event_json"->>'eventId' IS DISTINCT FROM NEW."event_id" OR
     event_content->>'schemaVersion' IS DISTINCT FROM
       'afl-trade-publication-persistence-event/v1' OR
     (event_content->>'revision')::integer IS DISTINCT FROM NEW."revision" OR
     event_content->>'previousEventId' IS DISTINCT FROM NEW."previous_event_id" OR
     event_content->>'publicationId' IS DISTINCT FROM NEW."publication_id" OR
     event_content->>'action' IS DISTINCT FROM NEW."action" OR
     (event_content->>'occurredAt')::timestamptz IS DISTINCT FROM NEW."occurred_at" OR
     NEW."event_id" IS DISTINCT FROM 'publication-event:' ||
       encode(sha256(convert_to("outcome_afl_trade_canonical_json"(event_content),'UTF8')),'hex') OR
     target_record IS NULL OR
     target_record->>'publicationId' IS DISTINCT FROM NEW."publication_id" OR
     NEW."occurred_at" > trusted_now THEN
    RAISE EXCEPTION 'Valuation publication event identity or target is invalid';
  END IF;

  IF NEW."revision"=1 THEN
    IF NEW."previous_event_id" IS NOT NULL THEN
      RAISE EXCEPTION 'The first valuation publication event cannot have a predecessor';
    END IF;
  ELSE
    SELECT * INTO STRICT prior_event FROM "outcome_valuation_publication_event"
     WHERE "revision"=NEW."revision"-1;
    IF NEW."previous_event_id" IS DISTINCT FROM prior_event."event_id" OR
       NEW."occurred_at" < prior_event."occurred_at" THEN
      RAISE EXCEPTION 'Valuation publication events must form one chronological chain';
    END IF;
  END IF;

  IF NEW."action" IN ('approve','publish') THEN
    IF NEW."action"='approve' THEN
      gate_decision_id:=target_record->>'gate4DecisionId';
      expected_gate:='gate_4_publication_api_readiness';
      gate_label:='Gate 4';
    ELSE
      gate_decision_id:=target_record->>'gate5DecisionId';
      expected_gate:='gate_5_comprehension_accessibility';
      gate_label:='Gate 5';
    END IF;
    SELECT * INTO gate_row FROM "outcome_gate_decision"
     WHERE "decision_id"=gate_decision_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Valuation publication requires one exact current % decision',gate_label;
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'afl-trade-gate:' || gate_row."gate" || ':' || gate_row."environment"::text || ':' ||
        gate_row."decision_key",0));
    SELECT * INTO STRICT gate_row FROM "outcome_gate_decision"
     WHERE "decision_id"=gate_decision_id;
    SELECT * INTO STRICT publication_row FROM "outcome_valuation_publication_manifest"
     WHERE "publication_id"=NEW."publication_id";
    IF gate_row."gate" IS DISTINCT FROM expected_gate OR
       gate_row."environment"::text IS DISTINCT FROM
         publication_row."manifest_json"->'content'->>'environment' OR
       gate_row."state" <> 'approved' OR
       gate_row."effective_at" IS NULL OR
       gate_row."effective_at" > NEW."occurred_at" OR
       gate_row."effective_at" > trusted_now OR
       gate_row."revalidate_at" IS NULL OR
       gate_row."revalidate_at" <= trusted_now OR
       EXISTS (SELECT 1 FROM "outcome_gate_decision" successor
                WHERE successor."supersedes_decision_id"=gate_row."decision_id") OR
       NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(
           gate_row."decision_json"->'content'->'affectedArtifacts') artifact
          WHERE artifact->>'kind'='publication'
            AND artifact->>'artifactId'=NEW."publication_id") OR
       NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(
           gate_row."decision_json"->'content'->'affectedArtifacts') artifact
          WHERE artifact->>'kind'='projection'
            AND artifact->>'artifactId'=target_record->>'projectionId') OR
       NOT EXISTS (
         SELECT 1 FROM "outcome_valuation_projection_manifest" projection
          WHERE projection."projection_id"=target_record->>'projectionId'
            AND projection."publication_id"=NEW."publication_id") THEN
      RAISE EXCEPTION 'Valuation publication requires one exact current % decision',gate_label;
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR
  numeric_value_out_of_range OR cardinality_violation THEN
  RAISE EXCEPTION 'Valuation publication event contains invalid typed authority evidence';
END;
$$;
