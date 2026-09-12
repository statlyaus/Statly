ALTER TABLE outcome_event_asset ADD COLUMN special_entitlement_id TEXT
  REFERENCES outcome_special_entitlement_award(entitlement_id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE outcome_event_asset ADD CONSTRAINT outcome_special_entitlement_asset_kind
  CHECK (special_entitlement_id IS NULL OR kind='list_right');
CREATE TABLE outcome_special_entitlement_custody (
  transfer_id TEXT PRIMARY KEY,
  entitlement_id TEXT NOT NULL REFERENCES outcome_special_entitlement_award(entitlement_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  asset_version_id TEXT NOT NULL UNIQUE REFERENCES outcome_event_asset(asset_version_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  predecessor_transfer_id TEXT UNIQUE REFERENCES outcome_special_entitlement_custody(transfer_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CHECK (predecessor_transfer_id IS NULL OR predecessor_transfer_id<>transfer_id)
);
CREATE UNIQUE INDEX outcome_special_entitlement_custody_one_root
  ON outcome_special_entitlement_custody(entitlement_id) WHERE predecessor_transfer_id IS NULL;

CREATE FUNCTION authenticate_outcome_special_custody_source(candidate_id TEXT, transfer_id TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE candidate RECORD; transfer JSONB; source RECORD; original JSONB; award RECORD;
BEGIN
  SELECT * INTO candidate FROM outcome_external_reconciliation_candidate c
    WHERE c.candidate_id=authenticate_outcome_special_custody_source.candidate_id FOR SHARE;
  SELECT transfer_json INTO transfer FROM outcome_external_reconciliation_transfer t
    WHERE t.candidate_id=authenticate_outcome_special_custody_source.candidate_id
      AND t.transfer_id=authenticate_outcome_special_custody_source.transfer_id FOR SHARE;
  IF candidate.candidate_id IS NULL OR transfer#>>'{asset,kind}' IS DISTINCT FROM 'special_entitlement'
    OR transfer->>'status' NOT IN ('single_source','corroborated')
  THEN RAISE EXCEPTION 'Special custody requires an exact resolved candidate transfer'; END IF;
  SELECT * INTO source FROM outcome_external_reconciliation_candidate c
    WHERE c.candidate_id=transfer#>>'{asset,sourceCandidateId}' FOR SHARE;
  SELECT transfer_json INTO original FROM outcome_external_reconciliation_transfer t
    WHERE t.candidate_id=source.candidate_id AND t.transfer_id=authenticate_outcome_special_custody_source.transfer_id FOR SHARE;
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
  SELECT * INTO award FROM outcome_special_entitlement_award a WHERE a.entitlement_id=transfer#>>'{asset,entitlementId}' FOR SHARE;
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

CREATE FUNCTION guard_outcome_special_entitlement_custody() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE award RECORD; asset RECORD; previous RECORD; promoted RECORD; transfer JSONB;
  event_year INTEGER; event_day DATE; earliest_possible DATE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('special-entitlement-custody:'||NEW.entitlement_id,0));
  SELECT * INTO award FROM outcome_special_entitlement_award WHERE entitlement_id=NEW.entitlement_id FOR SHARE;
  SELECT * INTO asset FROM outcome_event_asset WHERE asset_version_id=NEW.asset_version_id FOR SHARE;
  SELECT promotion.* INTO promoted FROM outcome_import_row source
    JOIN outcome_import_run run ON run.import_run_id=source.import_run_id
    JOIN outcome_external_canonical_promotion promotion ON promotion.promotion_id=run.idempotency_scope
    WHERE source.import_row_id=asset.source_import_row_id;
  SELECT transfer_json INTO transfer FROM outcome_external_reconciliation_transfer t
    WHERE t.candidate_id=promoted.candidate_id AND t.transfer_id=NEW.transfer_id;
  IF award.entitlement_id IS NULL OR asset.asset_version_id IS NULL OR promoted.status IS DISTINCT FROM 'open'
    OR asset.kind IS DISTINCT FROM 'list_right' OR asset.special_entitlement_id IS DISTINCT FROM NEW.entitlement_id
    OR asset.asset_key IS DISTINCT FROM NEW.transfer_id OR asset.status IS DISTINCT FROM 'approved'
    OR asset.from_club_id IS NULL OR asset.to_club_id IS NULL OR asset.from_club_id=asset.to_club_id
    OR NOT EXISTS (SELECT 1 FROM outcome_import_row WHERE import_row_id=asset.source_import_row_id
      AND raw_payload=transfer AND record_kind='external_transfer')
    OR transfer->>'fromClubId' IS DISTINCT FROM asset.from_club_id
    OR transfer->>'toClubId' IS DISTINCT FROM asset.to_club_id
    OR transfer#>>'{asset,entitlementId}' IS DISTINCT FROM NEW.entitlement_id
    OR transfer#>>'{asset,predecessorTransferId}' IS DISTINCT FROM NEW.predecessor_transfer_id
  THEN RAISE EXCEPTION 'Special custody must bind an exact open promoted asset'; END IF;
  PERFORM authenticate_outcome_special_custody_source(promoted.candidate_id,NEW.transfer_id);
  SELECT event.season_year,version.event_date INTO event_year,event_day
    FROM outcome_event_version version JOIN outcome_event event USING(event_id)
    WHERE version.event_version_id=asset.event_version_id AND version.event_id=transfer->>'transactionId' AND version.kind='trade';
  IF event_year IS NULL THEN RAISE EXCEPTION 'Special custody requires its exact promoted trade'; END IF;
  IF NEW.predecessor_transfer_id IS NULL THEN
    IF asset.from_club_id IS DISTINCT FROM award.holder_club_id THEN RAISE EXCEPTION 'Special custody must start with the awarded holder'; END IF;
  ELSE
    SELECT chain.entitlement_id,prior.to_club_id INTO previous FROM outcome_special_entitlement_custody chain
      JOIN outcome_event_asset prior ON prior.asset_version_id=chain.asset_version_id
      WHERE chain.transfer_id=NEW.predecessor_transfer_id;
    IF NOT FOUND OR previous.entitlement_id IS DISTINCT FROM NEW.entitlement_id OR previous.to_club_id IS DISTINCT FROM asset.from_club_id
    THEN RAISE EXCEPTION 'Special custody predecessor or holder is inconsistent'; END IF;
  END IF;
  IF EXISTS (
    WITH RECURSIVE ancestors AS (
      SELECT * FROM outcome_special_entitlement_custody WHERE transfer_id=NEW.predecessor_transfer_id
      UNION ALL SELECT parent.* FROM outcome_special_entitlement_custody parent JOIN ancestors child ON parent.transfer_id=child.predecessor_transfer_id
    ) SELECT 1 FROM ancestors JOIN outcome_event_asset prior USING(asset_version_id)
      JOIN outcome_import_row source ON source.import_row_id=prior.source_import_row_id
      JOIN outcome_import_run run USING(import_run_id)
      JOIN outcome_external_canonical_promotion promotion ON promotion.promotion_id=run.idempotency_scope
      JOIN outcome_review_decision review ON review.decision_id=promotion.approval_decision_id
      WHERE review.decision IS DISTINCT FROM 'approved'
        OR EXISTS (SELECT 1 FROM outcome_review_decision successor WHERE successor.supersedes_decision_id=review.decision_id)
        OR (promotion.promotion_id<>promoted.promotion_id AND promotion.status IS DISTINCT FROM 'finalized')
        OR NOT outcome_external_candidate_retained_sources_current(promotion.candidate_id,clock_timestamp())
  ) THEN RAISE EXCEPTION 'Special custody predecessor authority is no longer current'; END IF;
  -- Bounds are used only for feasibility; event_date remains null for year-only facts.
  WITH RECURSIVE ancestors AS (
    SELECT * FROM outcome_special_entitlement_custody WHERE transfer_id=NEW.predecessor_transfer_id
    UNION ALL SELECT parent.* FROM outcome_special_entitlement_custody parent JOIN ancestors child ON parent.transfer_id=child.predecessor_transfer_id
  ) SELECT greatest(COALESCE((award.award_json#>>'{content,awardedOn}')::DATE,make_date(award.award_year,1,1)),
      COALESCE(event_day,make_date(event_year,1,1)),
      MAX(COALESCE(version.event_date,make_date(event.season_year,1,1)))) INTO earliest_possible
    FROM ancestors JOIN outcome_event_asset prior ON prior.asset_version_id=ancestors.asset_version_id
    JOIN outcome_event_version version ON version.event_version_id=prior.event_version_id
    JOIN outcome_event event USING(event_id);
  IF earliest_possible>COALESCE(event_day,make_date(event_year,12,31)) THEN RAISE EXCEPTION 'Special custody chronology is impossible'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER outcome_special_entitlement_custody_insert BEFORE INSERT ON outcome_special_entitlement_custody
  FOR EACH ROW EXECUTE FUNCTION guard_outcome_special_entitlement_custody();
CREATE TRIGGER outcome_special_entitlement_custody_immutable BEFORE UPDATE OR DELETE ON outcome_special_entitlement_custody
  FOR EACH ROW EXECUTE FUNCTION reject_outcome_external_canonical_mutation();
CREATE FUNCTION require_outcome_special_asset_custody() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.special_entitlement_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM outcome_special_entitlement_custody
   WHERE asset_version_id=NEW.asset_version_id AND entitlement_id=NEW.special_entitlement_id)
 THEN RAISE EXCEPTION 'Special asset requires persisted custody in the same transaction'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER outcome_special_asset_custody_required AFTER INSERT ON outcome_event_asset
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_outcome_special_asset_custody();

-- Factual admission of a right does not establish a historical pricing input.
DO $migration$
DECLARE original TEXT; old_fragment CONSTANT TEXT := 'OR version.event_date IS NULL';
BEGIN
 SELECT pg_get_functiondef('authenticate_outcome_private_valuation_cohort_input(text,text)'::regprocedure) INTO original;
 IF (length(original)-length(replace(original,old_fragment,'')))/length(old_fragment)<>1
 THEN RAISE EXCEPTION 'Expected exact valuation date guard before special-right exclusion'; END IF;
 EXECUTE replace(original,old_fragment,$new$OR version.event_date IS NULL
      OR EXISTS (SELECT 1 FROM outcome_event_asset special_asset WHERE special_asset.event_version_id=version.event_version_id
        AND special_asset.special_entitlement_id IS NOT NULL)$new$);
END $migration$;

GRANT SELECT (event_version_id,special_entitlement_id) ON outcome_event_asset TO afl_trade_private_valuation_scheduler_owner;
