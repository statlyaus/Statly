-- A retained source-first capture stays usable while the latest approved Gate 0A decision in its
-- chain permits the use. Until now only the capture's own decision (while it was the latest) or one
-- retained-capture renewal (while it was the latest) could authorize it, so any later general
-- decision for the same source made the capture unusable, and the 30-day renewal could not be
-- extended once a later decision existed.
--
-- The original acquisition checks still run first and are unchanged: the capture's manifest must
-- still bind its original decision, proposal and rights exactly. Only then may the latest decision
-- in the chain govern, and only when it is a general (not retained-capture-scoped) Gate 0A that is
-- approved, current and content-addressed, scoped to the capture's competition, season, fitzRoy
-- capability and derived_feature_creation, and backed by its own rights artifact for the same
-- provider that permits the consumed fields. It grants nothing beyond that rights artifact. The
-- retained-renewal branch is untouched and is still the only way a renewal can authorize a capture.
DO $$
DECLARE
  original_definition TEXT;
  corrected_definition TEXT;
  anchor CONSTANT TEXT := '
    SELECT gate.*,proposal.proposal_json,rights.content_json AS rights_json
      INTO renewal';
  successor_branch CONSTANT TEXT := $branch$
    -- 0234: the latest approved general Gate 0A in the original decision's chain governs.
    IF EXISTS (
      WITH RECURSIVE chain(decision_id) AS (
        SELECT origin.decision_id
        UNION
        SELECT later.decision_id FROM outcome_gate_decision later
          JOIN chain ON later.supersedes_decision_id=chain.decision_id)
      SELECT 1 FROM chain
        JOIN outcome_gate_decision gate ON gate.decision_id=chain.decision_id
        JOIN outcome_gate_proposal proposal ON proposal.proposal_id=gate.proposal_id
        JOIN outcome_source_rights_proposal rights ON rights.rights_artifact_id=(
          SELECT d->'values'->>0 FROM jsonb_array_elements(proposal.proposal_json#>'{content,scope,dimensions}') d
          WHERE d->>'name'='source_rights_artifact' AND jsonb_array_length(d->'values')=1)
      WHERE gate.decision_id<>origin.decision_id
        AND gate.gate=origin.gate AND gate.environment=origin.environment
        AND gate.decision_key=origin.decision_key AND gate.state='approved'
        AND isfinite(gate.effective_at) AND isfinite(gate.revalidate_at)
        AND gate.effective_at>origin.effective_at AND gate.effective_at<=trusted_at
        AND gate.revalidate_at>trusted_at
        AND NOT EXISTS (SELECT 1 FROM outcome_gate_decision successor
          WHERE successor.supersedes_decision_id=gate.decision_id)
        AND proposal.gate=gate.gate AND proposal.environment=gate.environment
        AND proposal.decision_key=gate.decision_key
        AND gate.decision_id='gate-decision:'||encode(sha256(convert_to(outcome_afl_trade_canonical_json(gate.decision_json->'content'),'UTF8')),'hex')
        AND gate.proposal_id='gate-proposal:'||encode(sha256(convert_to(outcome_afl_trade_canonical_json(proposal.proposal_json->'content'),'UTF8')),'hex')
        AND gate.decision_json#>>'{content,proposalId}'=gate.proposal_id
        AND gate.decision_json#>'{content,scope}'=proposal.proposal_json#>'{content,scope}'
        AND proposal.proposal_json#>>'{content,gate}'=gate.gate
        AND proposal.proposal_json#>>'{content,environment}'=gate.environment::TEXT
        AND proposal.proposal_json#>>'{content,decisionKey}'=gate.decision_key
        AND (proposal.proposal_json#>>'{content,version}')::INTEGER=gate.version
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(proposal.proposal_json#>'{content,scope,dimensions}') d
          WHERE d->>'name' IN ('retained_source_capture','original_gate_decision','original_source_rights_artifact'))
        AND NOT EXISTS (SELECT 1 FROM (VALUES
          ('source_rights_artifact',rights.rights_artifact_id),('competition',source.competition),
          ('season',source.anchor_season_year::TEXT),('fitzroy_capability',source.capability_id),
          ('operation','derived_feature_creation')
        ) required(name,value) WHERE NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(proposal.proposal_json#>'{content,scope,dimensions}') d
          WHERE d->>'name'=required.name AND d->'values' ? required.value))
        AND rights.content_json#>>'{content,provider}'=source.provider
        AND rights.content_json#>>'{content,acquisition,kind}'='fitzroy'
        AND outcome_hpn_private_source_rights_permit(rights.content_json,consumed_fields,
          source.competition,source.anchor_season_year,trusted_at))
    THEN RETURN; END IF;
$branch$;
BEGIN
  SELECT pg_get_functiondef('require_outcome_private_hpn_source_fields(text,jsonb)'::regprocedure)
    INTO original_definition;
  IF original_definition IS NULL
    OR (length(original_definition)-length(replace(original_definition,anchor,'')))/length(anchor)<>1
    OR position('0234: the latest approved general Gate 0A' IN original_definition)>0 THEN
    RAISE EXCEPTION 'Expected exact private source-use helper before current successor rights';
  END IF;
  corrected_definition:=replace(original_definition,anchor,successor_branch||anchor);
  IF replace(corrected_definition,successor_branch||anchor,anchor) IS DISTINCT FROM original_definition THEN
    RAISE EXCEPTION 'Current successor rights altered unrelated source-use helper bytes';
  END IF;
  -- CREATE OR REPLACE keeps the owner, grants, signature, SECURITY DEFINER and search_path.
  EXECUTE corrected_definition;
END $$;
