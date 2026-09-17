-- Retain unverified submissions without making them current or calculation eligible.
-- Source identities/rights and evidence authority are deliberately NOT inferred here.
CREATE TABLE outcome_hpn_statistical_decision_custody (
  decision_id TEXT PRIMARY KEY,
  scope_key TEXT NOT NULL,
  decision_canonical_json TEXT NOT NULL,
  decision_json JSONB NOT NULL,
  registered_at TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT outcome_hpn_statistical_custody_integrity CHECK ((
    decision_canonical_json = outcome_afl_trade_canonical_json(decision_json)
    AND decision_id = decision_json->>'decisionId'
    AND decision_id = 'hpn-statistical-decision:' || encode(sha256(convert_to(
      outcome_afl_trade_canonical_json(decision_json-'decisionId'),'UTF8')),'hex')
    AND decision_json->>'schemaVersion' = 'afl-trade-hpn-statistical-decision/v1'
    AND decision_json->>'authority' = 'requires_repository_verification'
    AND decision_json->'publicationEligible' = 'false'::jsonb
    AND decision_json#>>'{candidate,schemaVersion}' = 'afl-trade-hpn-statistical-cell/v1'
    AND decision_json#>>'{candidate,scope,environment}' = 'non_production'
    AND decision_json#>>'{candidate,candidateId}' = 'hpn-statistical-cell:' || encode(sha256(convert_to(
      outcome_afl_trade_canonical_json((decision_json->'candidate')-'candidateId'),'UTF8')),'hex')
    AND scope_key = 'hpn-statistical-scope:' || encode(sha256(convert_to(
      outcome_afl_trade_canonical_json(decision_json#>'{candidate,scope}'),'UTF8')),'hex')
    AND decision_json->>'selectedSource' IN ('primary','corroborating')
    AND decision_json->'selectedValue' = decision_json#>ARRAY['candidate',decision_json->>'selectedSource','value']
    AND (decision_json->>'decidedAt')::timestamptz <= registered_at
  ) IS TRUE)
);

-- Several competing submissions may concern one cell. This index is NOT a current head.
CREATE INDEX outcome_hpn_statistical_custody_scope_idx
  ON outcome_hpn_statistical_decision_custody(scope_key,decision_id);

CREATE FUNCTION reject_outcome_hpn_statistical_custody_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'HPN statistical decision custody is immutable';
END;
$$;
CREATE TRIGGER outcome_hpn_statistical_custody_immutable
  BEFORE UPDATE OR DELETE ON outcome_hpn_statistical_decision_custody
  FOR EACH ROW EXECUTE FUNCTION reject_outcome_hpn_statistical_custody_mutation();
CREATE TRIGGER outcome_hpn_statistical_custody_no_truncate
  BEFORE TRUNCATE ON outcome_hpn_statistical_decision_custody
  FOR EACH STATEMENT EXECUTE FUNCTION reject_outcome_hpn_statistical_custody_mutation();
