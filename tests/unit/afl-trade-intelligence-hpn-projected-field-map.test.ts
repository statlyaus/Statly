import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createLocalAflTradeFiveSeasonAflTablesAuthority } from '@/server/aflTradeIntelligence/development/localFiveSeasonAflTablesAuthority';
import {
  createLocalAflTradeHpnCompletedResultFieldMapCandidate,
  createLocalAflTradeHpnPlayerFieldMapCandidate,
} from '@/server/aflTradeIntelligence/development/localHpnFieldMapCandidates';
import { listAflTradeHpnCandidateSourceFields } from '@/server/aflTradeIntelligence/modeling/hpnFieldMapCandidate';
import {
  createAflTradeHpnFieldMapReviewDecision,
  createAflTradeHpnProjectedFieldMap,
} from '@/server/aflTradeIntelligence/modeling/hpnProjectedFieldMap';

const candidateAt = '2026-08-16T04:00:00.000Z';
const decidedAt = '2026-08-16T05:00:00.000Z';

function candidates() {
  const providerDecodeMap = createLocalAflTradeFiveSeasonAflTablesAuthority(2025).fieldMap;
  const providerDecodeMapArtifact = createAflTradeCanonicalJsonArtifactRef(
    providerDecodeMap,
    candidateAt
  );
  return [
    createLocalAflTradeHpnCompletedResultFieldMapCandidate({
      seasonYear: 2025,
      providerDecodeMap,
      providerDecodeMapArtifact,
      createdAt: candidateAt,
    }),
    createLocalAflTradeHpnPlayerFieldMapCandidate({
      provider: 'afl_tables',
      seasonYear: 2025,
      providerDecodeMap,
      providerDecodeMapArtifact,
      createdAt: candidateAt,
    }),
  ];
}

function sourceUseEvidence(candidate: ReturnType<typeof candidates>[number]) {
  const content = {
    schemaVersion: 'afl-trade-hpn-private-source-use-assessment/v1' as const,
    environment: 'non_production' as const,
    purpose: 'private_confirmed_realized_hpn_pav' as const,
    competition: 'AFLM',
    seasonYear: 2025,
    valuationScopeKey: 'workbook:2025',
    evaluationDecisionId: 'private-reviewed-evaluation-decision:fixture',
    state: 'permitted_private_calculation' as const,
    rightsArtifactId: `artifact:${'1'.repeat(64)}`,
    evidenceBundleId: 'private-reviewed-evidence:fixture',
    fields: [...new Set(
      candidate.content.semanticBindings.flatMap(listAflTradeHpnCandidateSourceFields)
    )].sort().map((sourceField) => ({
      sourceField,
      state: 'permitted_private_calculation' as const,
      reasons: [],
    })),
    reasons: [],
    evidenceRefs: [],
    evaluatedAt: candidateAt,
    publicationEligible: false as const,
    publicationProhibited: true as const,
  };
  const sourceUseAssessment = {
    assessmentId: createAflTradeContentAddress(
      'hpn-private-source-use-assessment',
      content
    ),
    content,
  };
  return {
    sourceUseAssessment,
    sourceUseAssessmentArtifact: createAflTradeCanonicalJsonArtifactRef(
      sourceUseAssessment,
      candidateAt
    ),
  };
}

describe('HPN candidate-first projected field-map approval', () => {
  it.each(candidates())(
    'binds an exact approved candidate without circular map identity',
    (candidate) => {
      const candidateArtifact = createAflTradeCanonicalJsonArtifactRef(
        candidate,
        candidateAt
      );
      const decision = createAflTradeHpnFieldMapReviewDecision({
        candidate,
        candidateArtifact,
        ...sourceUseEvidence(candidate),
        decision: 'approved',
        reviewerId: 'local-hpn-field-map-reviewer',
        rationale:
          'Approve the exact reviewed projection only for private non-production HPN calculation.',
        decidedAt,
      });
      const decisionArtifact = createAflTradeCanonicalJsonArtifactRef(decision, decidedAt);
      const map = createAflTradeHpnProjectedFieldMap({
        candidate,
        candidateArtifact,
        decision,
        decisionArtifact,
      });

      expect(decision.decisionId).toMatch(/^hpn-field-map-review-decision:[a-f0-9]{64}$/);
      expect(map.fieldMapId).toMatch(/^hpn-pav-field-map:[a-f0-9]{64}$/);
      expect(map.content).toMatchObject({
        schemaVersion: 'afl-trade-hpn-projected-field-map/v1',
        candidateId: candidate.candidateId,
        approvalDecisionId: decision.decisionId,
        inputKind: candidate.content.inputKind,
        publicationEligible: false,
        publicationProhibited: true,
      });
      expect(decision.content).not.toHaveProperty('fieldMapId');
    }
  );

  it('rejects a denied decision or inexact candidate custody', () => {
    const candidate = candidates()[0]!;
    const candidateArtifact = createAflTradeCanonicalJsonArtifactRef(
      candidate,
      candidateAt
    );
    const rejected = createAflTradeHpnFieldMapReviewDecision({
      candidate,
      candidateArtifact,
      ...sourceUseEvidence(candidate),
      decision: 'rejected',
      reviewerId: 'local-hpn-field-map-reviewer',
      rationale: 'Reject this exact candidate.',
      decidedAt,
    });
    expect(() =>
      createAflTradeHpnProjectedFieldMap({
        candidate,
        candidateArtifact,
        decision: rejected,
        decisionArtifact: createAflTradeCanonicalJsonArtifactRef(rejected, decidedAt),
      })
    ).toThrow(/approved review decision/i);

    expect(() =>
      createAflTradeHpnFieldMapReviewDecision({
        candidate,
        candidateArtifact: createAflTradeCanonicalJsonArtifactRef(
          { not: 'the candidate' },
          candidateAt
        ),
        ...sourceUseEvidence(candidate),
        decision: 'approved',
        reviewerId: 'local-hpn-field-map-reviewer',
        rationale: 'Invalid custody.',
        decidedAt,
      })
    ).toThrow(/exact candidate artifact/i);
  });
});
