-- Keep the general historical identity-review path unchanged while admitting one exact,
-- user-authorized local non-production identity record for the genuine issue-574 run.
CREATE OR REPLACE FUNCTION "require_outcome_external_identity_typed_decision"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE typed_count INTEGER; head_count INTEGER;
BEGIN
  IF NEW.subject_type <> 'external_provider_identity' THEN RETURN NEW; END IF;
  IF NEW.evidence_json->>'boundary' = 'local-genuine-player-cross-source-identity/v2' THEN
    IF NEW.decision <> 'approved' OR
       NEW.decided_by <> 'statly-product-owner' OR
       NEW.evidence_json->>'environment' <> 'non_production' OR
       NEW.evidence_json->>'provider' <> 'draftguru' OR
       NEW.canonical_record_type IS DISTINCT FROM NEW.evidence_json->>'entityKind' OR
       NEW.canonical_record_id IS DISTINCT FROM NEW.evidence_json->>'canonicalId' OR
       NEW.evidence_json#>>'{sourceIdentity,recordedName}' IS NULL OR
       (CASE NEW.evidence_json->>'entityKind'
         WHEN 'club' THEN
           (NEW.evidence_json#>>'{sourceIdentity,nativeId}' IS NOT NULL)
         WHEN 'player' THEN
           (NEW.evidence_json#>>'{sourceIdentity,nativeId}' IS NULL OR
           NEW.evidence_json#>>'{corroboration,provider}' <> 'afl_tables' OR
           NEW.evidence_json#>>'{corroboration,nativeId}' IS NULL OR
           NEW.evidence_json#>>'{corroboration,displayName}' IS DISTINCT FROM
             NEW.evidence_json#>>'{sourceIdentity,recordedName}' OR
           NEW.evidence_json#>>'{corroboration,receivingClub}' IS NULL OR
           NEW.evidence_json#>>'{corroboration,receivingSeason}' IS NULL)
         ELSE TRUE
       END) THEN
      RAISE EXCEPTION 'Local genuine external identity evidence is outside its exact authority';
    END IF;
    RETURN NEW;
  END IF;
  SELECT count(*) INTO typed_count FROM outcome_external_identity_review_decision typed
   WHERE typed.decision_id=NEW.decision_id AND typed.subject_id=NEW.subject_id AND typed.decision_json=NEW.evidence_json;
  SELECT count(*) INTO head_count FROM outcome_external_identity_resolution_head head
   WHERE head.subject_id=NEW.subject_id AND head.decision_id=NEW.decision_id;
  IF typed_count<>1 OR head_count<>1 THEN
    RAISE EXCEPTION 'Each external identity review requires one exact typed decision and current head by commit';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION "validate_outcome_local_genuine_external_identity_resolution"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE decision outcome_review_decision%ROWTYPE; candidate_environment "OutcomeEnvironment";
BEGIN
  SELECT * INTO decision FROM outcome_review_decision
   WHERE decision_id=NEW.review_decision_id;
  IF decision.evidence_json->>'boundary' <> 'local-genuine-player-cross-source-identity/v2' THEN
    RETURN NEW;
  END IF;
  SELECT environment INTO candidate_environment
    FROM outcome_external_reconciliation_candidate WHERE candidate_id=NEW.candidate_id;
  IF candidate_environment <> 'non_production' OR
     NEW.provider <> 'draftguru' OR
     NEW.entity_kind IS DISTINCT FROM decision.evidence_json->>'entityKind' OR
     NEW.canonical_id IS DISTINCT FROM decision.evidence_json->>'canonicalId' OR
     NEW.resolution_json->'content'->'sourceIdentity' IS DISTINCT FROM
       decision.evidence_json->'sourceIdentity' THEN
    RAISE EXCEPTION 'Local genuine identity resolution does not match its exact reviewed evidence';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "outcome_local_genuine_external_identity_resolution_guard"
BEFORE INSERT ON "outcome_external_reconciliation_identity_resolution"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_local_genuine_external_identity_resolution"();
