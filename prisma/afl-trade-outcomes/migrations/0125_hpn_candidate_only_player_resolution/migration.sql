-- Candidate-only player review governs one decoded occurrence, never a reusable identity.
-- Match and club assignment predicates are deliberately unchanged.
CREATE OR REPLACE FUNCTION outcome_hpn_pav_player_resolution_current(
  decoded_row_id TEXT, authority JSONB
) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1
    FROM outcome_provider_identity_candidate candidate
    JOIN outcome_provider_player_resolution_head head
      ON head.identity_candidate_id=candidate.identity_candidate_id
    JOIN outcome_provider_player_resolution resolution
      ON resolution.resolution_id=head.resolution_id
      AND resolution.identity_candidate_id=candidate.identity_candidate_id
    LEFT JOIN outcome_provider_identity_assignment_head assignment
      ON assignment.assignment_case_id=resolution.assignment_case_id
    WHERE candidate.provider_decoded_row_id=decoded_row_id
      AND resolution.outcome='approved'
      AND resolution.player_id=authority->>'canonicalId'
      AND resolution.decision_id=authority#>>'{resolutionDecision,id}'
      AND head.revision=(authority->>'revision')::INTEGER
      AND (
        (resolution.resolution_scope='candidate_only'
          AND authority->>'entityKind'='player'
          AND authority->>'status'='current_approved'
          AND authority->>'resolutionScope'='candidate_only'
          AND authority->'assignmentDecision'='null'::JSONB
          AND resolution.assignment_case_id IS NULL
          AND resolution.player_identity_id IS NULL
          AND resolution.decision_json#>>'{content,proposal,content,identityCandidateId}'=candidate.identity_candidate_id
          AND resolution.decision_json#>>'{content,proposal,content,staging,providerDecodedRowId}'=decoded_row_id
          AND resolution.decision_json#>>'{content,proposal,content,proposedTarget,scope}'='candidate_only'
          AND resolution.decision_json#>>'{content,proposal,content,proposedTarget,playerId}'=resolution.player_id
          AND authority#>>'{resolutionDecision,sha256}'=split_part(resolution.decision_id,':',2))
        OR (resolution.resolution_scope IS DISTINCT FROM 'candidate_only'
          AND NOT (authority ? 'resolutionScope')
          AND assignment.decision_id=resolution.decision_id AND assignment.status='active'
          AND assignment.decision_id=authority#>>'{assignmentDecision,id}')
      )
      AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor
        WHERE successor.supersedes_decision_id=resolution.decision_id)
  );
$$ LANGUAGE sql STABLE;
