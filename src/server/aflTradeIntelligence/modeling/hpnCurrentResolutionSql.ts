/**
 * Renders the provider identity-assignment continuity predicate for one resolution decision.
 * The default asks the per-origin database function for every row it is applied to.
 */
export type AssignmentContinuitySql = (decisionExpression: string) => string;

export const perRowAssignmentContinuity: AssignmentContinuitySql = (decision) =>
  `outcome_provider_assignment_continuity_current(${decision})`;

/** The CTE name that {@link assignmentContinuityCteSql} defines. */
const CONTINUITY_CTE = 'assignment_continuity';

/**
 * Looks a resolution decision up in the continuity evaluated once per assignment case by
 * {@link assignmentContinuityCteSql}. The COALESCE keeps the uncorrelated IN a hashed subplan: it
 * is built once per statement instead of being pulled up into a join inside every lateral probe.
 */
export const hoistedAssignmentContinuity: AssignmentContinuitySql = (decision) =>
  `COALESCE(${decision} IN (SELECT ${CONTINUITY_CTE}.continuity_decision_id FROM ${CONTINUITY_CTE}
      WHERE ${CONTINUITY_CTE}.continuity_current), FALSE)`;

/**
 * Defines the `assignment_continuity` CTE for {@link hoistedAssignmentContinuity}. `scopeSql`
 * selects `identity_candidate_id` and `match_candidate_id` for the rows being resolved. The
 * candidate decisions are every resolution that {@link resolutionSql} and
 * {@link clubResolutionSql} would ask continuity about after their other conjuncts, so a decision
 * absent from the CTE could not have been admitted by the per-row predicate either.
 */
export function assignmentContinuityCteSql(scopeSql: string): string {
  return `continuity_scope AS MATERIALIZED (${scopeSql}),
    ${CONTINUITY_CTE} AS MATERIALIZED (
      SELECT continuity.continuity_decision_id, continuity.continuity_current
        FROM outcome_provider_assignment_continuity_current_set(ARRAY(
          SELECT resolution.decision_id FROM continuity_scope scope
            JOIN outcome_provider_player_resolution_head head
              ON head.identity_candidate_id=scope.identity_candidate_id
            JOIN outcome_provider_player_resolution resolution
              ON resolution.resolution_id=head.resolution_id
             AND resolution.identity_candidate_id=head.identity_candidate_id
            JOIN outcome_provider_identity_assignment_head assignment
              ON assignment.assignment_case_id=resolution.assignment_case_id
           WHERE resolution.outcome='approved' AND assignment.status='active'
             AND resolution.resolution_scope IS DISTINCT FROM 'candidate_only'
             AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor
               WHERE successor.supersedes_decision_id=resolution.decision_id)
          UNION
          SELECT resolution.decision_id FROM continuity_scope scope
            JOIN outcome_provider_match_resolution_head head
              ON head.match_candidate_id=scope.match_candidate_id
            JOIN outcome_provider_match_resolution resolution
              ON resolution.resolution_id=head.resolution_id
            JOIN outcome_provider_identity_assignment_head assignment
              ON assignment.assignment_case_id=resolution.assignment_case_id
           WHERE resolution.outcome='approved' AND assignment.status='active'
             AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor
               WHERE successor.supersedes_decision_id=resolution.decision_id)
          UNION
          SELECT resolution.decision_id FROM continuity_scope scope
            JOIN outcome_provider_club_resolution resolution
              ON resolution.match_candidate_id=scope.match_candidate_id
             AND resolution.side IN ('home','away')
            JOIN outcome_provider_club_resolution_head head
              ON head.resolution_id=resolution.resolution_id
            JOIN outcome_provider_identity_assignment_head assignment
              ON assignment.assignment_case_id=resolution.assignment_case_id
           WHERE resolution.outcome='approved' AND assignment.status='active'
             AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor
               WHERE successor.supersedes_decision_id=resolution.decision_id))) continuity
    )`;
}

export function resolutionSql(
  entity: 'player' | 'match',
  candidateAlias: string,
  continuity: AssignmentContinuitySql = perRowAssignmentContinuity
): string {
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
          AND ${continuity('resolution.decision_id')} AND assignment.status='active'))
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
      AND resolution.outcome='approved' AND ${continuity('resolution.decision_id')}
      AND assignment.status='active'
      AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor
        WHERE successor.supersedes_decision_id=resolution.decision_id)`;
}

export function clubResolutionSql(
  side: 'home' | 'away',
  continuity: AssignmentContinuitySql = perRowAssignmentContinuity
): string {
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
      AND ${continuity('resolution.decision_id')} AND assignment.status='active'
      AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor
        WHERE successor.supersedes_decision_id=resolution.decision_id)`;
}
