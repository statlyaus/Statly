export function resolutionSql(entity: 'player' | 'match', candidateAlias: string): string {
  if (entity === 'player')
    return `SELECT jsonb_build_object(
      'canonicalId',resolution.player_id,'revision',head.revision,
      'decisionId',resolution.decision_id,'resolutionScope',resolution.resolution_scope,
      'assignmentDecisionId',CASE WHEN resolution.resolution_scope='candidate_only' THEN NULL ELSE resolution.decision_id END,
      'assignmentStatus',assignment.status) AS value
    FROM outcome_provider_player_resolution_head head
    JOIN outcome_provider_player_resolution resolution ON resolution.resolution_id=head.resolution_id
    LEFT JOIN outcome_provider_identity_assignment_head assignment
      ON assignment.assignment_case_id=resolution.assignment_case_id
    WHERE head.identity_candidate_id=${candidateAlias}.identity_candidate_id
      AND resolution.identity_candidate_id=head.identity_candidate_id
      AND resolution.outcome='approved'
      AND ((resolution.resolution_scope='candidate_only'
        AND resolution.assignment_case_id IS NULL AND resolution.player_identity_id IS NULL
        AND resolution.decision_json#>>'{content,proposal,content,identityCandidateId}'=head.identity_candidate_id
        AND resolution.decision_json#>>'{content,proposal,content,staging,providerDecodedRowId}'=${candidateAlias}.provider_decoded_row_id
        AND resolution.decision_json#>>'{content,proposal,content,proposedTarget,scope}'='candidate_only'
        AND resolution.decision_json#>>'{content,proposal,content,proposedTarget,playerId}'=resolution.player_id)
        OR (resolution.resolution_scope IS DISTINCT FROM 'candidate_only'
          AND outcome_provider_assignment_continuity_current(resolution.decision_id) AND assignment.status='active'))
      AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor
        WHERE successor.supersedes_decision_id=resolution.decision_id)`;
  const table = `outcome_provider_${entity}_resolution`;
  const head = `outcome_provider_${entity}_resolution_head`;
  const candidateColumn = 'match_candidate_id';
  const canonicalColumn = 'match_id';
  return `SELECT jsonb_build_object(
      'canonicalId', resolution.${canonicalColumn}, 'revision', head.revision,
      'decisionId', resolution.decision_id,
      'assignmentDecisionId', resolution.decision_id,
      'assignmentStatus', assignment.status) AS value
    FROM ${head} head
    JOIN ${table} resolution ON resolution.resolution_id=head.resolution_id
    JOIN outcome_provider_identity_assignment_head assignment
      ON assignment.assignment_case_id=resolution.assignment_case_id
    WHERE head.${candidateColumn}=${candidateAlias}.${candidateColumn}
      AND resolution.outcome='approved' AND outcome_provider_assignment_continuity_current(resolution.decision_id)
      AND assignment.status='active'
      AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor
        WHERE successor.supersedes_decision_id=resolution.decision_id)`;
}

export function clubResolutionSql(side: 'home' | 'away'): string {
  return `SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'canonicalId', resolution.club_id, 'revision', head.revision,
      'decisionId', resolution.decision_id,
      'assignmentDecisionId', resolution.decision_id,
      'assignmentStatus', assignment.status)), '[]'::jsonb) AS values
    FROM outcome_provider_club_resolution resolution
    JOIN outcome_provider_club_resolution_head head ON head.resolution_id=resolution.resolution_id
    JOIN outcome_provider_identity_assignment_head assignment
      ON assignment.assignment_case_id=resolution.assignment_case_id
    WHERE resolution.match_candidate_id=match_candidate.match_candidate_id
      AND resolution.side='${side}' AND resolution.outcome='approved'
      AND outcome_provider_assignment_continuity_current(resolution.decision_id) AND assignment.status='active'
      AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor
        WHERE successor.supersedes_decision_id=resolution.decision_id)`;
}
