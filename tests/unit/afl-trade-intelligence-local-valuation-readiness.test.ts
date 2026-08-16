import { describe, expect, it } from 'vitest';

import { inspectLocalAflTradeValuationReadiness } from '@/server/aflTradeIntelligence/development/localAflTradeValuationReadiness';
import {
  createAflTradePrivateReviewedEvidenceBundle,
  createAflTradePrivateReviewedEvidenceEvaluationDecision,
} from '@/server/aflTradeIntelligence/valuation/privateReviewedEvidenceEvaluation';
import { createAflTradePrivateValuationEvaluationDecision } from '@/server/aflTradeIntelligence/valuation/privateValuationEvaluationDecision';

const digest = (character: string) => character.repeat(64);

function artifact(character: string) {
  const contentSha256 = digest(character);
  return {
    artifactId: `artifact:${contentSha256}`,
    contentSha256,
    storageUri: `artifact://sha256/${contentSha256}`,
    mediaType: 'application/json',
    byteLength: 128,
    createdAt: '2026-08-16T01:00:00.000Z',
  };
}

const noReviewedEvidence = {
  reviewed_evaluation_decision_id: null,
  reviewed_evaluation_status: null,
  reviewed_evaluation_decided_at: null,
  reviewed_evaluation_decision_json: null,
  reviewed_evidence_bundle_id: null,
  reviewed_evidence_bundle_json: null,
  reviewed_evidence_current: null,
  reviewed_candidate_count: null,
  reviewed_decision_count: null,
  reviewed_source_capture_count: null,
  reviewed_source_rights_count: null,
};

describe('local AFL trade valuation readiness', () => {
  it('reports the latest exact qualification and its bound blocker set', async () => {
    const readiness = await inspectLocalAflTradeValuationReadiness(
      {
        query: async () => ({
          rows: [
            {
              qualification_report_id: `valuation-source-qualification:${'b'.repeat(64)}`,
              factual_release_id: `outcome-release:${'c'.repeat(64)}`,
              decision_state: 'blocked',
              evaluated_at: '2026-08-15T02:00:00.000Z',
              source_ids: ['afl-tables-five-season', 'official-afl-2026'],
              prepared_input_set_id: `prepared-valuation-input-set:${'a'.repeat(64)}`,
              private_evaluation_decision_id: null,
              private_evaluation_status: null,
              private_evaluation_decided_at: null,
              private_evaluation_decision_json: null,
              ...noReviewedEvidence,
            },
          ],
        }),
      },
      {
        scopeKey: 'afl-men:2025-trades',
      }
    );

    expect(readiness).toMatchObject({
      state: 'blocked',
      numericalCalculationsAvailable: false,
      preparedInputSetCreated: true,
      preparedInputSetCount: 1,
      scopeKey: 'afl-men:2025-trades',
      qualificationReportCreated: true,
      qualificationReportId: `valuation-source-qualification:${'b'.repeat(64)}`,
      factualReleaseId: `outcome-release:${'c'.repeat(64)}`,
      blockerCodes: ['source_blocked', 'private_evaluation_not_authorized'],
      privateEvaluationAuthorityState: 'not_authorized',
      requiredNextAuthority: 'private_nonproduction_derived_calculation_authority',
    });
    expect(readiness.sources).toHaveLength(2);
    expect(readiness.preparedInputSetIds).toHaveLength(1);
  });

  it('does not reconstruct a source decision when no durable qualification exists', async () => {
    const readiness = await inspectLocalAflTradeValuationReadiness(
      { query: async () => ({ rows: [] }) },
      { scopeKey: 'afl-men:2025-trades' }
    );

    expect(readiness).toMatchObject({
      state: 'blocked',
      numericalCalculationsAvailable: false,
      qualificationReportCreated: false,
      preparedInputSetCreated: false,
      blockerCodes: ['source_qualification_not_run', 'private_evaluation_not_authorized'],
      privateEvaluationAuthorityState: 'not_authorized',
      requiredNextAuthority: 'private_nonproduction_derived_calculation_authority',
    });
  });

  it('reports exact current private authority while keeping numerical inputs blocked', async () => {
    const decision = createAflTradePrivateValuationEvaluationDecision({
      status: 'authorized',
      valuationScopeKey: 'afl-men:2025-trades',
      factualReleaseScopeKey: 'public-afl-draft-trade-outcomes',
      factualReleaseId: `outcome-release:${digest('c')}`,
      factualReleaseArtifact: artifact('1'),
      releaseMembershipArtifact: artifact('2'),
      sourceRightsEvidenceRefs: [artifact('3')],
      revision: 1,
      supersedesDecisionId: null,
      reviewerId: 'local-factual-release-owner',
      rationale: 'Authorize private evaluation.',
      decidedAt: '2026-08-16T02:00:00.000Z',
    });
    const readiness = await inspectLocalAflTradeValuationReadiness(
      {
        query: async () => ({
          rows: [
            {
              qualification_report_id: null,
              factual_release_id: `outcome-release:${'c'.repeat(64)}`,
              decision_state: null,
              evaluated_at: null,
              source_ids: [],
              prepared_input_set_id: null,
              private_evaluation_decision_id: decision.decisionId,
              private_evaluation_status: 'authorized',
              private_evaluation_decided_at: '2026-08-16T02:00:00.000Z',
              private_evaluation_decision_json: decision,
              ...noReviewedEvidence,
            },
          ],
        }),
      },
      { scopeKey: 'afl-men:2025-trades' }
    );

    expect(readiness).toMatchObject({
      state: 'blocked',
      numericalCalculationsAvailable: false,
      privateEvaluationAuthorityState: 'authorized',
      privateEvaluationDecisionId: decision.decisionId,
      blockerCodes: ['model_not_approved'],
      requiredNextAuthority: 'authenticated_private_calculation_inputs',
    });
  });

  it('authenticates the current retained-review lane without inventing factual-release ancestry', async () => {
    const bundle = createAflTradePrivateReviewedEvidenceBundle({
      evidenceScopeKey: 'afl-player-match-reviewed-2021-2026',
      reviewSets: [
        {
          reviewSetId: digest('4'),
          reviewSetDecisionId: 'review-set-decision:historical',
          reviewerId: 'local-reviewer:historical',
          candidateCount: 48_769,
          decisionCount: 146_307,
          reviewSetArtifact: artifact('5'),
        },
        {
          reviewSetId: digest('6'),
          reviewSetDecisionId: 'review-set-decision:official',
          reviewerId: 'local-reviewer:official',
          candidateCount: 12,
          decisionCount: 36,
          reviewSetArtifact: artifact('7'),
        },
      ],
      sourceCaptures: [
        {
          captureId: 'capture:historical',
          provider: 'afl-tables',
          capabilityId: 'player-match-statistics',
          seasonYear: 2021,
          sourceArtifact: artifact('8'),
        },
      ],
      sourceRightsEvidenceRefs: [artifact('9')],
      createdAt: '2026-08-16T03:00:00.000Z',
    });
    const decision = createAflTradePrivateReviewedEvidenceEvaluationDecision({
      status: 'authorized',
      valuationScopeKey: 'afl-men:2025-trades',
      evidenceBundle: bundle,
      evidenceBundleArtifact: artifact('a'),
      revision: 1,
      supersedesDecisionId: null,
      reviewerId: 'local-factual-release-owner',
      rationale: 'Authorize retained reviewed evidence for private calculation only.',
      decidedAt: '2026-08-16T04:00:00.000Z',
    });

    const readiness = await inspectLocalAflTradeValuationReadiness(
      {
        query: async () => ({
          rows: [
            {
              qualification_report_id: null,
              factual_release_id: null,
              decision_state: null,
              evaluated_at: null,
              source_ids: [],
              prepared_input_set_id: null,
              private_evaluation_decision_id: null,
              private_evaluation_status: null,
              private_evaluation_decided_at: null,
              private_evaluation_decision_json: null,
              reviewed_evaluation_decision_id: decision.decisionId,
              reviewed_evaluation_status: 'authorized',
              reviewed_evaluation_decided_at: decision.content.decidedAt,
              reviewed_evaluation_decision_json: decision,
              reviewed_evidence_bundle_id: bundle.evidenceBundleId,
              reviewed_evidence_bundle_json: bundle,
              reviewed_evidence_current: true,
              reviewed_candidate_count: 48_781,
              reviewed_decision_count: 146_343,
              reviewed_source_capture_count: 1,
              reviewed_source_rights_count: 1,
            },
          ],
        }),
      },
      { scopeKey: 'afl-men:2025-trades' }
    );

    expect(readiness).toMatchObject({
      state: 'blocked',
      numericalCalculationsAvailable: false,
      factualReleaseId: null,
      privateEvaluationAuthorityState: 'authorized',
      privateEvaluationEvidenceKind: 'retained_private_review',
      privateEvaluationDecisionId: decision.decisionId,
      privateEvaluationEvidenceBundleId: bundle.evidenceBundleId,
      retainedEvidenceCandidateCount: 48_781,
      retainedEvidenceDecisionCount: 146_343,
      blockerCodes: ['model_not_approved'],
      requiredNextAuthority: 'authenticated_private_calculation_inputs',
    });
  });
});
