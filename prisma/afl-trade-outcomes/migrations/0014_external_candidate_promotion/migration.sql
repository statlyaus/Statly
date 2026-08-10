ALTER TABLE "outcome_operational_principal_authority"
  DROP CONSTRAINT "outcome_operational_authority_shape_check",
  ADD CONSTRAINT "outcome_operational_authority_shape_check" CHECK (
    "authority_evidence_id" ~ '^reviewer-authority-evidence:[a-f0-9]{64}$'
    AND "role" IN ('afl_trade_identity_reviewer', 'afl_trade_canonical_promoter')
    AND "scope_key" = 'public-afl-draft-trade-outcomes'
    AND "competition" IN ('AFLM','AFLW')
    AND "valid_from_season" BETWEEN 1897 AND 2200
    AND "valid_through_season" BETWEEN "valid_from_season" AND 2200
    AND ("valid_through" IS NULL OR "valid_through" >= "valid_from")
  );

ALTER TABLE "outcome_event_asset"
  ADD COLUMN "external_identity_decision_id" TEXT;
ALTER TABLE "outcome_draft_selection"
  ALTER COLUMN "player_identity_id" DROP NOT NULL,
  ADD COLUMN "external_identity_decision_id" TEXT;

ALTER TABLE "outcome_event_asset"
  DROP CONSTRAINT "outcome_event_asset_typed_payload_check",
  ADD CONSTRAINT "outcome_event_asset_typed_payload_check" CHECK (
    ("kind" = 'player' AND num_nonnulls("player_identity_id", "external_identity_decision_id") = 1
      AND "pick_id" IS NULL
      AND ("status" <> 'approved'::"OutcomeRecordStatus" OR "player_id" IS NOT NULL))
    OR ("kind" IN ('current_pick', 'future_pick') AND "pick_id" IS NOT NULL
      AND "player_id" IS NULL AND "player_identity_id" IS NULL
      AND "external_identity_decision_id" IS NULL)
    OR ("kind" IN ('cash', 'list_right', 'other') AND "player_id" IS NULL
      AND "player_identity_id" IS NULL AND "external_identity_decision_id" IS NULL
      AND "pick_id" IS NULL)
  );
ALTER TABLE "outcome_draft_selection"
  ADD CONSTRAINT "outcome_draft_selection_identity_authority_check"
  CHECK (num_nonnulls("player_identity_id", "external_identity_decision_id") = 1);
ALTER TABLE "outcome_event_asset"
  ADD CONSTRAINT "outcome_event_asset_external_identity_decision_fkey"
  FOREIGN KEY ("external_identity_decision_id") REFERENCES "outcome_review_decision"("decision_id") ON DELETE RESTRICT;
ALTER TABLE "outcome_draft_selection"
  ADD CONSTRAINT "outcome_draft_selection_external_identity_decision_fkey"
  FOREIGN KEY ("external_identity_decision_id") REFERENCES "outcome_review_decision"("decision_id") ON DELETE RESTRICT;

CREATE TABLE "outcome_external_canonical_promotion" (
  "promotion_id" TEXT PRIMARY KEY,
  "candidate_id" TEXT NOT NULL UNIQUE,
  "proposal_id" TEXT NOT NULL UNIQUE,
  "approval_decision_id" TEXT NOT NULL UNIQUE,
  "import_run_count" INTEGER NOT NULL CHECK ("import_run_count" > 0),
  "environment" "OutcomeEnvironment" NOT NULL,
  "competition" TEXT NOT NULL,
  "anchor_season_year" INTEGER NOT NULL CHECK ("anchor_season_year" BETWEEN 1897 AND 2200),
  "transaction_count" INTEGER NOT NULL CHECK ("transaction_count" >= 0),
  "transfer_count" INTEGER NOT NULL CHECK ("transfer_count" >= 0),
  "draft_selection_count" INTEGER NOT NULL CHECK ("draft_selection_count" >= 0),
  "draft_player_asset_count" INTEGER NOT NULL CHECK ("draft_player_asset_count" >= 0),
  "pick_custody_count" INTEGER NOT NULL CHECK ("pick_custody_count" >= 0),
  "pick_realization_count" INTEGER NOT NULL CHECK ("pick_realization_count" >= 0),
  "promotion_record_count" INTEGER NOT NULL CHECK ("promotion_record_count" > 0),
  "promoted_at" TIMESTAMPTZ(3) NOT NULL,
  "status" TEXT NOT NULL CHECK ("status" IN ('open', 'finalized')),
  "finalized_at" TIMESTAMPTZ(3),
  "proposal_sha256" CHAR(64) NOT NULL,
  "proposal_canonical_json" TEXT NOT NULL,
  "proposal_json" JSONB NOT NULL,
  "receipt_sha256" CHAR(64) NOT NULL,
  "receipt_canonical_json" TEXT NOT NULL,
  "receipt_json" JSONB NOT NULL,
  CONSTRAINT "outcome_external_canonical_promotion_id_check" CHECK (
    "promotion_id" ~ '^external-canonical-promotion:[a-f0-9]{64}$'
    AND substring("promotion_id" from ':(.*)$') = "receipt_sha256"
    AND "proposal_id" ~ '^external-canonical-promotion-proposal:[a-f0-9]{64}$'
    AND substring("proposal_id" from ':(.*)$') = "proposal_sha256"
    AND "approval_decision_id" ~ '^review-decision:[a-f0-9]{64}$'
  ),
  CONSTRAINT "outcome_external_canonical_promotion_json_check" CHECK (
    encode(sha256(convert_to("proposal_canonical_json", 'UTF8')), 'hex') = "proposal_sha256"
    AND "proposal_canonical_json"::jsonb = "proposal_json"
    AND encode(sha256(convert_to("receipt_canonical_json", 'UTF8')), 'hex') = "receipt_sha256"
    AND "receipt_canonical_json"::jsonb = "receipt_json"
    AND "proposal_json"->>'proposalId' = "proposal_id"
    AND "receipt_json"->>'promotionId' = "promotion_id"
    AND "receipt_json"->'content'->>'candidateId' = "candidate_id"
    AND "receipt_json"->'content'->>'proposalId' = "proposal_id"
    AND "receipt_json"->'content'->>'approvalDecisionId' = "approval_decision_id"
    AND "proposal_json"->'content'->>'publicationEligible' = 'false'
  ),
  CONSTRAINT "outcome_external_canonical_promotion_state_check" CHECK (
    ("status" = 'open' AND "finalized_at" IS NULL)
    OR ("status" = 'finalized' AND "finalized_at" IS NOT NULL)
  ),
  CONSTRAINT "outcome_external_canonical_promotion_candidate_fkey"
    FOREIGN KEY ("candidate_id") REFERENCES "outcome_external_reconciliation_candidate"("candidate_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_external_canonical_promotion_decision_fkey"
    FOREIGN KEY ("approval_decision_id") REFERENCES "outcome_review_decision"("decision_id") ON DELETE RESTRICT
);
CREATE INDEX "outcome_external_canonical_promotion_scope_idx"
  ON "outcome_external_canonical_promotion"("environment", "competition", "anchor_season_year", "status");

CREATE TABLE "outcome_external_canonical_promotion_import_run" (
  "promotion_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL CHECK ("ordinal" > 0),
  "import_run_id" TEXT NOT NULL UNIQUE,
  "capture_id" TEXT NOT NULL,
  PRIMARY KEY ("promotion_id", "import_run_id"),
  CONSTRAINT "outcome_external_canonical_promotion_run_ordinal_key" UNIQUE ("promotion_id", "ordinal"),
  CONSTRAINT "outcome_external_canonical_promotion_run_parent_fkey"
    FOREIGN KEY ("promotion_id") REFERENCES "outcome_external_canonical_promotion"("promotion_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_external_canonical_promotion_run_import_fkey"
    FOREIGN KEY ("import_run_id") REFERENCES "outcome_import_run"("import_run_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_external_canonical_promotion_run_capture_fkey"
    FOREIGN KEY ("capture_id") REFERENCES "outcome_source_capture"("capture_id") ON DELETE RESTRICT
);
CREATE INDEX "outcome_external_canonical_promotion_run_capture_idx"
  ON "outcome_external_canonical_promotion_import_run"("capture_id", "promotion_id");

CREATE TABLE "outcome_external_canonical_promotion_record" (
  "promotion_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL CHECK ("ordinal" > 0),
  "record_kind" TEXT NOT NULL CHECK ("record_kind" IN (
    'transaction','transfer','draft_event','draft_selection','draft_player_asset','pick_custody','pick_realization'
  )),
  "source_record_id" TEXT NOT NULL,
  "canonical_record_id" TEXT NOT NULL,
  "source_import_row_id" TEXT NOT NULL,
  "record_sha256" CHAR(64) NOT NULL CHECK ("record_sha256" ~ '^[a-f0-9]{64}$'),
  "record_canonical_json" TEXT NOT NULL,
  "evidence_ids" JSONB NOT NULL CHECK (jsonb_typeof("evidence_ids") = 'array'),
  "record_json" JSONB NOT NULL,
  PRIMARY KEY ("promotion_id", "record_kind", "source_record_id"),
  CONSTRAINT "outcome_external_canonical_promotion_record_ordinal_key" UNIQUE ("promotion_id", "ordinal"),
  CONSTRAINT "outcome_external_canonical_promotion_record_json_check" CHECK (
    encode(sha256(convert_to("record_canonical_json", 'UTF8')), 'hex') = "record_sha256"
    AND "record_canonical_json"::jsonb = "record_json"
  ),
  CONSTRAINT "outcome_external_canonical_promotion_record_parent_fkey"
    FOREIGN KEY ("promotion_id") REFERENCES "outcome_external_canonical_promotion"("promotion_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_external_canonical_promotion_record_import_row_fkey"
    FOREIGN KEY ("source_import_row_id") REFERENCES "outcome_import_row"("import_row_id") ON DELETE RESTRICT
);
CREATE INDEX "outcome_external_canonical_promotion_record_canonical_idx"
  ON "outcome_external_canonical_promotion_record"("record_kind", "canonical_record_id");

CREATE TABLE "outcome_pick_custody_observation" (
  "custody_observation_id" TEXT PRIMARY KEY,
  "pick_id" TEXT NOT NULL,
  "observed_at" TIMESTAMPTZ(3) NOT NULL,
  "draft_season_year" INTEGER NOT NULL CHECK ("draft_season_year" BETWEEN 1897 AND 2200),
  "draft_kind" "OutcomeEventKind" NOT NULL CHECK ("draft_kind" IN (
    'national_draft','preseason_draft','rookie_draft','midseason_draft','supplemental_selection'
  )),
  "recorded_round" INTEGER CHECK ("recorded_round" IS NULL OR "recorded_round" > 0),
  "recorded_pick" INTEGER CHECK ("recorded_pick" IS NULL OR "recorded_pick" > 0),
  "original_club_id" TEXT NOT NULL,
  "current_club_id" TEXT NOT NULL,
  "source_import_row_id" TEXT NOT NULL,
  "status" "OutcomeRecordStatus" NOT NULL,
  "evidence_json" JSONB NOT NULL CHECK (jsonb_typeof("evidence_json") = 'object'),
  "recorded_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "outcome_pick_custody_observation_id_check"
    CHECK ("custody_observation_id" ~ '^external-pick-custody:[a-f0-9]{64}$'),
  CONSTRAINT "outcome_pick_custody_observation_key" UNIQUE ("pick_id", "observed_at", "current_club_id"),
  CONSTRAINT "outcome_pick_custody_pick_fkey" FOREIGN KEY ("pick_id") REFERENCES "outcome_draft_pick"("pick_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_pick_custody_original_club_fkey" FOREIGN KEY ("original_club_id") REFERENCES "outcome_club"("club_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_pick_custody_current_club_fkey" FOREIGN KEY ("current_club_id") REFERENCES "outcome_club"("club_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_pick_custody_source_row_fkey" FOREIGN KEY ("source_import_row_id") REFERENCES "outcome_import_row"("import_row_id") ON DELETE RESTRICT
);
CREATE INDEX "outcome_pick_custody_current_club_idx"
  ON "outcome_pick_custody_observation"("current_club_id", "observed_at");

CREATE TABLE "outcome_pick_realization" (
  "realization_id" TEXT PRIMARY KEY,
  "pick_id" TEXT NOT NULL,
  "transfer_asset_version_id" TEXT NOT NULL,
  "draft_selection_id" TEXT NOT NULL,
  "source_import_row_id" TEXT NOT NULL,
  "relation_kind" TEXT NOT NULL CHECK ("relation_kind" = 'exercised_as'),
  "status" "OutcomeRecordStatus" NOT NULL,
  "evidence_json" JSONB NOT NULL CHECK (jsonb_typeof("evidence_json") = 'object'),
  "recorded_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "outcome_pick_realization_id_check"
    CHECK ("realization_id" ~ '^pick-realization:[a-f0-9]{64}$'),
  CONSTRAINT "outcome_pick_realization_transfer_selection_key"
    UNIQUE ("transfer_asset_version_id", "draft_selection_id"),
  CONSTRAINT "outcome_pick_realization_pick_fkey" FOREIGN KEY ("pick_id") REFERENCES "outcome_draft_pick"("pick_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_pick_realization_transfer_fkey" FOREIGN KEY ("transfer_asset_version_id") REFERENCES "outcome_event_asset"("asset_version_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_pick_realization_selection_fkey" FOREIGN KEY ("draft_selection_id") REFERENCES "outcome_draft_selection"("selection_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_pick_realization_source_row_fkey" FOREIGN KEY ("source_import_row_id") REFERENCES "outcome_import_row"("import_row_id") ON DELETE RESTRICT
);
CREATE INDEX "outcome_pick_realization_pick_idx"
  ON "outcome_pick_realization"("pick_id", "recorded_at");

CREATE FUNCTION "validate_outcome_external_canonical_identity_decision"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE decision_row RECORD;
BEGIN
  IF NEW.external_identity_decision_id IS NULL THEN RETURN NEW; END IF;
  SELECT decision.* INTO decision_row
    FROM outcome_review_decision decision
   WHERE decision.decision_id=NEW.external_identity_decision_id;
  IF NOT FOUND OR decision_row.subject_type <> 'external_provider_identity'
     OR decision_row.decision <> 'approved'
     OR decision_row.canonical_record_type <> 'player'
     OR decision_row.canonical_record_id IS DISTINCT FROM NEW.player_id
     OR EXISTS (SELECT 1 FROM outcome_review_decision successor
                 WHERE successor.supersedes_decision_id=decision_row.decision_id) THEN
    RAISE EXCEPTION 'External player identity provenance requires its exact current approved decision';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "outcome_event_asset_external_identity_guard"
BEFORE INSERT ON "outcome_event_asset"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_external_canonical_identity_decision"();
CREATE TRIGGER "outcome_draft_selection_external_identity_guard"
BEFORE INSERT ON "outcome_draft_selection"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_external_canonical_identity_decision"();

CREATE FUNCTION "validate_outcome_external_canonical_promotion_insert"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE candidate_row RECORD; decision_row RECORD; authority_count INTEGER;
DECLARE invalid_record_count INTEGER; invalid_identity_count INTEGER; coverage_gap_count INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('outcome-external-canonical-promotion:' || NEW.candidate_id, 0));
  IF NEW.status <> 'open' OR NEW.finalized_at IS NOT NULL THEN
    RAISE EXCEPTION 'External canonical promotions must be inserted open';
  END IF;
  SELECT candidate.* INTO candidate_row
    FROM outcome_external_reconciliation_candidate candidate
   WHERE candidate.candidate_id=NEW.candidate_id FOR SHARE;
  IF NOT FOUND OR candidate_row.status <> 'finalized' OR candidate_row.finalized_at IS NULL
     OR candidate_row.issue_count <> 0 OR candidate_row.environment <> NEW.environment
     OR candidate_row.competition <> NEW.competition
     OR candidate_row.anchor_season_year <> NEW.anchor_season_year
     OR candidate_row.finalized_at > NEW.promoted_at THEN
    RAISE EXCEPTION 'Promotion requires one exact finalized issue-free candidate in scope';
  END IF;
  SELECT decision.* INTO decision_row FROM outcome_review_decision decision
   WHERE decision.decision_id=NEW.approval_decision_id;
  IF NOT FOUND OR decision_row.subject_type <> 'external_reconciliation_candidate'
     OR decision_row.subject_id <> NEW.candidate_id OR decision_row.decision <> 'approved'
     OR decision_row.decided_at IS DISTINCT FROM NEW.promoted_at
     OR decision_row.decided_at < (NEW.proposal_json->'content'->>'proposedAt')::timestamptz
     OR decision_row.decided_at > clock_timestamp()
     OR EXISTS (SELECT 1 FROM outcome_review_decision successor
                 WHERE successor.supersedes_decision_id=decision_row.decision_id)
     OR decision_row.evidence_json->>'schemaVersion' <> 'afl-trade-external-canonical-promotion-approval/v1'
     OR decision_row.evidence_json->>'proposalId' <> NEW.proposal_id
     OR decision_row.evidence_json->>'proposalSha256' <> NEW.proposal_sha256
     OR decision_row.evidence_json->'proposal' IS DISTINCT FROM NEW.proposal_json THEN
    RAISE EXCEPTION 'Promotion requires its exact current reviewed approval decision';
  END IF;
  SELECT count(*) INTO authority_count
    FROM outcome_operational_principal_authority authority
    JOIN outcome_governed_evidence_reference evidence
      ON evidence.reference_id=authority.authority_evidence_id
    JOIN outcome_review_decision evidence_approval
      ON evidence_approval.decision_id=evidence.approval_decision_id
   WHERE authority.authority_evidence_id=decision_row.evidence_json->>'authorityEvidenceId'
     AND authority.principal_ref=decision_row.decided_by
     AND authority.role='afl_trade_canonical_promoter'
     AND authority.scope_key='public-afl-draft-trade-outcomes'
     AND authority.provider='multi_source'
     AND authority.capability_id='external_candidate_promotion'
     AND authority.competition=NEW.competition
     AND NEW.anchor_season_year BETWEEN authority.valid_from_season AND authority.valid_through_season
     AND authority.valid_from <= clock_timestamp()
     AND (authority.valid_through IS NULL OR authority.valid_through > clock_timestamp())
     AND evidence.environment=NEW.environment AND evidence.status='approved'
     AND evidence_approval.decision='approved'
     AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor
                       WHERE successor.supersedes_decision_id=evidence_approval.decision_id);
  IF authority_count <> 1 THEN
    RAISE EXCEPTION 'Promotion reviewer lacks exact current scoped operational authority';
  END IF;
  IF NEW.proposal_json->'content'->>'candidateId' <> NEW.candidate_id
     OR NEW.proposal_json->'content'->>'candidateSha256' <> substring(NEW.candidate_id from ':(.*)$')
     OR NEW.proposal_json->'content'->>'environment' <> NEW.environment::text
     OR NEW.proposal_json->'content'->>'competition' <> NEW.competition
     OR (NEW.proposal_json->'content'->>'anchorSeasonYear')::integer <> NEW.anchor_season_year
     OR NEW.proposal_json->'content'->>'publicationEligible' <> 'false'
     OR (NEW.proposal_json->'content'->>'proposedAt')::timestamptz < candidate_row.reconciled_at THEN
    RAISE EXCEPTION 'Promotion proposal scope or chronology mismatch';
  END IF;
  SELECT count(*) INTO invalid_record_count FROM (
    SELECT status FROM outcome_external_reconciliation_transaction WHERE candidate_id=NEW.candidate_id
    UNION ALL SELECT status FROM outcome_external_reconciliation_transfer WHERE candidate_id=NEW.candidate_id
    UNION ALL SELECT status FROM outcome_external_reconciliation_draft_selection WHERE candidate_id=NEW.candidate_id
    UNION ALL SELECT status FROM outcome_external_reconciliation_pick_custody WHERE candidate_id=NEW.candidate_id
    UNION ALL SELECT status FROM outcome_external_reconciliation_pick_lineage WHERE candidate_id=NEW.candidate_id
  ) records WHERE status NOT IN ('single_source','corroborated');
  IF invalid_record_count <> 0 THEN
    RAISE EXCEPTION 'Promotion candidate contains unusable reconciled records';
  END IF;
  SELECT count(*) INTO invalid_identity_count
    FROM outcome_external_reconciliation_identity_resolution identity_member
    JOIN outcome_review_decision identity_decision ON identity_decision.decision_id=identity_member.review_decision_id
   WHERE identity_member.candidate_id=NEW.candidate_id
     AND (identity_decision.decision <> 'approved'
       OR identity_decision.canonical_record_id IS DISTINCT FROM identity_member.canonical_id
       OR EXISTS (SELECT 1 FROM outcome_review_decision successor
                   WHERE successor.supersedes_decision_id=identity_decision.decision_id));
  IF invalid_identity_count <> 0 THEN
    RAISE EXCEPTION 'Promotion requires every identity decision to remain current';
  END IF;
  WITH proposed AS (
    SELECT (coverage->>'draftYear')::integer AS draft_year,
           coverage->>'draftType' AS draft_type,
           jsonb_array_elements_text(coverage->'selectionIds') AS selection_id
      FROM jsonb_array_elements(NEW.proposal_json->'content'->'draftEventCoverage') coverage
  ), actual AS (
    SELECT draft_year,draft_type,selection_id
      FROM outcome_external_reconciliation_draft_selection
     WHERE candidate_id=NEW.candidate_id
  ), gaps AS (
    SELECT * FROM proposed EXCEPT SELECT * FROM actual
    UNION ALL
    SELECT * FROM actual EXCEPT SELECT * FROM proposed
  ) SELECT count(*) INTO coverage_gap_count FROM gaps;
  IF coverage_gap_count <> 0 OR
     (SELECT count(*) FROM jsonb_array_elements(NEW.proposal_json->'content'->'draftEventCoverage'))
       <> (SELECT count(*) FROM (
             SELECT DISTINCT draft_year,draft_type FROM outcome_external_reconciliation_draft_selection
              WHERE candidate_id=NEW.candidate_id) draft_events) THEN
    RAISE EXCEPTION 'Promotion draft coverage must equal the exact candidate selection set';
  END IF;
  WITH proposed AS (
    SELECT coverage->>'transactionId' AS transaction_id,
           (coverage->>'seasonYear')::integer AS season_year,
           (coverage->>'occurredOn')::date AS occurred_on
      FROM jsonb_array_elements(NEW.proposal_json->'content'->'transactionDateCoverage') coverage
  ), actual AS (
    SELECT transaction_id,(transaction_json->>'seasonYear')::integer AS season_year,
           (transaction_json->>'occurredOn')::date AS occurred_on
      FROM outcome_external_reconciliation_transaction WHERE candidate_id=NEW.candidate_id
  ), gaps AS (
    SELECT transaction_id FROM proposed EXCEPT SELECT transaction_id FROM actual
    UNION ALL SELECT transaction_id FROM actual EXCEPT SELECT transaction_id FROM proposed
    UNION ALL
    SELECT proposed.transaction_id FROM proposed JOIN actual USING (transaction_id)
     WHERE proposed.season_year IS DISTINCT FROM actual.season_year
        OR extract(year FROM proposed.occurred_on)::integer IS DISTINCT FROM actual.season_year
        OR (actual.occurred_on IS NOT NULL
            AND proposed.occurred_on IS DISTINCT FROM actual.occurred_on)
        OR proposed.occurred_on >
           ((NEW.proposal_json->'content'->>'proposedAt')::timestamptz
             AT TIME ZONE 'Australia/Melbourne')::date
        OR proposed.occurred_on > (NEW.promoted_at AT TIME ZONE 'Australia/Melbourne')::date
  ) SELECT count(*) INTO coverage_gap_count FROM gaps;
  IF coverage_gap_count <> 0 OR
     (SELECT count(*) FROM jsonb_array_elements(NEW.proposal_json->'content'->'transactionDateCoverage'))
       <> (SELECT count(*) FROM outcome_external_reconciliation_transaction
            WHERE candidate_id=NEW.candidate_id) THEN
    RAISE EXCEPTION 'Promotion transaction dates must exactly cover candidate transactions in season and chronology';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "outcome_external_canonical_promotion_insert_guard"
BEFORE INSERT ON "outcome_external_canonical_promotion"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_external_canonical_promotion_insert"();

CREATE FUNCTION "guard_outcome_external_canonical_promotion_run_insert"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE parent_status TEXT; run_capture_id TEXT;
BEGIN
  SELECT status INTO parent_status FROM outcome_external_canonical_promotion
   WHERE promotion_id=NEW.promotion_id FOR SHARE;
  SELECT capture_id INTO run_capture_id FROM outcome_import_run
   WHERE import_run_id=NEW.import_run_id;
  IF NOT FOUND OR parent_status <> 'open' OR run_capture_id IS DISTINCT FROM NEW.capture_id THEN
    RAISE EXCEPTION 'Promotion import-run membership requires an open promotion and exact capture';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM outcome_external_reconciliation_source_batch source
    JOIN outcome_external_evidence_batch batch ON batch.batch_id=source.batch_id
    WHERE source.candidate_id=(SELECT candidate_id FROM outcome_external_canonical_promotion
                               WHERE promotion_id=NEW.promotion_id)
      AND batch.capture_id=NEW.capture_id
  ) THEN
    RAISE EXCEPTION 'Promotion import run must belong to an exact candidate source capture';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "outcome_external_canonical_promotion_run_insert_guard"
BEFORE INSERT ON "outcome_external_canonical_promotion_import_run"
FOR EACH ROW EXECUTE FUNCTION "guard_outcome_external_canonical_promotion_run_insert"();

CREATE FUNCTION "guard_outcome_external_canonical_promotion_record_insert"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE parent_status TEXT; import_row_run_id TEXT;
BEGIN
  SELECT promotion.status INTO parent_status
    FROM outcome_external_canonical_promotion promotion
   WHERE promotion.promotion_id=NEW.promotion_id FOR SHARE;
  SELECT row.import_run_id INTO import_row_run_id FROM outcome_import_row row
   WHERE row.import_row_id=NEW.source_import_row_id;
  IF NOT FOUND OR parent_status <> 'open' OR NOT EXISTS (
    SELECT 1 FROM outcome_external_canonical_promotion_import_run member
     WHERE member.promotion_id=NEW.promotion_id AND member.import_run_id=import_row_run_id
  ) THEN
    RAISE EXCEPTION 'Promotion records require the open promotion import run';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "outcome_external_canonical_promotion_record_insert_guard"
BEFORE INSERT ON "outcome_external_canonical_promotion_record"
FOR EACH ROW EXECUTE FUNCTION "guard_outcome_external_canonical_promotion_record_insert"();

CREATE FUNCTION "validate_outcome_pick_realization_insert"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE asset_pick_id TEXT; asset_kind "OutcomeAssetKind"; selection_pick_id TEXT;
BEGIN
  SELECT asset.pick_id,asset.kind INTO asset_pick_id,asset_kind
    FROM outcome_event_asset asset WHERE asset.asset_version_id=NEW.transfer_asset_version_id;
  SELECT selection.pick_id INTO selection_pick_id
    FROM outcome_draft_selection selection WHERE selection.selection_id=NEW.draft_selection_id;
  IF asset_kind NOT IN ('current_pick','future_pick') OR asset_pick_id IS DISTINCT FROM NEW.pick_id
     OR selection_pick_id IS DISTINCT FROM NEW.pick_id THEN
    RAISE EXCEPTION 'Pick realization must connect one transfer and selection for the same stable entitlement';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "outcome_pick_realization_insert_guard"
BEFORE INSERT ON "outcome_pick_realization"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_pick_realization_insert"();

CREATE FUNCTION "finalize_outcome_external_canonical_promotion"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE actual_record_count INTEGER; actual_import_run_count INTEGER;
DECLARE missing_count INTEGER; draft_event_count INTEGER;
BEGIN
  IF OLD.status <> 'open' OR NEW.status <> 'finalized' OR NEW.finalized_at IS NULL
     OR NEW.finalized_at IS DISTINCT FROM NEW.promoted_at
     OR NEW.promotion_id <> OLD.promotion_id OR NEW.candidate_id <> OLD.candidate_id
     OR NEW.proposal_id <> OLD.proposal_id OR NEW.approval_decision_id <> OLD.approval_decision_id
     OR NEW.import_run_count <> OLD.import_run_count OR NEW.environment <> OLD.environment
     OR NEW.competition <> OLD.competition OR NEW.anchor_season_year <> OLD.anchor_season_year
     OR NEW.transaction_count <> OLD.transaction_count OR NEW.transfer_count <> OLD.transfer_count
     OR NEW.draft_selection_count <> OLD.draft_selection_count
     OR NEW.draft_player_asset_count <> OLD.draft_player_asset_count
     OR NEW.pick_custody_count <> OLD.pick_custody_count
     OR NEW.pick_realization_count <> OLD.pick_realization_count
     OR NEW.promotion_record_count <> OLD.promotion_record_count
     OR NEW.promoted_at <> OLD.promoted_at OR NEW.proposal_sha256 <> OLD.proposal_sha256
     OR NEW.proposal_canonical_json <> OLD.proposal_canonical_json
     OR NEW.proposal_json <> OLD.proposal_json OR NEW.receipt_sha256 <> OLD.receipt_sha256
     OR NEW.receipt_canonical_json <> OLD.receipt_canonical_json
     OR NEW.receipt_json <> OLD.receipt_json THEN
    RAISE EXCEPTION 'Promotion update must be the exact finalization transition';
  END IF;
  SELECT count(*) INTO actual_record_count
    FROM outcome_external_canonical_promotion_record WHERE promotion_id=NEW.promotion_id;
  SELECT count(*) INTO actual_import_run_count
    FROM outcome_external_canonical_promotion_import_run WHERE promotion_id=NEW.promotion_id;
  IF actual_import_run_count <> NEW.import_run_count THEN
    RAISE EXCEPTION 'Promotion import-run count does not reconcile';
  END IF;
  IF actual_record_count <> NEW.promotion_record_count THEN
    RAISE EXCEPTION 'Promotion record count does not reconcile';
  END IF;
  SELECT count(*) INTO draft_event_count
    FROM outcome_external_canonical_promotion_record
   WHERE promotion_id=NEW.promotion_id AND record_kind='draft_event';
  IF NEW.promotion_record_count <> NEW.transaction_count + NEW.transfer_count
      + NEW.draft_selection_count + NEW.draft_player_asset_count
      + NEW.pick_custody_count + NEW.pick_realization_count
      + draft_event_count THEN
    RAISE EXCEPTION 'Promotion typed record counts do not reconcile';
  END IF;
  SELECT count(*) INTO missing_count
    FROM outcome_external_canonical_promotion_record record
   WHERE record.promotion_id=NEW.promotion_id AND NOT (
     (record.record_kind IN ('transaction','draft_event') AND EXISTS (
       SELECT 1 FROM outcome_event_version value
        WHERE value.event_version_id=record.canonical_record_id AND value.status='approved'))
     OR (record.record_kind IN ('transfer','draft_player_asset') AND EXISTS (
       SELECT 1 FROM outcome_event_asset value
        WHERE value.asset_version_id=record.canonical_record_id AND value.status='approved'))
     OR (record.record_kind='draft_selection' AND EXISTS (
       SELECT 1 FROM outcome_draft_selection value
        WHERE value.selection_id=record.canonical_record_id AND value.status='approved'))
     OR (record.record_kind='pick_custody' AND EXISTS (
       SELECT 1 FROM outcome_pick_custody_observation value
        WHERE value.custody_observation_id=record.canonical_record_id AND value.status='approved'))
     OR (record.record_kind='pick_realization' AND EXISTS (
       SELECT 1 FROM outcome_pick_realization value
        WHERE value.realization_id=record.canonical_record_id AND value.status='approved'))
   );
  IF missing_count <> 0 THEN
    RAISE EXCEPTION 'Promotion records must resolve exact approved canonical records';
  END IF;
  SELECT count(*) INTO missing_count
    FROM jsonb_array_elements(NEW.proposal_json->'content'->'transactionDateCoverage') coverage
   WHERE NOT EXISTS (
     SELECT 1 FROM outcome_external_canonical_promotion_record record
     JOIN outcome_event_version value ON value.event_version_id=record.canonical_record_id
    WHERE record.promotion_id=NEW.promotion_id AND record.record_kind='transaction'
      AND record.source_record_id=coverage->>'transactionId'
      AND value.event_date=(coverage->>'occurredOn')::date
   );
  IF missing_count <> 0 THEN
    RAISE EXCEPTION 'Promotion transaction event dates must equal reviewed coverage';
  END IF;
  IF (SELECT count(*) FROM outcome_external_canonical_promotion_record
       WHERE promotion_id=NEW.promotion_id AND record_kind='transaction') <> NEW.transaction_count
     OR (SELECT count(*) FROM outcome_external_canonical_promotion_record
       WHERE promotion_id=NEW.promotion_id AND record_kind='transfer') <> NEW.transfer_count
     OR (SELECT count(*) FROM outcome_external_canonical_promotion_record
       WHERE promotion_id=NEW.promotion_id AND record_kind='draft_selection') <> NEW.draft_selection_count
     OR (SELECT count(*) FROM outcome_external_canonical_promotion_record
       WHERE promotion_id=NEW.promotion_id AND record_kind='draft_player_asset') <> NEW.draft_player_asset_count
     OR (SELECT count(*) FROM outcome_external_canonical_promotion_record
       WHERE promotion_id=NEW.promotion_id AND record_kind='pick_custody') <> NEW.pick_custody_count
     OR (SELECT count(*) FROM outcome_external_canonical_promotion_record
       WHERE promotion_id=NEW.promotion_id AND record_kind='pick_realization') <> NEW.pick_realization_count THEN
    RAISE EXCEPTION 'Promotion typed membership is incomplete';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "outcome_external_canonical_promotion_finalization_guard"
BEFORE UPDATE ON "outcome_external_canonical_promotion"
FOR EACH ROW EXECUTE FUNCTION "finalize_outcome_external_canonical_promotion"();

CREATE FUNCTION "reject_outcome_external_canonical_mutation"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'External canonical promotion evidence is append-only';
END;
$$;
CREATE TRIGGER "outcome_external_canonical_promotion_delete_guard"
BEFORE DELETE ON "outcome_external_canonical_promotion"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_external_canonical_mutation"();
CREATE TRIGGER "outcome_external_canonical_promotion_record_mutation_guard"
BEFORE UPDATE OR DELETE ON "outcome_external_canonical_promotion_record"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_external_canonical_mutation"();
CREATE TRIGGER "outcome_external_canonical_promotion_run_mutation_guard"
BEFORE UPDATE OR DELETE ON "outcome_external_canonical_promotion_import_run"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_external_canonical_mutation"();
CREATE TRIGGER "outcome_pick_custody_mutation_guard"
BEFORE UPDATE OR DELETE ON "outcome_pick_custody_observation"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_external_canonical_mutation"();
CREATE TRIGGER "outcome_pick_realization_mutation_guard"
BEFORE UPDATE OR DELETE ON "outcome_pick_realization"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_external_canonical_mutation"();
