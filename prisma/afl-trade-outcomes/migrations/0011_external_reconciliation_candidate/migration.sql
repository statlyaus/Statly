CREATE TABLE "outcome_external_reconciliation_candidate" (
  "candidate_id" TEXT PRIMARY KEY,
  "environment" "OutcomeEnvironment" NOT NULL,
  "competition" TEXT NOT NULL,
  "anchor_season_year" INTEGER NOT NULL CHECK ("anchor_season_year" BETWEEN 1897 AND 2200),
  "reconciled_at" TIMESTAMPTZ(3) NOT NULL,
  "source_batch_count" INTEGER NOT NULL CHECK ("source_batch_count" > 0),
  "identity_resolution_count" INTEGER NOT NULL CHECK ("identity_resolution_count" >= 0),
  "transaction_count" INTEGER NOT NULL CHECK ("transaction_count" >= 0),
  "transfer_count" INTEGER NOT NULL CHECK ("transfer_count" >= 0),
  "draft_selection_count" INTEGER NOT NULL CHECK ("draft_selection_count" >= 0),
  "pick_custody_count" INTEGER NOT NULL CHECK ("pick_custody_count" >= 0),
  "pick_lineage_count" INTEGER NOT NULL CHECK ("pick_lineage_count" >= 0),
  "issue_count" INTEGER NOT NULL CHECK ("issue_count" >= 0),
  "status" TEXT NOT NULL CHECK ("status" IN ('open', 'finalized')),
  "finalized_at" TIMESTAMPTZ(3),
  "candidate_json" JSONB NOT NULL,
  CONSTRAINT "outcome_external_reconciliation_candidate_id_check"
    CHECK ("candidate_id" ~ '^external-reconciliation:[a-f0-9]{64}$'),
  CONSTRAINT "outcome_external_reconciliation_finalization_check"
    CHECK (("status" = 'open' AND "finalized_at" IS NULL) OR
           ("status" = 'finalized' AND "finalized_at" IS NOT NULL)),
  CONSTRAINT "outcome_external_reconciliation_private_check"
    CHECK ("candidate_json"->'content'->>'publicationEligible' = 'false' AND
           "candidate_json"->'content'->>'environment' = "environment"::text AND
           "candidate_json"->'content'->>'competition' = "competition" AND
           ("candidate_json"->'content'->>'anchorSeasonYear')::integer = "anchor_season_year")
);

CREATE INDEX "outcome_external_reconciliation_status_idx"
  ON "outcome_external_reconciliation_candidate"("status", "finalized_at");

CREATE TABLE "outcome_external_reconciliation_source_batch" (
  "candidate_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL CHECK ("ordinal" > 0),
  "batch_id" TEXT NOT NULL,
  PRIMARY KEY ("candidate_id", "batch_id"),
  CONSTRAINT "outcome_external_reconciliation_batch_ordinal_key" UNIQUE ("candidate_id", "ordinal"),
  CONSTRAINT "outcome_external_reconciliation_source_candidate_fkey"
    FOREIGN KEY ("candidate_id") REFERENCES "outcome_external_reconciliation_candidate"("candidate_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_external_reconciliation_source_batch_fkey"
    FOREIGN KEY ("batch_id") REFERENCES "outcome_external_evidence_batch"("batch_id") ON DELETE RESTRICT
);

CREATE INDEX "outcome_external_reconciliation_batch_lookup_idx"
  ON "outcome_external_reconciliation_source_batch"("batch_id", "candidate_id");

CREATE TABLE "outcome_external_reconciliation_identity_resolution" (
  "candidate_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL CHECK ("ordinal" > 0),
  "resolution_id" TEXT NOT NULL,
  "review_decision_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "entity_kind" TEXT NOT NULL CHECK ("entity_kind" IN ('club', 'player')),
  "canonical_id" TEXT NOT NULL,
  "resolution_json" JSONB NOT NULL,
  PRIMARY KEY ("candidate_id", "resolution_id"),
  CONSTRAINT "outcome_external_reconciliation_identity_ordinal_key" UNIQUE ("candidate_id", "ordinal"),
  CONSTRAINT "outcome_external_reconciliation_identity_id_check"
    CHECK ("resolution_id" ~ '^external-identity-resolution:[a-f0-9]{64}$'),
  CONSTRAINT "outcome_external_reconciliation_identity_candidate_fkey"
    FOREIGN KEY ("candidate_id") REFERENCES "outcome_external_reconciliation_candidate"("candidate_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_external_reconciliation_identity_decision_fkey"
    FOREIGN KEY ("review_decision_id") REFERENCES "outcome_review_decision"("decision_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_external_reconciliation_identity_json_check"
    CHECK ("resolution_json"->'content'->>'reviewDecisionId' = "review_decision_id" AND
           "resolution_json"->'content'->>'provider' = "provider" AND
           "resolution_json"->'content'->>'entityKind' = "entity_kind" AND
           "resolution_json"->'content'->>'canonicalId' = "canonical_id")
);

CREATE INDEX "outcome_external_reconciliation_identity_decision_idx"
  ON "outcome_external_reconciliation_identity_resolution"("review_decision_id");

CREATE TABLE "outcome_external_reconciliation_transaction" (
  "candidate_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL CHECK ("ordinal" > 0),
  "transaction_id" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "transaction_json" JSONB NOT NULL,
  PRIMARY KEY ("candidate_id", "transaction_id"),
  CONSTRAINT "outcome_external_reconciliation_transaction_ordinal_key" UNIQUE ("candidate_id", "ordinal"),
  CONSTRAINT "outcome_external_reconciliation_transaction_id_check"
    CHECK ("transaction_id" ~ '^external-transaction:[a-f0-9]{64}$'),
  CONSTRAINT "outcome_external_reconciliation_transaction_status_check"
    CHECK ("status" IN ('single_source', 'corroborated', 'disputed', 'unresolved')),
  CONSTRAINT "outcome_external_reconciliation_transaction_candidate_fkey"
    FOREIGN KEY ("candidate_id") REFERENCES "outcome_external_reconciliation_candidate"("candidate_id") ON DELETE RESTRICT
);

CREATE TABLE "outcome_external_reconciliation_transfer" (
  "candidate_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL CHECK ("ordinal" > 0),
  "transfer_id" TEXT NOT NULL,
  "transaction_id" TEXT NOT NULL,
  "pick_id" TEXT,
  "status" TEXT NOT NULL,
  "transfer_json" JSONB NOT NULL,
  PRIMARY KEY ("candidate_id", "transfer_id"),
  CONSTRAINT "outcome_external_reconciliation_transfer_ordinal_key" UNIQUE ("candidate_id", "ordinal"),
  CONSTRAINT "outcome_external_reconciliation_transfer_id_check"
    CHECK ("transfer_id" ~ '^external-transfer:[a-f0-9]{64}$'),
  CONSTRAINT "outcome_external_reconciliation_transfer_pick_id_check"
    CHECK ("pick_id" IS NULL OR "pick_id" ~ '^draft-pick:[a-f0-9]{64}$'),
  CONSTRAINT "outcome_external_reconciliation_transfer_pick_json_check"
    CHECK ("pick_id" IS NOT DISTINCT FROM ("transfer_json"->'asset'->>'pickId')),
  CONSTRAINT "outcome_external_reconciliation_transfer_status_check"
    CHECK ("status" IN ('single_source', 'corroborated', 'disputed', 'unresolved')),
  CONSTRAINT "outcome_external_reconciliation_transfer_candidate_fkey"
    FOREIGN KEY ("candidate_id") REFERENCES "outcome_external_reconciliation_candidate"("candidate_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_external_reconciliation_transfer_transaction_fkey"
    FOREIGN KEY ("candidate_id", "transaction_id") REFERENCES "outcome_external_reconciliation_transaction"("candidate_id", "transaction_id") ON DELETE RESTRICT
);

CREATE INDEX "outcome_external_reconciliation_transfer_transaction_idx"
  ON "outcome_external_reconciliation_transfer"("candidate_id", "transaction_id");

CREATE TABLE "outcome_external_reconciliation_draft_selection" (
  "candidate_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL CHECK ("ordinal" > 0),
  "selection_id" TEXT NOT NULL,
  "draft_year" INTEGER NOT NULL CHECK ("draft_year" BETWEEN 1897 AND 2200),
  "draft_type" TEXT NOT NULL,
  "selection_number" INTEGER NOT NULL CHECK ("selection_number" > 0),
  "pick_id" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "selection_json" JSONB NOT NULL,
  PRIMARY KEY ("candidate_id", "selection_id"),
  CONSTRAINT "outcome_external_reconciliation_selection_ordinal_key" UNIQUE ("candidate_id", "ordinal"),
  CONSTRAINT "outcome_external_reconciliation_selection_id_check"
    CHECK ("selection_id" ~ '^external-draft-selection:[a-f0-9]{64}$'),
  CONSTRAINT "outcome_external_reconciliation_selection_pick_id_check"
    CHECK ("pick_id" ~ '^draft-pick:[a-f0-9]{64}$' AND "selection_json"->>'pickId' = "pick_id"),
  CONSTRAINT "outcome_external_reconciliation_selection_status_check"
    CHECK ("status" IN ('single_source', 'corroborated', 'disputed', 'unresolved')),
  CONSTRAINT "outcome_external_reconciliation_selection_candidate_fkey"
    FOREIGN KEY ("candidate_id") REFERENCES "outcome_external_reconciliation_candidate"("candidate_id") ON DELETE RESTRICT
);

CREATE INDEX "outcome_external_reconciliation_selection_lookup_idx"
  ON "outcome_external_reconciliation_draft_selection"("draft_year", "draft_type", "selection_number");

CREATE TABLE "outcome_external_reconciliation_pick_custody" (
  "candidate_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL CHECK ("ordinal" > 0),
  "custody_id" TEXT NOT NULL,
  "pick_id" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "custody_json" JSONB NOT NULL,
  PRIMARY KEY ("candidate_id", "custody_id"),
  CONSTRAINT "outcome_external_reconciliation_custody_ordinal_key" UNIQUE ("candidate_id", "ordinal"),
  CONSTRAINT "outcome_external_reconciliation_custody_id_check"
    CHECK ("custody_id" ~ '^external-pick-custody:[a-f0-9]{64}$'),
  CONSTRAINT "outcome_external_reconciliation_custody_pick_id_check"
    CHECK ("pick_id" ~ '^draft-pick:[a-f0-9]{64}$' AND "custody_json"->>'pickId' = "pick_id"),
  CONSTRAINT "outcome_external_reconciliation_custody_status_check"
    CHECK ("status" IN ('single_source', 'corroborated', 'disputed', 'unresolved')),
  CONSTRAINT "outcome_external_reconciliation_custody_candidate_fkey"
    FOREIGN KEY ("candidate_id") REFERENCES "outcome_external_reconciliation_candidate"("candidate_id") ON DELETE RESTRICT
);

CREATE TABLE "outcome_external_reconciliation_pick_lineage" (
  "candidate_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL CHECK ("ordinal" > 0),
  "lineage_id" TEXT NOT NULL,
  "transfer_id" TEXT NOT NULL,
  "selection_id" TEXT NOT NULL,
  "pick_id" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "lineage_json" JSONB NOT NULL,
  PRIMARY KEY ("candidate_id", "lineage_id"),
  CONSTRAINT "outcome_external_reconciliation_lineage_ordinal_key" UNIQUE ("candidate_id", "ordinal"),
  CONSTRAINT "outcome_external_reconciliation_lineage_id_check"
    CHECK ("lineage_id" ~ '^external-pick-lineage:[a-f0-9]{64}$'),
  CONSTRAINT "outcome_external_reconciliation_lineage_pick_id_check"
    CHECK ("pick_id" ~ '^draft-pick:[a-f0-9]{64}$' AND "lineage_json"->>'pickId' = "pick_id"),
  CONSTRAINT "outcome_external_reconciliation_lineage_status_check"
    CHECK ("status" IN ('single_source', 'corroborated', 'disputed', 'unresolved')),
  CONSTRAINT "outcome_external_reconciliation_lineage_candidate_fkey"
    FOREIGN KEY ("candidate_id") REFERENCES "outcome_external_reconciliation_candidate"("candidate_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_external_reconciliation_lineage_transfer_fkey"
    FOREIGN KEY ("candidate_id", "transfer_id") REFERENCES "outcome_external_reconciliation_transfer"("candidate_id", "transfer_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_external_reconciliation_lineage_selection_fkey"
    FOREIGN KEY ("candidate_id", "selection_id") REFERENCES "outcome_external_reconciliation_draft_selection"("candidate_id", "selection_id") ON DELETE RESTRICT
);

CREATE TABLE "outcome_external_reconciliation_issue" (
  "candidate_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL CHECK ("ordinal" > 0),
  "issue_id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "subject_key" TEXT NOT NULL,
  "issue_json" JSONB NOT NULL,
  PRIMARY KEY ("candidate_id", "issue_id"),
  CONSTRAINT "outcome_external_reconciliation_issue_ordinal_key" UNIQUE ("candidate_id", "ordinal"),
  CONSTRAINT "outcome_external_reconciliation_issue_id_check"
    CHECK ("issue_id" ~ '^external-reconciliation-issue:[a-f0-9]{64}$'),
  CONSTRAINT "outcome_external_reconciliation_issue_candidate_fkey"
    FOREIGN KEY ("candidate_id") REFERENCES "outcome_external_reconciliation_candidate"("candidate_id") ON DELETE RESTRICT
);

CREATE INDEX "outcome_external_reconciliation_issue_code_idx"
  ON "outcome_external_reconciliation_issue"("candidate_id", "code");

CREATE FUNCTION "validate_outcome_external_reconciliation_candidate_insert"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'open' OR NEW.finalized_at IS NOT NULL THEN
    RAISE EXCEPTION 'External reconciliation candidates must be inserted open';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "outcome_external_reconciliation_candidate_insert_guard"
BEFORE INSERT ON "outcome_external_reconciliation_candidate"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_external_reconciliation_candidate_insert"();

CREATE FUNCTION "guard_outcome_external_reconciliation_child_insert"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE parent_status TEXT;
BEGIN
  SELECT candidate.status INTO parent_status
    FROM outcome_external_reconciliation_candidate candidate
   WHERE candidate.candidate_id = NEW.candidate_id
   FOR SHARE;
  IF NOT FOUND OR parent_status <> 'open' THEN
    RAISE EXCEPTION 'External reconciliation children require an open candidate';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "outcome_external_reconciliation_source_insert_guard"
BEFORE INSERT ON "outcome_external_reconciliation_source_batch"
FOR EACH ROW EXECUTE FUNCTION "guard_outcome_external_reconciliation_child_insert"();
CREATE TRIGGER "outcome_external_reconciliation_identity_insert_guard"
BEFORE INSERT ON "outcome_external_reconciliation_identity_resolution"
FOR EACH ROW EXECUTE FUNCTION "guard_outcome_external_reconciliation_child_insert"();
CREATE TRIGGER "outcome_external_reconciliation_transaction_insert_guard"
BEFORE INSERT ON "outcome_external_reconciliation_transaction"
FOR EACH ROW EXECUTE FUNCTION "guard_outcome_external_reconciliation_child_insert"();
CREATE TRIGGER "outcome_external_reconciliation_transfer_insert_guard"
BEFORE INSERT ON "outcome_external_reconciliation_transfer"
FOR EACH ROW EXECUTE FUNCTION "guard_outcome_external_reconciliation_child_insert"();
CREATE TRIGGER "outcome_external_reconciliation_selection_insert_guard"
BEFORE INSERT ON "outcome_external_reconciliation_draft_selection"
FOR EACH ROW EXECUTE FUNCTION "guard_outcome_external_reconciliation_child_insert"();
CREATE TRIGGER "outcome_external_reconciliation_custody_insert_guard"
BEFORE INSERT ON "outcome_external_reconciliation_pick_custody"
FOR EACH ROW EXECUTE FUNCTION "guard_outcome_external_reconciliation_child_insert"();
CREATE TRIGGER "outcome_external_reconciliation_lineage_insert_guard"
BEFORE INSERT ON "outcome_external_reconciliation_pick_lineage"
FOR EACH ROW EXECUTE FUNCTION "guard_outcome_external_reconciliation_child_insert"();
CREATE TRIGGER "outcome_external_reconciliation_issue_insert_guard"
BEFORE INSERT ON "outcome_external_reconciliation_issue"
FOR EACH ROW EXECUTE FUNCTION "guard_outcome_external_reconciliation_child_insert"();

CREATE FUNCTION "finalize_outcome_external_reconciliation_candidate"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  source_count INTEGER;
  identity_count INTEGER;
  transaction_count INTEGER;
  transfer_count INTEGER;
  selection_count INTEGER;
  custody_count INTEGER;
  lineage_count INTEGER;
  issue_count INTEGER;
  unfinalized_source_count INTEGER;
  invalid_identity_decision_count INTEGER;
  missing_evidence_count INTEGER;
  invalid_lineage_count INTEGER;
BEGIN
  IF OLD.status <> 'open' OR NEW.status <> 'finalized' OR NEW.finalized_at IS NULL OR
     NEW.candidate_id <> OLD.candidate_id OR NEW.environment <> OLD.environment OR
     NEW.competition <> OLD.competition OR NEW.anchor_season_year <> OLD.anchor_season_year OR
     NEW.reconciled_at <> OLD.reconciled_at OR
     NEW.source_batch_count <> OLD.source_batch_count OR
     NEW.identity_resolution_count <> OLD.identity_resolution_count OR
     NEW.transaction_count <> OLD.transaction_count OR NEW.transfer_count <> OLD.transfer_count OR
     NEW.draft_selection_count <> OLD.draft_selection_count OR
     NEW.pick_custody_count <> OLD.pick_custody_count OR
     NEW.pick_lineage_count <> OLD.pick_lineage_count OR NEW.issue_count <> OLD.issue_count OR
     NEW.candidate_json <> OLD.candidate_json THEN
    RAISE EXCEPTION 'External reconciliation update is not the exact finalization transition';
  END IF;
  SELECT count(*) INTO source_count FROM outcome_external_reconciliation_source_batch WHERE candidate_id=NEW.candidate_id;
  SELECT count(*) INTO identity_count FROM outcome_external_reconciliation_identity_resolution WHERE candidate_id=NEW.candidate_id;
  SELECT count(*) INTO transaction_count FROM outcome_external_reconciliation_transaction WHERE candidate_id=NEW.candidate_id;
  SELECT count(*) INTO transfer_count FROM outcome_external_reconciliation_transfer WHERE candidate_id=NEW.candidate_id;
  SELECT count(*) INTO selection_count FROM outcome_external_reconciliation_draft_selection WHERE candidate_id=NEW.candidate_id;
  SELECT count(*) INTO custody_count FROM outcome_external_reconciliation_pick_custody WHERE candidate_id=NEW.candidate_id;
  SELECT count(*) INTO lineage_count FROM outcome_external_reconciliation_pick_lineage WHERE candidate_id=NEW.candidate_id;
  SELECT count(*) INTO issue_count FROM outcome_external_reconciliation_issue WHERE candidate_id=NEW.candidate_id;
  IF source_count <> NEW.source_batch_count OR identity_count <> NEW.identity_resolution_count OR
     transaction_count <> NEW.transaction_count OR transfer_count <> NEW.transfer_count OR
     selection_count <> NEW.draft_selection_count OR custody_count <> NEW.pick_custody_count OR
     lineage_count <> NEW.pick_lineage_count OR issue_count <> NEW.issue_count THEN
    RAISE EXCEPTION 'External reconciliation candidate child counts do not reconcile';
  END IF;
  SELECT count(*) INTO unfinalized_source_count
    FROM outcome_external_reconciliation_source_batch member
    JOIN outcome_external_evidence_batch batch ON batch.batch_id=member.batch_id
    JOIN outcome_source_capture capture ON capture.capture_id=batch.capture_id
   WHERE member.candidate_id=NEW.candidate_id AND
         (batch.status <> 'finalized' OR batch.finalized_at IS NULL OR batch.issue_count <> 0 OR
          capture.environment <> NEW.environment OR capture.competition <> NEW.competition OR
          capture.anchor_season_year NOT IN (
            SELECT (item->>'seasonYear')::INTEGER
              FROM jsonb_array_elements(NEW.candidate_json->'content'->'transactions') item
            UNION
            SELECT (item->'asset'->>'draftYear')::INTEGER
              FROM jsonb_array_elements(NEW.candidate_json->'content'->'transfers') item
             WHERE item->'asset'->>'kind' = 'pick_entitlement'
            UNION
            SELECT (item->>'draftYear')::INTEGER
              FROM jsonb_array_elements(NEW.candidate_json->'content'->'draftSelections') item
            UNION
            SELECT (item->>'draftYear')::INTEGER
              FROM jsonb_array_elements(NEW.candidate_json->'content'->'pickCustody') item
          ));
  IF unfinalized_source_count <> 0 THEN
    RAISE EXCEPTION 'External reconciliation requires finalized, issue-free source evidence batches';
  END IF;
  SELECT count(*) INTO invalid_identity_decision_count
    FROM outcome_external_reconciliation_identity_resolution identity_member
    JOIN outcome_review_decision decision ON decision.decision_id=identity_member.review_decision_id
   WHERE identity_member.candidate_id=NEW.candidate_id AND
         (NOT (decision.subject_type = 'external_provider_identity' OR
               (NEW.environment = 'test_fixture' AND
                decision.subject_type = 'external_provider_identity_fixture')) OR
          decision.canonical_record_id IS DISTINCT FROM identity_member.canonical_id OR
          decision.decision <> 'approved' OR
          decision.decided_at IS DISTINCT FROM (identity_member.resolution_json->'content'->>'decidedAt')::timestamptz OR
          decision.decided_at > NEW.reconciled_at OR
          EXISTS (SELECT 1 FROM outcome_review_decision successor
                   WHERE successor.supersedes_decision_id=decision.decision_id));
  IF invalid_identity_decision_count <> 0 THEN
    RAISE EXCEPTION 'External reconciliation requires current approved identity decisions';
  END IF;
  SELECT count(*) INTO invalid_lineage_count
    FROM outcome_external_reconciliation_pick_lineage lineage
    JOIN outcome_external_reconciliation_transfer transfer
      ON transfer.candidate_id=lineage.candidate_id AND transfer.transfer_id=lineage.transfer_id
    JOIN outcome_external_reconciliation_draft_selection selection
      ON selection.candidate_id=lineage.candidate_id AND selection.selection_id=lineage.selection_id
   WHERE lineage.candidate_id=NEW.candidate_id AND
         (lineage.pick_id IS DISTINCT FROM transfer.pick_id OR
          lineage.pick_id IS DISTINCT FROM selection.pick_id OR
          lineage.status NOT IN ('single_source','corroborated') OR
          transfer.status NOT IN ('single_source','corroborated') OR
          selection.status NOT IN ('single_source','corroborated') OR
          NOT EXISTS (
            SELECT 1
              FROM outcome_external_reconciliation_pick_custody custody
             WHERE custody.candidate_id=lineage.candidate_id AND
                   custody.pick_id=lineage.pick_id AND
                   custody.status IN ('single_source','corroborated')
          ));
  IF invalid_lineage_count <> 0 THEN
    RAISE EXCEPTION 'External reconciliation lineage requires usable transfer, selection, and custody';
  END IF;
  WITH referenced_evidence AS (
    SELECT jsonb_array_elements_text(transaction_json->'evidenceIds') AS evidence_id
      FROM outcome_external_reconciliation_transaction WHERE candidate_id=NEW.candidate_id
    UNION
    SELECT jsonb_array_elements_text(transfer_json->'evidenceIds')
      FROM outcome_external_reconciliation_transfer WHERE candidate_id=NEW.candidate_id
    UNION
    SELECT jsonb_array_elements_text(selection_json->'evidenceIds')
      FROM outcome_external_reconciliation_draft_selection WHERE candidate_id=NEW.candidate_id
    UNION
    SELECT jsonb_array_elements_text(custody_json->'evidenceIds')
      FROM outcome_external_reconciliation_pick_custody WHERE candidate_id=NEW.candidate_id
    UNION
    SELECT jsonb_array_elements_text(lineage_json->'evidenceIds')
      FROM outcome_external_reconciliation_pick_lineage WHERE candidate_id=NEW.candidate_id
    UNION
    SELECT jsonb_array_elements_text(issue_json->'evidenceIds')
      FROM outcome_external_reconciliation_issue WHERE candidate_id=NEW.candidate_id
  ), source_evidence AS (
    SELECT evidence.evidence_id
      FROM outcome_external_evidence_row evidence
      JOIN outcome_external_reconciliation_source_batch source
        ON source.batch_id=evidence.batch_id AND source.candidate_id=NEW.candidate_id
  ), evidence_gap AS (
    SELECT reference.evidence_id
      FROM referenced_evidence reference
      LEFT JOIN source_evidence source ON source.evidence_id=reference.evidence_id
     WHERE source.evidence_id IS NULL
    UNION ALL
    SELECT source.evidence_id
      FROM source_evidence source
      LEFT JOIN referenced_evidence reference ON reference.evidence_id=source.evidence_id
     WHERE reference.evidence_id IS NULL
  )
  SELECT count(*) INTO missing_evidence_count
    FROM evidence_gap;
  IF missing_evidence_count <> 0 THEN
    RAISE EXCEPTION 'External reconciliation must conserve the exact source evidence set';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "outcome_external_reconciliation_finalization_guard"
BEFORE UPDATE ON "outcome_external_reconciliation_candidate"
FOR EACH ROW EXECUTE FUNCTION "finalize_outcome_external_reconciliation_candidate"();

CREATE FUNCTION "reject_outcome_external_reconciliation_mutation"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'External reconciliation evidence is append-only';
END;
$$;

CREATE TRIGGER "outcome_external_reconciliation_candidate_delete_guard"
BEFORE DELETE ON "outcome_external_reconciliation_candidate"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_external_reconciliation_mutation"();
CREATE TRIGGER "outcome_external_reconciliation_source_mutation_guard"
BEFORE UPDATE OR DELETE ON "outcome_external_reconciliation_source_batch"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_external_reconciliation_mutation"();
CREATE TRIGGER "outcome_external_reconciliation_identity_mutation_guard"
BEFORE UPDATE OR DELETE ON "outcome_external_reconciliation_identity_resolution"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_external_reconciliation_mutation"();
CREATE TRIGGER "outcome_external_reconciliation_transaction_mutation_guard"
BEFORE UPDATE OR DELETE ON "outcome_external_reconciliation_transaction"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_external_reconciliation_mutation"();
CREATE TRIGGER "outcome_external_reconciliation_transfer_mutation_guard"
BEFORE UPDATE OR DELETE ON "outcome_external_reconciliation_transfer"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_external_reconciliation_mutation"();
CREATE TRIGGER "outcome_external_reconciliation_selection_mutation_guard"
BEFORE UPDATE OR DELETE ON "outcome_external_reconciliation_draft_selection"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_external_reconciliation_mutation"();
CREATE TRIGGER "outcome_external_reconciliation_custody_mutation_guard"
BEFORE UPDATE OR DELETE ON "outcome_external_reconciliation_pick_custody"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_external_reconciliation_mutation"();
CREATE TRIGGER "outcome_external_reconciliation_lineage_mutation_guard"
BEFORE UPDATE OR DELETE ON "outcome_external_reconciliation_pick_lineage"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_external_reconciliation_mutation"();
CREATE TRIGGER "outcome_external_reconciliation_issue_mutation_guard"
BEFORE UPDATE OR DELETE ON "outcome_external_reconciliation_issue"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_external_reconciliation_mutation"();
