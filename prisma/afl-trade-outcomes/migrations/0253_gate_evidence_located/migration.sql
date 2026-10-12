-- Gate ledger evidence must be retained before a record cites it.
--
-- A Gate proposal or decision cites evidence by immutable reference. Until now the ledger accepted any
-- reference, so three genuine non-production decisions recorded on 2026-09-29 cite artifacts whose
-- bytes were never kept (#742 audit note). From this migration a new non-test_fixture proposal or
-- decision is refused when any cited `artifact:` reference has no custody location. A location row
-- requires its custody row (0246), so one check covers both. It is the write-first rule reviewed
-- spell registration already applies (ARTIFACT_UNLOCATED): write the bytes to the registered store,
-- record custody and location, then cite them.
--
-- Cited references are, for a proposal, `evidenceIds` and every condition's
-- `verificationEvidenceIds`; for a decision, `authorityEvidenceIds`, every condition result's
-- `evidenceIds` and every reviewer's `evidenceId`. Only `artifact:` references name custody; other
-- prefixes address database records and are not checked here. test_fixture records are exempt, as
-- they cite no retained bytes.
--
-- The triggers fire on INSERT only. Both tables already reject UPDATE and DELETE (0009), so existing
-- rows, including the three 2026-09-29 decisions, are unchanged and still load.

CREATE FUNCTION "outcome_gate_unlocated_artifact_ids"(cited JSONB)
RETURNS TEXT[] LANGUAGE sql STABLE AS $$
  SELECT COALESCE(array_agg(DISTINCT reference ORDER BY reference), ARRAY[]::TEXT[])
    FROM jsonb_array_elements_text(cited) AS reference
   WHERE reference LIKE 'artifact:%'
     AND NOT EXISTS (SELECT 1 FROM "outcome_artifact_custody_location" location
                      WHERE location."artifact_id"=reference)
$$;

CREATE FUNCTION "validate_outcome_gate_proposal_evidence_located"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE content JSONB := NEW."proposal_json"->'content'; unlocated TEXT[];
BEGIN
  IF NEW."environment"='test_fixture' THEN RETURN NEW; END IF;
  unlocated:="outcome_gate_unlocated_artifact_ids"(
    COALESCE(content->'evidenceIds','[]'::JSONB)
    || COALESCE((SELECT jsonb_agg(reference)
                   FROM jsonb_array_elements(COALESCE(content->'conditions','[]'::JSONB)) c,
                        jsonb_array_elements(COALESCE(c->'verificationEvidenceIds','[]'::JSONB))
                          AS reference), '[]'::JSONB));
  IF cardinality(unlocated)>0 THEN
    RAISE EXCEPTION 'Gate proposal cites evidence with no custody location: %',
      array_to_string(unlocated, ', ') USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION "validate_outcome_gate_decision_evidence_located"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE content JSONB := NEW."decision_json"->'content'; unlocated TEXT[];
BEGIN
  IF NEW."environment"='test_fixture' THEN RETURN NEW; END IF;
  unlocated:="outcome_gate_unlocated_artifact_ids"(
    COALESCE(content->'authorityEvidenceIds','[]'::JSONB)
    || COALESCE((SELECT jsonb_agg(reference)
                   FROM jsonb_array_elements(COALESCE(content->'conditionResults','[]'::JSONB)) c,
                        jsonb_array_elements(COALESCE(c->'evidenceIds','[]'::JSONB)) AS reference),
                '[]'::JSONB)
    || COALESCE((SELECT jsonb_agg(r->'evidenceId')
                   FROM jsonb_array_elements(COALESCE(content->'reviewers','[]'::JSONB)) r),
                '[]'::JSONB));
  IF cardinality(unlocated)>0 THEN
    RAISE EXCEPTION 'Gate decision cites evidence with no custody location: %',
      array_to_string(unlocated, ', ') USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "outcome_gate_proposal_evidence_located"
BEFORE INSERT ON "outcome_gate_proposal"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_gate_proposal_evidence_located"();

CREATE TRIGGER "outcome_gate_decision_evidence_located"
BEFORE INSERT ON "outcome_gate_decision"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_gate_decision_evidence_located"();
