import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';
import type { AflOutcomeSqlTransaction } from '../outcomes/postgresOutcomeReleaseRepository';
import {
  createAflTradeHpnStatisticalSelectionSet,
  type AflTradeHpnPavSeasonInputSet,
} from './hpnPavInputContracts';
import type { AflTradeHpnPavSeasonInputRequest } from './hpnPavInputRepository';
import {
  aflTradeHpnStatisticalDecisionSchema,
  type AflTradeHpnStatisticalDecision,
} from './hpnStatisticalAdjudication';
import { authenticateAflTradeHpnStatisticalSources } from './postgresHpnStatisticalSourceAuthentication';

interface CurrentSelectionRow {
  scope_key: string;
  decision_id: string;
  support_review_id: string;
  revision: number;
  identity_json: unknown;
  applied_at: Date | string;
  decision_json: unknown;
  decision_registered_at: Date | string;
  support_registered_at: Date | string;
  approval_decided_at: Date | string;
  current: boolean;
}

function instant(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error('Invalid statistical authority time.');
  return parsed.toISOString();
}

function requireBeforeCutoff(value: Date | string, cutoff: string, label: string) {
  const parsed = instant(value);
  if (Date.parse(parsed) > Date.parse(cutoff)) {
    throw new Error(`${label} exceeds the retained HPN knowledge cutoff.`);
  }
  return parsed;
}

/**
 * Locks and authenticates exact current selections requested for one prospective v5 input set.
 * Complete discrepancy coverage is independently checked by the v5 content contract.
 */
export async function loadAflTradeHpnStatisticalSelectionSet(
  transaction: AflOutcomeSqlTransaction,
  request: AflTradeHpnPavSeasonInputRequest,
  inputSet: AflTradeHpnPavSeasonInputSet,
  cutoff: string
) {
  const requested = request.reviewedStatisticalDecisions;
  if (!requested?.length) throw new Error('Statistical decision membership is required.');
  await transaction.query(`LOCK TABLE outcome_review_decision,outcome_provider_identity_assignment_head,
    outcome_provider_player_resolution_head,outcome_provider_match_resolution_head,
    outcome_provider_club_resolution_head,outcome_hpn_field_map_review_decision IN SHARE MODE`);
  await transaction.query('LOCK TABLE outcome_hpn_statistical_current_selection IN SHARE MODE');
  const result = await transaction.query<CurrentSelectionRow>(
    `SELECT head.scope_key,head.decision_id,head.support_review_id,head.revision,
            head.identity_json,head.applied_at,custody.decision_json,
            custody.registered_at AS decision_registered_at,
            support.registered_at AS support_registered_at,
            approval.decided_at AS approval_decided_at,
            outcome_hpn_statistical_selection_is_current(
              head.decision_id,head.support_review_id,head.identity_json) AS current
       FROM outcome_hpn_statistical_current_selection head
       JOIN outcome_hpn_statistical_decision_custody custody
         ON custody.decision_id=head.decision_id
       JOIN outcome_hpn_statistical_support_review support
         ON support.review_id=head.support_review_id AND support.decision_id=head.decision_id
       JOIN outcome_review_decision approval
         ON approval.decision_id=support.approval_decision_id
      WHERE head.decision_id=ANY($1::text[])
      ORDER BY head.scope_key
      FOR SHARE OF head,custody,support,approval`,
    [requested]
  );
  if (result.rows.length !== requested.length) {
    throw new Error('A requested statistical decision is not the exact current selection head.');
  }
  const requestedSet = new Set(requested);
  const decisions: AflTradeHpnStatisticalDecision[] = [];
  const membership = [];
  for (const row of result.rows) {
    const decision = aflTradeHpnStatisticalDecisionSchema.parse(row.decision_json);
    const scopeKey = createAflTradeContentAddress(
      'hpn-statistical-scope',
      decision.candidate.scope
    );
    if (
      !requestedSet.has(row.decision_id) ||
      row.current !== true ||
      row.decision_id !== decision.decisionId ||
      row.scope_key !== scopeKey ||
      decision.candidate.scope.environment !== inputSet.content.environment ||
      decision.candidate.scope.competitionId !== inputSet.content.competition ||
      decision.candidate.scope.season !== inputSet.content.seasonYear
    ) {
      throw new Error('Statistical selection does not match exact current input authority.');
    }
    requireBeforeCutoff(decision.candidate.createdAt, cutoff, 'Statistical candidate');
    requireBeforeCutoff(decision.decidedAt, cutoff, 'Statistical decision');
    requireBeforeCutoff(row.decision_registered_at, cutoff, 'Statistical decision custody');
    requireBeforeCutoff(row.support_registered_at, cutoff, 'Statistical support custody');
    requireBeforeCutoff(row.approval_decided_at, cutoff, 'Statistical support approval');
    const appliedAt = requireBeforeCutoff(row.applied_at, cutoff, 'Statistical selection');
    const source = await authenticateAflTradeHpnStatisticalSources(
      transaction,
      decision.candidate,
      { decisionId: decision.decisionId, reviewId: row.support_review_id }
    );
    if (canonicalizeAflTradeJson(source.identities) !== canonicalizeAflTradeJson(row.identity_json)) {
      throw new Error('Statistical selection identity authority changed.');
    }
    decisions.push(decision);
    membership.push({
      scopeKey,
      candidateId: decision.candidate.candidateId,
      decisionId: decision.decisionId,
      supportReviewId: row.support_review_id,
      revision: row.revision,
      appliedAt,
      identitySha256: sha256AflTradeCanonicalJson(row.identity_json),
    });
  }
  return createAflTradeHpnStatisticalSelectionSet(decisions, membership);
}
