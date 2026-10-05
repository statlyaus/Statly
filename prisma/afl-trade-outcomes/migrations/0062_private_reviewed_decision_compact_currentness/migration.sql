CREATE OR REPLACE FUNCTION "validate_outcome_private_reviewed_evaluation_decision_insert"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  content JSONB;
  bundle RECORD;
  bundle_canonical TEXT;
  bundle_sha TEXT;
  predecessor RECORD;
BEGIN
  content:=NEW."decision_json"->'content';
  SELECT * INTO bundle FROM outcome_private_reviewed_evidence_bundle
   WHERE evidence_bundle_id=NEW.evidence_bundle_id FOR KEY SHARE;
  bundle_canonical:="outcome_afl_trade_canonical_json"(bundle.bundle_json);
  bundle_sha:=encode(sha256(convert_to(bundle_canonical,'UTF8')),'hex');
  IF NOT FOUND
     OR NOT outcome_private_reviewed_evidence_bundle_is_current(NEW.evidence_bundle_id)
     OR NEW."decision_json"->>'decisionId' IS DISTINCT FROM NEW."decision_id"
     OR content->>'schemaVersion'<>
       'afl-trade-private-reviewed-evidence-evaluation-decision/v1'
     OR content->>'authorityBoundary'<>
       'exact_current_private_review_sets_and_retained_source_artifacts_for_internal_nonproduction_calculation_only'
     OR content->>'environment'<>'non_production'
     OR content->>'operation'<>'private_nonproduction_derived_calculation'
     OR content->>'evidenceKind'<>'retained_private_review'
     OR content->>'status' IS DISTINCT FROM NEW."status"
     OR content->>'valuationScopeKey' IS DISTINCT FROM NEW."valuation_scope_key"
     OR content->>'evidenceBundleId' IS DISTINCT FROM NEW."evidence_bundle_id"
     OR content->>'sourceRightsEffect'<>
       'supplemental_evaluation_authority_does_not_amend_source_rights'
     OR content->'permissions' IS DISTINCT FROM jsonb_build_object(
       'derivedCalculations',true,'internalEvaluation',true,'modelTraining',false,
       'publicDisplay',false,'redistribution',false,'productionActivation',false,
       'liveCapture',false
     )
     OR content->'publicationEligible'<>'false'::jsonb
     OR content->'publicationProhibited'<>'true'::jsonb
     OR content->>'limitation'<>
       'This decision authorizes only private local non-production derived calculations from the exact retained reviewed evidence bundle for internal evaluation. It grants no model-training, public-display, redistribution, production-activation, live-capture, factual-release, or publication authority.'
     OR (content->>'revision')::integer<>NEW."revision"
     OR content->>'supersedesDecisionId' IS DISTINCT FROM NEW."supersedes_decision_id"
     OR content->>'reviewerId' IS DISTINCT FROM NEW."reviewer_id"
     OR length(btrim(content->>'rationale')) NOT BETWEEN 1 AND 2000
     OR (content->>'decidedAt')::timestamptz<>NEW."decided_at"
     OR NEW."decided_at"<>NEW."registered_at"
     OR NEW."decision_content_canonical_json"::jsonb IS DISTINCT FROM content
     OR encode(sha256(convert_to(NEW."decision_content_canonical_json",'UTF8')),'hex')<>
       NEW."decision_sha256"
     OR content->'evidenceBundleArtifact'->>'artifactId' IS DISTINCT FROM 'artifact:'||bundle_sha
     OR content->'evidenceBundleArtifact'->>'contentSha256' IS DISTINCT FROM bundle_sha
     OR content->'evidenceBundleArtifact'->>'storageUri' IS DISTINCT FROM
       'artifact://sha256/'||bundle_sha
     OR content->'evidenceBundleArtifact'->>'mediaType'<>'application/json'
     OR (content->'evidenceBundleArtifact'->>'byteLength')::integer<>
       octet_length(convert_to(bundle_canonical,'UTF8'))
     OR (content->'evidenceBundleArtifact'->>'createdAt')::timestamptz<>bundle.created_at
  THEN
    RAISE EXCEPTION 'Private reviewed-evidence evaluation decision failed exact authentication';
  END IF;
  IF NEW.supersedes_decision_id IS NOT NULL THEN
    SELECT * INTO predecessor FROM outcome_private_reviewed_evaluation_decision
     WHERE decision_id=NEW.supersedes_decision_id FOR KEY SHARE;
    IF NOT FOUND OR predecessor.valuation_scope_key<>NEW.valuation_scope_key
       OR predecessor.evidence_bundle_id<>NEW.evidence_bundle_id
       OR predecessor.revision<>NEW.revision-1 OR predecessor.decided_at>NEW.decided_at
    THEN
      RAISE EXCEPTION 'Private reviewed-evidence decision has invalid chronology';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
