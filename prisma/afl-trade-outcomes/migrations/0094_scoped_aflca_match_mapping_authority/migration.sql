CREATE OR REPLACE FUNCTION "validate_outcome_scoped_aflca_match_mapping"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  mapping RECORD;
  mapping_decision_id TEXT;
  mapping_evidence_id TEXT;
BEGIN
  IF NEW."subject_type"='local_scoped_aflca_match_mapping' THEN
    IF NEW."decision"<>'approved'
       OR NEW."decided_by"<>'statly-product-owner'
       OR NEW."canonical_record_type" IS NOT NULL
       OR NEW."canonical_record_id" IS NOT NULL
       OR NEW."subject_id" !~ '^artifact:[a-f0-9]{64}$'
       OR NEW."subject_id" IS DISTINCT FROM
          'artifact:'||encode(sha256(convert_to(
            "outcome_afl_trade_canonical_json"(NEW."evidence_json"),'UTF8')),'hex')
       OR NEW."decision_id" IS DISTINCT FROM
          'local-scoped-aflca-match-mapping:'||substring(NEW."subject_id" from 10)
       OR NEW."evidence_json"->>'schemaVersion'<>'local-scoped-aflca-reviewed-match/v1'
       OR NEW."evidence_json"->>'decision'<>'approved'
       OR NEW."evidence_json"->>'decidedBy'<>'statly-product-owner'
       OR NEW."evidence_json"->>'decidedAt' IS DISTINCT FROM
          to_char(NEW."decided_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       OR jsonb_typeof(NEW."evidence_json"->'source')<>'object'
       OR jsonb_typeof(NEW."evidence_json"->'target')<>'object'
       OR NEW."evidence_json"->'source'=NEW."evidence_json"->'target'
    THEN
      RAISE EXCEPTION 'Scoped AFLCA match mapping review is not authenticated';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."subject_type"='provider_match_candidate'
     AND NEW."decided_by"='local-scoped-aflca-evidence-reviewer'
  THEN
    mapping_decision_id:=NEW."evidence_json"->>'matchMappingReviewDecisionId';
    mapping_evidence_id:=NEW."evidence_json"->>'matchMappingEvidenceId';
    IF (mapping_decision_id IS NULL)<>(mapping_evidence_id IS NULL) THEN
      RAISE EXCEPTION 'Scoped AFLCA match mapping references must be paired';
    END IF;
    IF mapping_decision_id IS NOT NULL THEN
      SELECT decision_id,subject_id,decision,canonical_record_type,canonical_record_id,
             decided_by,evidence_json
        INTO mapping
        FROM "outcome_review_decision"
       WHERE "decision_id"=mapping_decision_id
         AND "subject_type"='local_scoped_aflca_match_mapping'
       FOR KEY SHARE;
      IF mapping."decision_id" IS NULL
         OR mapping."subject_id"<>mapping_evidence_id
         OR mapping."decision"<>'approved'
         OR mapping."canonical_record_type" IS NOT NULL
         OR mapping."canonical_record_id" IS NOT NULL
         OR mapping."decided_by"<>'statly-product-owner'
         OR mapping."evidence_json"->>'schemaVersion'<>
            'local-scoped-aflca-reviewed-match/v1'
      THEN
        RAISE EXCEPTION 'Scoped AFLCA match decision lacks its exact approved mapping';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "outcome_scoped_aflca_match_mapping_insert_guard"
BEFORE INSERT ON "outcome_review_decision"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_scoped_aflca_match_mapping"();

CREATE OR REPLACE FUNCTION "reject_outcome_scoped_aflca_match_mapping_mutation"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."subject_type"='local_scoped_aflca_match_mapping' THEN
    RAISE EXCEPTION 'Scoped AFLCA match mapping reviews are append-only';
  END IF;
  RETURN OLD;
END $$;

CREATE TRIGGER "outcome_scoped_aflca_match_mapping_mutation_guard"
BEFORE UPDATE OR DELETE ON "outcome_review_decision"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_scoped_aflca_match_mapping_mutation"();
