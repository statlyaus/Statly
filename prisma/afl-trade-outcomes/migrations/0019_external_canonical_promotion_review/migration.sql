CREATE TABLE "outcome_external_canonical_promotion_review_decision" (
  "decision_id" TEXT PRIMARY KEY,
  "candidate_id" TEXT NOT NULL,
  "proposal_id" TEXT NOT NULL,
  "proposal_sha256" CHAR(64) NOT NULL CHECK ("proposal_sha256" ~ '^[a-f0-9]{64}$'),
  "proposal_canonical_json" TEXT NOT NULL,
  "revision" INTEGER NOT NULL CHECK ("revision" > 0),
  "outcome" TEXT NOT NULL CHECK ("outcome" IN ('approved','rejected','withdrawn')),
  "authority_evidence_id" TEXT NOT NULL,
  "supersedes_decision_id" TEXT UNIQUE,
  "decision_sha256" CHAR(64) NOT NULL CHECK ("decision_sha256" ~ '^[a-f0-9]{64}$'),
  "decision_canonical_json" TEXT NOT NULL,
  "decision_json" JSONB NOT NULL,
  "decided_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "outcome_external_promotion_review_id_check"
    CHECK ("decision_id" = 'review-decision:' || "decision_sha256"),
  CONSTRAINT "outcome_external_promotion_review_proposal_id_check"
    CHECK ("proposal_id" = 'external-canonical-promotion-proposal:' || "proposal_sha256"),
  CONSTRAINT "outcome_external_promotion_review_chain_shape_check"
    CHECK (("revision"=1)=("supersedes_decision_id" IS NULL)),
  CONSTRAINT "outcome_external_promotion_review_candidate_fkey"
    FOREIGN KEY ("candidate_id") REFERENCES "outcome_external_reconciliation_candidate"("candidate_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_external_promotion_review_decision_fkey"
    FOREIGN KEY ("decision_id") REFERENCES "outcome_review_decision"("decision_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_external_promotion_review_authority_fkey"
    FOREIGN KEY ("authority_evidence_id") REFERENCES "outcome_governed_evidence_reference"("reference_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_external_promotion_review_supersedes_fkey"
    FOREIGN KEY ("supersedes_decision_id") REFERENCES "outcome_external_canonical_promotion_review_decision"("decision_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_external_promotion_review_candidate_revision_key"
    UNIQUE ("candidate_id","revision")
);
CREATE INDEX "outcome_external_promotion_review_authority_idx"
  ON "outcome_external_canonical_promotion_review_decision"("authority_evidence_id","decided_at");

CREATE TABLE "outcome_external_canonical_promotion_review_head" (
  "candidate_id" TEXT PRIMARY KEY,
  "revision" INTEGER NOT NULL CHECK ("revision" > 0),
  "decision_id" TEXT NOT NULL UNIQUE,
  "proposal_id" TEXT NOT NULL,
  "status" TEXT NOT NULL CHECK ("status" IN ('approved','rejected','withdrawn')),
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "outcome_external_promotion_head_candidate_fkey"
    FOREIGN KEY ("candidate_id") REFERENCES "outcome_external_reconciliation_candidate"("candidate_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_external_promotion_head_decision_fkey"
    FOREIGN KEY ("decision_id") REFERENCES "outcome_external_canonical_promotion_review_decision"("decision_id") ON DELETE RESTRICT
);
CREATE INDEX "outcome_external_promotion_head_status_idx"
  ON "outcome_external_canonical_promotion_review_head"("status","updated_at");

CREATE FUNCTION "validate_outcome_external_promotion_review_leaf"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE current_id TEXT; current_count INTEGER;
BEGIN
  IF NEW.subject_type <> 'external_reconciliation_candidate' THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('outcome-review-subject:external_reconciliation_candidate:' || NEW.subject_id,0));
  SELECT count(*),min(decision.decision_id) INTO current_count,current_id
    FROM outcome_review_decision decision
   WHERE decision.subject_type=NEW.subject_type AND decision.subject_id=NEW.subject_id
     AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor
                      WHERE successor.supersedes_decision_id=decision.decision_id);
  IF current_count=0 AND NEW.supersedes_decision_id IS NOT NULL THEN
    RAISE EXCEPTION 'The first external promotion review cannot supersede another decision';
  ELSIF current_count=1 AND NEW.supersedes_decision_id IS DISTINCT FROM current_id THEN
    RAISE EXCEPTION 'Each external promotion review must supersede its sole current decision';
  ELSIF current_count>1 THEN
    RAISE EXCEPTION 'External promotion review history must have exactly one current leaf';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "zz_outcome_external_promotion_review_leaf"
BEFORE INSERT ON "outcome_review_decision"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_external_promotion_review_leaf"();

CREATE FUNCTION "validate_outcome_external_promotion_review_insert"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE candidate RECORD; generic RECORD; head RECORD; authority_count INTEGER;
DECLARE coverage_gap_count INTEGER; invalid_record_count INTEGER;
DECLARE proposal JSONB; content JSONB;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('outcome-external-canonical-promotion-review:' || NEW.candidate_id,0));
  SELECT * INTO candidate FROM outcome_external_reconciliation_candidate
   WHERE candidate_id=NEW.candidate_id FOR SHARE;
  SELECT * INTO generic FROM outcome_review_decision WHERE decision_id=NEW.decision_id FOR SHARE;
  SELECT * INTO head FROM outcome_external_canonical_promotion_review_head
   WHERE candidate_id=NEW.candidate_id FOR UPDATE;
  proposal := NEW.decision_json->'content'->'proposal';
  content := proposal->'content';

  IF candidate.candidate_id IS NULL OR generic.decision_id IS NULL
     OR candidate.status<>'finalized' OR candidate.finalized_at IS NULL OR candidate.issue_count<>0
     OR candidate.finalized_at>NEW.decided_at OR NEW.decided_at>statement_timestamp()
  THEN RAISE EXCEPTION 'Promotion review requires one exact finalized issue-free candidate'; END IF;

  IF encode(sha256(convert_to(NEW.decision_canonical_json,'UTF8')),'hex')<>NEW.decision_sha256
     OR NEW.decision_canonical_json::jsonb IS DISTINCT FROM NEW.decision_json->'content'
     OR NEW.decision_json->>'decisionId' IS DISTINCT FROM NEW.decision_id
     OR NEW.decision_json->'content'->>'schemaVersion'<>'afl-trade-external-canonical-promotion-review/v1'
     OR NEW.decision_json->'content'->>'candidateId' IS DISTINCT FROM NEW.candidate_id
     OR NEW.decision_json->'content'->>'proposalId' IS DISTINCT FROM NEW.proposal_id
     OR NEW.decision_json->'content'->>'proposalSha256' IS DISTINCT FROM NEW.proposal_sha256
     OR proposal->>'proposalId' IS DISTINCT FROM NEW.proposal_id
     OR encode(sha256(convert_to(NEW.proposal_canonical_json,'UTF8')),'hex')<>NEW.proposal_sha256
     OR NEW.proposal_canonical_json::jsonb IS DISTINCT FROM content
     OR (NEW.decision_json->'content'->>'revision')::integer IS DISTINCT FROM NEW.revision
     OR NEW.decision_json->'content'->>'decision' IS DISTINCT FROM NEW.outcome
     OR NEW.decision_json->'content'->>'authorityEvidenceId' IS DISTINCT FROM NEW.authority_evidence_id
     OR (NEW.decision_json->'content'->>'decidedAt')::timestamptz IS DISTINCT FROM NEW.decided_at
     OR NEW.decision_json->'content'->>'publicationEligible'<>'false'
     OR generic.subject_type<>'external_reconciliation_candidate' OR generic.subject_id<>NEW.candidate_id
     OR generic.decision<>NEW.outcome OR generic.supersedes_decision_id IS DISTINCT FROM NEW.supersedes_decision_id
     OR generic.rationale IS DISTINCT FROM NEW.decision_json->'content'->>'rationale'
     OR generic.decided_by IS DISTINCT FROM NEW.decision_json->'content'->>'decidedBy'
     OR generic.decided_at IS DISTINCT FROM NEW.decided_at
     OR generic.canonical_record_type IS NOT NULL OR generic.canonical_record_id IS NOT NULL
     OR generic.evidence_json->>'schemaVersion'<>'afl-trade-external-canonical-promotion-approval/v1'
     OR generic.evidence_json->>'proposalId' IS DISTINCT FROM NEW.proposal_id
     OR generic.evidence_json->>'proposalSha256' IS DISTINCT FROM NEW.proposal_sha256
     OR generic.evidence_json->'proposal' IS DISTINCT FROM proposal
     OR generic.evidence_json->>'authorityEvidenceId' IS DISTINCT FROM NEW.authority_evidence_id
  THEN RAISE EXCEPTION 'Promotion review decision does not match its exact typed and generic evidence'; END IF;

  IF content->>'candidateId' IS DISTINCT FROM NEW.candidate_id
     OR content->>'candidateSha256' IS DISTINCT FROM substring(NEW.candidate_id from ':(.*)$')
     OR content->>'environment' IS DISTINCT FROM candidate.environment::text
     OR content->>'competition' IS DISTINCT FROM candidate.competition
     OR (content->>'anchorSeasonYear')::integer IS DISTINCT FROM candidate.anchor_season_year
     OR content->>'publicationEligible'<>'false'
     OR (content->>'proposedAt')::timestamptz<candidate.reconciled_at
     OR (content->>'proposedAt')::timestamptz>NEW.decided_at
  THEN RAISE EXCEPTION 'Promotion review proposal scope or chronology mismatch'; END IF;

  IF head.candidate_id IS NULL THEN
    IF NEW.revision<>1 OR NEW.supersedes_decision_id IS NOT NULL THEN
      RAISE EXCEPTION 'The first promotion review decision must be revision one';
    END IF;
  ELSIF NEW.revision<>head.revision+1 OR NEW.supersedes_decision_id IS DISTINCT FROM head.decision_id
     OR NEW.decided_at<head.updated_at THEN
    RAISE EXCEPTION 'Promotion review requires the exact current revision';
  END IF;

  SELECT count(*) INTO invalid_record_count FROM (
    SELECT status FROM outcome_external_reconciliation_transaction WHERE candidate_id=NEW.candidate_id
    UNION ALL SELECT status FROM outcome_external_reconciliation_transfer WHERE candidate_id=NEW.candidate_id
    UNION ALL SELECT status FROM outcome_external_reconciliation_draft_selection WHERE candidate_id=NEW.candidate_id
    UNION ALL SELECT status FROM outcome_external_reconciliation_pick_custody WHERE candidate_id=NEW.candidate_id
    UNION ALL SELECT status FROM outcome_external_reconciliation_pick_lineage WHERE candidate_id=NEW.candidate_id
  ) records WHERE status NOT IN ('single_source','corroborated');
  IF invalid_record_count<>0 THEN
    RAISE EXCEPTION 'Promotion review candidate contains unusable reconciled records';
  END IF;

  WITH proposed AS (
    SELECT (coverage->>'draftYear')::integer AS draft_year,coverage->>'draftType' AS draft_type,
           jsonb_array_elements_text(coverage->'selectionIds') AS selection_id
      FROM jsonb_array_elements(content->'draftEventCoverage') coverage
  ), actual AS (
    SELECT draft_year,draft_type,selection_id FROM outcome_external_reconciliation_draft_selection
     WHERE candidate_id=NEW.candidate_id
  ), gaps AS (
    SELECT * FROM proposed EXCEPT SELECT * FROM actual
    UNION ALL SELECT * FROM actual EXCEPT SELECT * FROM proposed
  ) SELECT count(*) INTO coverage_gap_count FROM gaps;
  IF coverage_gap_count<>0 OR
     (SELECT count(*) FROM jsonb_array_elements(content->'draftEventCoverage')) <>
     (SELECT count(*) FROM (SELECT DISTINCT draft_year,draft_type
        FROM outcome_external_reconciliation_draft_selection WHERE candidate_id=NEW.candidate_id) events)
  THEN RAISE EXCEPTION 'Promotion review coverage must equal the candidate selection set'; END IF;

  WITH proposed AS (
    SELECT coverage->>'transactionId' AS transaction_id,
           (coverage->>'seasonYear')::integer AS season_year,
           (coverage->>'occurredOn')::date AS occurred_on
      FROM jsonb_array_elements(content->'transactionDateCoverage') coverage
  ), actual AS (
    SELECT transaction_id,(transaction_json->>'seasonYear')::integer AS season_year,
           (transaction_json->>'occurredOn')::date AS occurred_on
      FROM outcome_external_reconciliation_transaction WHERE candidate_id=NEW.candidate_id
  ), gaps AS (
    SELECT transaction_id FROM proposed EXCEPT SELECT transaction_id FROM actual
    UNION ALL SELECT transaction_id FROM actual EXCEPT SELECT transaction_id FROM proposed
    UNION ALL SELECT proposed.transaction_id FROM proposed JOIN actual USING (transaction_id)
      WHERE proposed.season_year IS DISTINCT FROM actual.season_year
         OR extract(year FROM proposed.occurred_on)::integer IS DISTINCT FROM actual.season_year
         OR (actual.occurred_on IS NOT NULL
             AND proposed.occurred_on IS DISTINCT FROM actual.occurred_on)
         OR proposed.occurred_on >
            ((content->>'proposedAt')::timestamptz
              AT TIME ZONE 'Australia/Melbourne')::date
         OR proposed.occurred_on > (NEW.decided_at AT TIME ZONE 'Australia/Melbourne')::date
  ) SELECT count(*) INTO coverage_gap_count FROM gaps;
  IF coverage_gap_count<>0 OR
     (SELECT count(*) FROM jsonb_array_elements(content->'transactionDateCoverage')) <>
     (SELECT count(*) FROM outcome_external_reconciliation_transaction WHERE candidate_id=NEW.candidate_id)
  THEN RAISE EXCEPTION 'Promotion review transaction dates must equal the candidate transaction set in season and chronology'; END IF;

  SELECT count(*) INTO authority_count
    FROM outcome_operational_principal_authority authority
    JOIN outcome_governed_evidence_reference evidence ON evidence.reference_id=authority.authority_evidence_id
    JOIN outcome_review_decision approval ON approval.decision_id=evidence.approval_decision_id
   WHERE authority.authority_evidence_id=NEW.authority_evidence_id
     AND authority.principal_ref=generic.decided_by
     AND authority.role='afl_trade_canonical_promoter'
     AND authority.scope_key='public-afl-draft-trade-outcomes'
     AND authority.provider='multi_source' AND authority.capability_id='external_candidate_promotion'
     AND authority.competition=candidate.competition
     AND candidate.anchor_season_year BETWEEN authority.valid_from_season AND authority.valid_through_season
     AND authority.valid_from<=statement_timestamp()
     AND (authority.valid_through IS NULL OR authority.valid_through>statement_timestamp())
     AND evidence.environment=candidate.environment AND evidence.status='approved'
     AND approval.decision='approved'
     AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor
                       WHERE successor.supersedes_decision_id=approval.decision_id);
  IF authority_count<>1 THEN
    RAISE EXCEPTION 'Promotion review requires exact current scoped promoter authority';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "outcome_external_promotion_review_insert_guard"
BEFORE INSERT ON "outcome_external_canonical_promotion_review_decision"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_external_promotion_review_insert"();

CREATE FUNCTION "validate_outcome_external_promotion_review_head_write"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE decision RECORD;
BEGIN
  SELECT * INTO decision FROM outcome_external_canonical_promotion_review_decision
   WHERE decision_id=NEW.decision_id;
  IF NOT FOUND OR decision.candidate_id<>NEW.candidate_id OR decision.revision<>NEW.revision
     OR decision.proposal_id<>NEW.proposal_id OR decision.outcome<>NEW.status
     OR decision.decided_at<>NEW.updated_at THEN
    RAISE EXCEPTION 'Promotion review head must mirror its exact typed decision';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.revision<>1 OR decision.supersedes_decision_id IS NOT NULL THEN
      RAISE EXCEPTION 'Promotion review head must begin at revision one'; END IF;
  ELSIF NEW.candidate_id<>OLD.candidate_id OR NEW.revision<>OLD.revision+1
     OR decision.supersedes_decision_id IS DISTINCT FROM OLD.decision_id
     OR NEW.updated_at<OLD.updated_at THEN
    RAISE EXCEPTION 'Promotion review head update requires exact compare-and-swap chronology';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "outcome_external_promotion_review_head_write_guard"
BEFORE INSERT OR UPDATE ON "outcome_external_canonical_promotion_review_head"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_external_promotion_review_head_write"();

CREATE FUNCTION "require_outcome_external_promotion_typed_decision"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE typed_count INTEGER; head_count INTEGER;
BEGIN
  IF NEW.subject_type<>'external_reconciliation_candidate' THEN RETURN NEW; END IF;
  SELECT count(*) INTO typed_count FROM outcome_external_canonical_promotion_review_decision typed
   WHERE typed.decision_id=NEW.decision_id AND typed.candidate_id=NEW.subject_id;
  SELECT count(*) INTO head_count FROM outcome_external_canonical_promotion_review_head head
   WHERE head.candidate_id=NEW.subject_id AND head.decision_id=NEW.decision_id;
  IF typed_count<>1 OR head_count<>1 THEN
    RAISE EXCEPTION 'Each external promotion review requires one exact typed decision and current head by commit';
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER "outcome_external_promotion_review_requires_typed_decision"
AFTER INSERT ON "outcome_review_decision" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "require_outcome_external_promotion_typed_decision"();

CREATE FUNCTION "require_outcome_external_promotion_current_review"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE review_count INTEGER;
BEGIN
  SELECT count(*) INTO review_count
    FROM outcome_external_canonical_promotion_review_decision decision
    JOIN outcome_external_canonical_promotion_review_head head
      ON head.candidate_id=decision.candidate_id AND head.decision_id=decision.decision_id
   WHERE decision.decision_id=NEW.approval_decision_id AND decision.candidate_id=NEW.candidate_id
     AND decision.proposal_id=NEW.proposal_id AND decision.outcome='approved'
     AND head.status='approved';
  IF review_count<>1 THEN
    RAISE EXCEPTION 'Canonical promotion requires its exact current typed approval review';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "outcome_external_canonical_promotion_current_review_guard"
BEFORE INSERT ON "outcome_external_canonical_promotion"
FOR EACH ROW EXECUTE FUNCTION "require_outcome_external_promotion_current_review"();

CREATE FUNCTION "reject_outcome_external_promotion_review_mutation"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN
  RAISE EXCEPTION 'External promotion review evidence is append-only';
END $$;
CREATE TRIGGER "outcome_external_promotion_review_mutation_guard"
BEFORE UPDATE OR DELETE ON "outcome_external_canonical_promotion_review_decision"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_external_promotion_review_mutation"();
CREATE TRIGGER "outcome_external_promotion_review_head_delete_guard"
BEFORE DELETE ON "outcome_external_canonical_promotion_review_head"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_external_promotion_review_mutation"();
