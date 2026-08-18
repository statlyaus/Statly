import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createLocalAflTradeFiveSeasonAflTablesAuthority } from '@/server/aflTradeIntelligence/development/localFiveSeasonAflTablesAuthority';
import {
  createLocalAflTradeHpnCompletedResultFieldMapCandidate,
  createLocalAflTradeHpnPlayerFieldMapCandidate,
} from '@/server/aflTradeIntelligence/development/localHpnFieldMapCandidates';
import { approveLocalAflTradeHpnFieldMapCandidates } from '@/server/aflTradeIntelligence/development/localHpnFieldMapReview';
import { listAflTradeHpnCandidateSourceFields } from '@/server/aflTradeIntelligence/modeling/hpnFieldMapCandidate';
import type { AflTradeHpnPrivateCalculationSourceUseAssessment } from '@/server/aflTradeIntelligence/modeling/hpnPrivateCalculationSourceUse';

const reviewedAt = '2026-08-16T05:00:00.000Z';

function fixture() {
  const decodeMap = createLocalAflTradeFiveSeasonAflTablesAuthority(2025).fieldMap;
  const decodeMapArtifact = createAflTradeCanonicalJsonArtifactRef(decodeMap, reviewedAt);
  const candidates = [
    createLocalAflTradeHpnCompletedResultFieldMapCandidate({
      seasonYear: 2025,
      providerDecodeMap: decodeMap,
      providerDecodeMapArtifact: decodeMapArtifact,
      createdAt: reviewedAt,
    }),
    createLocalAflTradeHpnPlayerFieldMapCandidate({
      provider: 'afl_tables',
      seasonYear: 2025,
      providerDecodeMap: decodeMap,
      providerDecodeMapArtifact: decodeMapArtifact,
      createdAt: reviewedAt,
    }),
  ];
  const assessments = candidates.map((candidate) => {
    const sourceFields = [
      ...new Set(
        candidate.content.semanticBindings.flatMap(listAflTradeHpnCandidateSourceFields)
      ),
    ].sort();
    const content = {
        schemaVersion: 'afl-trade-hpn-private-source-use-assessment/v1',
        environment: 'non_production',
        purpose: 'private_confirmed_realized_hpn_pav',
        competition: 'AFLM',
        seasonYear: 2025,
        valuationScopeKey: 'workbook:2025',
        evaluationDecisionId: 'private-reviewed-evaluation-decision:fixture',
        state: 'permitted_private_calculation',
        rightsArtifactId: `artifact:${'1'.repeat(64)}`,
        evidenceBundleId: 'private-reviewed-evidence:fixture',
        fields: sourceFields.map((sourceField) => ({
          sourceField,
          state: 'permitted_private_calculation' as const,
          reasons: [],
        })),
        reasons: [],
        evidenceRefs: [],
        evaluatedAt: reviewedAt,
        publicationEligible: false,
        publicationProhibited: true,
    };
    return {
      assessmentId: createAflTradeContentAddress(
        'hpn-private-source-use-assessment',
        content
      ),
      content,
    } as AflTradeHpnPrivateCalculationSourceUseAssessment;
  });
  return {
    candidates: candidates.map((candidate) => ({
      seasonYear: 2025,
      candidate,
      artifact: createAflTradeCanonicalJsonArtifactRef(candidate, reviewedAt),
    })),
    assessments: assessments.map((assessment) => ({
      seasonYear: 2025,
      assessment,
      artifact: createAflTradeCanonicalJsonArtifactRef(assessment, reviewedAt),
    })),
  };
}

describe('local HPN field-map review', () => {
  it('approves each exact candidate only after its complete source-field set is permitted', async () => {
    const registered: unknown[] = [];
    const input = fixture();
    const result = await approveLocalAflTradeHpnFieldMapCandidates(
      {
        ...input,
        reviewerId: 'local-hpn-field-map-reviewer',
        reviewedAt,
      },
      {
        registerApprovedProjection: async (registration) => {
          registered.push(registration);
          return registration.projectedFieldMap;
        },
      }
    );

    expect(result).toHaveLength(2);
    expect(registered).toHaveLength(2);
    expect(result.map(({ map }) => map.content.inputKind).sort()).toEqual([
      'completed_match_result',
      'player_match_stats',
    ]);
    expect(result.every(({ decision }) =>
      decision.content.decision === 'approved' && decision.content.publicationProhibited
    )).toBe(true);
  });

  it('rejects a source field that lacks private-calculation permission', async () => {
    const input = fixture();
    const first = input.assessments[0]!;
    const assessments = [
      {
        ...first,
        assessment: {
          ...first.assessment,
          content: {
            ...first.assessment.content,
            state: 'not_permitted' as const,
            fields: first.assessment.content.fields.map((field, index) =>
              index === 0 ? { ...field, state: 'not_permitted' as const } : field
            ),
          },
        },
      },
      input.assessments[1]!,
    ];

    await expect(
      approveLocalAflTradeHpnFieldMapCandidates(
        { ...input, assessments, reviewerId: 'local-reviewer', reviewedAt },
        { registerApprovedProjection: async (registration) => registration.projectedFieldMap }
      )
    ).rejects.toThrow(/permitted source-field assessment/i);
  });
});
