CREATE OR REPLACE FUNCTION "outcome_private_reviewed_evidence_is_current"()
RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$
WITH historical_candidates AS MATERIALIZED (
  SELECT decoded.provider_decoded_row_id,identity.identity_candidate_id,
         match.match_candidate_id,metric.availability::text AS availability,
         metric.numeric_value,metric.definition_version
    FROM outcome_provider_decoded_row decoded
    JOIN outcome_source_capture capture ON capture.capture_id=decoded.capture_id
    JOIN outcome_provider_normalization_run run
      ON run.normalization_run_id=decoded.normalization_run_id
     AND run.capture_id=decoded.capture_id
    JOIN outcome_provider_identity_candidate identity USING (provider_decoded_row_id)
    JOIN outcome_provider_match_candidate match USING (provider_decoded_row_id)
    JOIN outcome_provider_metric_candidate metric USING (provider_decoded_row_id)
   WHERE capture.provider='afl_tables'
     AND capture.capability_id='afl-tables-player-stats'
     AND capture.environment='non_production'
     AND capture.status='staged'
     AND decoded.season_year BETWEEN 2021 AND 2025
     AND run.finalized_at IS NOT NULL
     AND identity.native_entity_id IS NOT NULL
     AND metric.metric_code='goals'
), historical_health AS MATERIALIZED (
  SELECT count(*)::integer AS candidate_count,
         count(identity_review.decision_id)::integer AS identity_count,
         count(match_review.decision_id)::integer AS match_count,
         count(factual_review.decision_id)::integer AS factual_count
    FROM historical_candidates candidate
    LEFT JOIN outcome_review_decision identity_review
      ON identity_review.decision_id=
           'local-afl-tables-review:identity:'||candidate.identity_candidate_id
     AND identity_review.subject_type='provider_identity_candidate'
     AND identity_review.subject_id=candidate.identity_candidate_id
     AND identity_review.decision='approved'
     AND identity_review.decided_by='local-five-season-evidence-reviewer'
     AND identity_review.evidence_json->>'evidenceSetSha256'=
       'aef663452e66a433048605a71fb4178ed1a5e1d9610c6d3ed75bfb796308b5cb'
     AND NOT EXISTS (
       SELECT 1 FROM outcome_review_decision successor
        WHERE successor.supersedes_decision_id=identity_review.decision_id
     )
    LEFT JOIN outcome_review_decision match_review
      ON match_review.decision_id='local-afl-tables-review:match:'||candidate.match_candidate_id
     AND match_review.subject_type='provider_match_candidate'
     AND match_review.subject_id=candidate.match_candidate_id
     AND match_review.decision='approved'
     AND match_review.decided_by='local-five-season-evidence-reviewer'
     AND match_review.evidence_json->>'evidenceSetSha256'=
       'aef663452e66a433048605a71fb4178ed1a5e1d9610c6d3ed75bfb796308b5cb'
     AND NOT EXISTS (
       SELECT 1 FROM outcome_review_decision successor
        WHERE successor.supersedes_decision_id=match_review.decision_id
     )
    LEFT JOIN outcome_review_decision factual_review
      ON factual_review.decision_id=
           'local-afl-tables-review:fact:'||candidate.provider_decoded_row_id
     AND factual_review.subject_type='local_reconciled_player_match_fact'
     AND factual_review.subject_id=candidate.provider_decoded_row_id
     AND factual_review.decision='approved'
     AND factual_review.decided_by='local-five-season-evidence-reviewer'
     AND factual_review.evidence_json->>'evidenceSetSha256'=
       'aef663452e66a433048605a71fb4178ed1a5e1d9610c6d3ed75bfb796308b5cb'
     AND factual_review.evidence_json->>'identityCandidateId'=candidate.identity_candidate_id
     AND factual_review.evidence_json->>'matchCandidateId'=candidate.match_candidate_id
     AND factual_review.evidence_json->>'metricCode'='goals'
     AND factual_review.evidence_json->>'definitionVersion'=candidate.definition_version
     AND factual_review.evidence_json->>'metricAvailability'=candidate.availability
     AND (factual_review.evidence_json->>'numericValue')::numeric
           IS NOT DISTINCT FROM candidate.numeric_value
     AND NOT EXISTS (
       SELECT 1 FROM outcome_review_decision successor
        WHERE successor.supersedes_decision_id=factual_review.decision_id
     )
), official_marker AS MATERIALIZED (
  SELECT marker.evidence_json
    FROM outcome_review_decision marker
   WHERE marker.decision_id=
     'local-official-afl-review:v2:set:4e58a390b7088d50b119bdd2c945a1f66ba2025fd8bbbf8710fc8a270dad2dca'
     AND marker.subject_type='local_review_set'
     AND marker.subject_id='4e58a390b7088d50b119bdd2c945a1f66ba2025fd8bbbf8710fc8a270dad2dca'
     AND marker.decision='approved'
     AND marker.canonical_record_type='local_review_set'
     AND marker.canonical_record_id=marker.subject_id
     AND marker.supersedes_decision_id=
       'local-official-afl-review:set:4e58a390b7088d50b119bdd2c945a1f66ba2025fd8bbbf8710fc8a270dad2dca'
     AND marker.decided_by='local-workbook-evidence-reviewer'
     AND marker.evidence_json->>'evidenceSetSha256'=marker.subject_id
     AND NOT EXISTS (
       SELECT 1 FROM outcome_review_decision successor
        WHERE successor.supersedes_decision_id=marker.decision_id
     )
), official_expected AS MATERIALIZED (
  SELECT value AS decision_id
    FROM official_marker,
         jsonb_array_elements_text(official_marker.evidence_json->'decisionIds') ids(value)
), official_approved AS MATERIALIZED (
  SELECT decision.*
    FROM official_expected
    JOIN outcome_review_decision decision USING (decision_id)
   WHERE decision.decision='approved'
     AND decision.decided_by='local-workbook-evidence-reviewer'
     AND decision.evidence_json->>'evidenceSetSha256'=
       '4e58a390b7088d50b119bdd2c945a1f66ba2025fd8bbbf8710fc8a270dad2dca'
     AND decision.subject_type=ANY(ARRAY[
       'provider_identity_candidate','provider_match_candidate',
       'local_reconciled_player_match_fact'
     ]::text[])
     AND (
       decision.subject_type<>'provider_identity_candidate'
       OR (
         decision.canonical_record_type='local_canonical_player_club'
         AND decision.evidence_json->>'canonicalPlayerId'=
           'local-afl-player:afl-tables:12824'
       )
     )
     AND (
       decision.subject_type<>'provider_match_candidate'
       OR decision.canonical_record_type='local_afl_match'
     )
     AND (
       decision.subject_type<>'local_reconciled_player_match_fact'
       OR decision.canonical_record_type='local_player_match_fact'
     )
     AND NOT EXISTS (
       SELECT 1 FROM outcome_review_decision successor
        WHERE successor.supersedes_decision_id=decision.decision_id
     )
), official_exact_facts AS MATERIALIZED (
  SELECT approved.decision_id
    FROM official_approved approved
    JOIN outcome_provider_decoded_row decoded
      ON decoded.provider_decoded_row_id=approved.subject_id
    JOIN outcome_source_capture capture ON capture.capture_id=decoded.capture_id
    JOIN outcome_provider_identity_candidate identity USING (provider_decoded_row_id)
    JOIN outcome_provider_match_candidate match USING (provider_decoded_row_id)
    JOIN outcome_provider_metric_candidate metric USING (provider_decoded_row_id)
   WHERE approved.subject_type='local_reconciled_player_match_fact'
     AND capture.provider='official_afl'
     AND capture.capability_id='official-afl-player-stats'
     AND capture.environment='non_production'
     AND capture.status='staged'
     AND decoded.season_year=2026
     AND match.provider_status='CONCLUDED'
     AND metric.metric_code='goals'
     AND approved.evidence_json->>'identityCandidateId'=identity.identity_candidate_id
     AND approved.evidence_json->>'matchCandidateId'=match.match_candidate_id
     AND approved.evidence_json->>'definitionVersion'=metric.definition_version
     AND approved.evidence_json->>'metricAvailability'=metric.availability::text
     AND (approved.evidence_json->>'numericValue')::numeric
           IS NOT DISTINCT FROM metric.numeric_value
), capture_health AS MATERIALIZED (
  SELECT count(*)::integer AS capture_count
    FROM outcome_source_capture capture
    JOIN outcome_artifact_custody custody
      ON custody.artifact_id=capture.source_artifact_id
     AND custody.environment='non_production'
     AND custody.verified_at IS NOT NULL
    JOIN outcome_source_rights_proposal rights
      ON rights.rights_artifact_id=
           capture.manifest_json->'sourceRightsProposal'->>'rightsArtifactId'
   WHERE capture.environment='non_production' AND capture.status='staged'
     AND ((capture.provider='afl_tables'
           AND capture.capability_id='afl-tables-player-stats'
           AND capture.anchor_season_year BETWEEN 2021 AND 2025)
       OR (capture.provider='official_afl'
           AND capture.capability_id='official-afl-player-stats'
           AND capture.anchor_season_year=2026))
)
SELECT historical_health.candidate_count=48769
   AND historical_health.identity_count=48769
   AND historical_health.match_count=48769
   AND historical_health.factual_count=48769
   AND (SELECT count(*) FROM official_expected)=36
   AND (SELECT count(*) FROM official_approved)=36
   AND (SELECT count(*) FROM official_approved
         WHERE subject_type='provider_identity_candidate')=12
   AND (SELECT count(*) FROM official_approved
         WHERE subject_type='provider_match_candidate')=12
   AND (SELECT count(*) FROM official_exact_facts)=12
   AND capture_health.capture_count=6
  FROM historical_health,capture_health
$$;
