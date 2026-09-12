-- Corrected canonical assets require their authenticated complete revision in the same transaction.
CREATE FUNCTION authenticate_outcome_special_corrected_custody_source(candidate_id TEXT, transfer_id TEXT, corrected_award JSONB, corrected_approval_id TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE candidate RECORD; transfer JSONB; source RECORD; original JSONB; award RECORD;
BEGIN
  SELECT * INTO candidate FROM outcome_external_reconciliation_candidate c
    WHERE c.candidate_id=authenticate_outcome_special_corrected_custody_source.candidate_id FOR SHARE;
  SELECT transfer_json INTO transfer FROM outcome_external_reconciliation_transfer t
    WHERE t.candidate_id=authenticate_outcome_special_corrected_custody_source.candidate_id
      AND t.transfer_id=authenticate_outcome_special_corrected_custody_source.transfer_id FOR SHARE;
  IF candidate.candidate_id IS NULL OR transfer#>>'{asset,kind}' IS DISTINCT FROM 'special_entitlement'
    OR transfer->>'status' NOT IN ('single_source','corroborated')
  THEN RAISE EXCEPTION 'Special custody requires an exact resolved candidate transfer'; END IF;
  SELECT * INTO source FROM outcome_external_reconciliation_candidate c
    WHERE c.candidate_id=transfer#>>'{asset,sourceCandidateId}' FOR SHARE;
  SELECT transfer_json INTO original FROM outcome_external_reconciliation_transfer t
    WHERE t.candidate_id=source.candidate_id AND t.transfer_id=authenticate_outcome_special_corrected_custody_source.transfer_id FOR SHARE;
  IF source.candidate_id IS NULL OR source.status IS DISTINCT FROM 'finalized'
    OR source.environment IS DISTINCT FROM candidate.environment OR source.competition IS DISTINCT FROM candidate.competition
    OR original IS NULL OR original->>'status'='disputed'
    OR COALESCE(original#>>'{asset,kind}' NOT IN ('special_pick','pick_entitlement'),TRUE)
    OR original->'asset' IS DISTINCT FROM transfer#>'{asset,sourceAsset}'
    OR original->>'transactionId' IS DISTINCT FROM transfer->>'transactionId'
    OR original->>'fromClubId' IS DISTINCT FROM transfer->>'fromClubId'
    OR original->>'toClubId' IS DISTINCT FROM transfer->>'toClubId'
    OR original->'evidenceIds' IS DISTINCT FROM transfer->'evidenceIds'
    OR source.candidate_json#>'{content,sourceBatchIds}' IS DISTINCT FROM candidate.candidate_json#>'{content,sourceBatchIds}'
    OR NOT outcome_external_candidate_retained_sources_current(source.candidate_id,clock_timestamp())
  THEN RAISE EXCEPTION 'Special custody differs from its retained source candidate'; END IF;
  SELECT corrected_award AS award_json,corrected_approval_id AS approval_decision_id,
    (corrected_award#>>'{content,environment}')::"OutcomeEnvironment" AS environment,
    corrected_award#>>'{content,competition}' AS competition INTO award;
  IF corrected_award->>'entitlementId' IS DISTINCT FROM transfer#>>'{asset,entitlementId}'
  THEN RAISE EXCEPTION 'Corrected source belongs to another right'; END IF;
  IF NOT FOUND OR award.environment IS DISTINCT FROM candidate.environment OR award.competition IS DISTINCT FROM candidate.competition
    OR award.approval_decision_id IS DISTINCT FROM transfer#>>'{asset,awardApprovalDecisionId}'
    OR (original#>>'{asset,kind}'='special_pick' AND original->'asset' IS DISTINCT FROM award.award_json#>'{content,asset}')
  THEN RAISE EXCEPTION 'Special custody requires its exact retained issuing award'; END IF;
  PERFORM authenticate_outcome_special_entitlement_award(award.award_json,award.approval_decision_id);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(award.award_json#>'{content,evidence}') reference
    WHERE NOT EXISTS (SELECT 1 FROM outcome_external_reconciliation_source_batch source_batch
      JOIN outcome_external_evidence_batch batch USING(batch_id)
      WHERE source_batch.candidate_id=candidate.candidate_id AND batch.capture_id=reference->>'captureId'))
  THEN RAISE EXCEPTION 'Award provenance must belong to the exact promotion source set'; END IF;
END $$;

CREATE OR REPLACE FUNCTION require_outcome_special_asset_custody() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.special_entitlement_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM outcome_special_entitlement_custody WHERE asset_version_id=NEW.asset_version_id AND entitlement_id=NEW.special_entitlement_id)
   AND NOT EXISTS (SELECT 1 FROM outcome_special_entitlement_revision revision
     WHERE revision.entitlement_id=NEW.special_entitlement_id AND revision.revision>1
       AND NOT EXISTS (SELECT 1 FROM outcome_special_entitlement_revision successor WHERE successor.supersedes_revision_id=revision.revision_id)
       AND revision.revision_json#>'{content,state,custody}' @> jsonb_build_array(jsonb_build_object('assetVersionId',NEW.asset_version_id,'transferId',NEW.asset_key)))
 THEN RAISE EXCEPTION 'Special asset requires custody or an authenticated current revision in the same transaction'; END IF;
 RETURN NEW;
END $$;
