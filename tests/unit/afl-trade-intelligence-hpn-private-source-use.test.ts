import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createLocalAflTradeFiveSeasonAflTablesAuthority } from '@/server/aflTradeIntelligence/development/localFiveSeasonAflTablesAuthority';
import { assessAflTradeHpnPrivateCalculationSourceUse } from '@/server/aflTradeIntelligence/modeling/hpnPrivateCalculationSourceUse';
import { aflTradeSourceRightsProposalSchema } from '@/server/aflTradeIntelligence/source/sourceRights';
import {
  createAflTradePrivateReviewedEvidenceBundle,
  createAflTradePrivateReviewedEvidenceEvaluationAdmission,
  createAflTradePrivateReviewedEvidenceEvaluationDecision,
} from '@/server/aflTradeIntelligence/valuation/privateReviewedEvidenceEvaluation';

const evaluatedAt = '2026-08-16T05:00:00.000Z';

function rightsWith(input: {
  derived: 'allowed' | 'blocked';
  broad: boolean;
}) {
  const current = createLocalAflTradeFiveSeasonAflTablesAuthority(2025).capture.sourceRights;
  const content = {
    ...current.content,
    operations: {
      ...current.content.operations,
      model_training: input.broad ? ('allowed' as const) : ('blocked' as const),
      derived_feature_creation: input.derived,
      public_derived_output: input.broad ? ('allowed' as const) : ('blocked' as const),
      public_fact_display: input.broad ? ('allowed' as const) : ('blocked' as const),
    },
    redistribution: {
      ...current.content.redistribution,
      publicDerivedOutputPermitted: input.broad,
    },
    fields: current.content.fields.map((field) => ({
      ...field,
      uses: {
        ...field.uses,
        model_training: input.broad ? ('allowed' as const) : ('blocked' as const),
        derived_feature: input.derived,
        public_display: input.broad ? ('allowed' as const) : ('blocked' as const),
      },
    })),
  };
  return aflTradeSourceRightsProposalSchema.parse({
    rightsArtifactId: createAflTradeContentAddress('source-rights', content),
    content,
  });
}

function governedInput(rights: ReturnType<typeof rightsWith>) {
  const rightsArtifact = createAflTradeCanonicalJsonArtifactRef(
    rights,
    rights.content.proposedAt
  );
  const evidenceBundle = createAflTradePrivateReviewedEvidenceBundle({
    evidenceScopeKey: 'afl-player-match-reviewed-2021-2026',
    reviewSets: [
      {
        reviewSetId: '1'.repeat(64),
        reviewSetDecisionId: 'local-review-set:2025',
        reviewerId: 'local-reviewer',
        candidateCount: 1,
        decisionCount: 3,
        reviewSetArtifact: createAflTradeCanonicalJsonArtifactRef(
          { kind: 'review-set' },
          rights.content.proposedAt
        ),
      },
    ],
    sourceCaptures: [
      {
        captureId: 'capture:afl-tables:2025',
        provider: 'afl_tables',
        capabilityId: 'afl-tables-player-stats',
        seasonYear: 2025,
        sourceArtifact: createAflTradeCanonicalJsonArtifactRef(
          { kind: 'source-capture' },
          rights.content.proposedAt
        ),
      },
    ],
    sourceRightsEvidenceRefs: [rightsArtifact],
    createdAt: '2026-08-16T04:00:00.000Z',
  });
  const evidenceBundleArtifact = createAflTradeCanonicalJsonArtifactRef(
    evidenceBundle,
    evidenceBundle.content.createdAt
  );
  const decision = createAflTradePrivateReviewedEvidenceEvaluationDecision({
    status: 'authorized',
    valuationScopeKey: 'workbook:2025',
    evidenceBundle,
    evidenceBundleArtifact,
    revision: 1,
    supersedesDecisionId: null,
    reviewerId: 'local-reviewer',
    rationale: 'Private local calculation evaluation only.',
    decidedAt: '2026-08-16T04:30:00.000Z',
  });
  return {
    rights,
    rightsArtifact,
    evidenceBundle,
    admission: createAflTradePrivateReviewedEvidenceEvaluationAdmission(decision),
  };
}

describe('HPN private calculation source-use policy', () => {
  it('rejects the current retained rights because derived-feature use is blocked', () => {
    const input = governedInput(rightsWith({ derived: 'blocked', broad: false }));
    const assessment = assessAflTradeHpnPrivateCalculationSourceUse({
      ...input,
      competition: 'AFLM',
      seasonYear: 2025,
      sourceFields: ['Goals', 'Hit.Outs'],
      evaluatedAt,
    });

    expect(assessment.assessmentId).toMatch(
      /^hpn-private-source-use-assessment:[a-f0-9]{64}$/
    );
    expect(assessment.content).toMatchObject({
      state: 'not_permitted',
      reasons: ['derived_feature_operation_blocked', 'derived_source_field_blocked'],
      fields: [
        { sourceField: 'Goals', state: 'not_permitted' },
        { sourceField: 'Hit.Outs', state: 'not_permitted' },
      ],
    });
  });

  it('narrows obsolete overbroad base rights to the authorized private operation', () => {
    const input = governedInput(rightsWith({ derived: 'allowed', broad: true }));
    const assessment = assessAflTradeHpnPrivateCalculationSourceUse({
      ...input,
      competition: 'AFLM',
      seasonYear: 2025,
      sourceFields: ['Goals', 'Hit.Outs'],
      evaluatedAt,
    });

    expect(assessment.content).toMatchObject({
      state: 'permitted_private_calculation',
      reasons: [],
      effectiveRestriction: {
        mode: 'narrowed_private_evaluation',
        baseRightsArtifactId: input.rights.rightsArtifactId,
        evaluationDecisionId: input.admission.state === 'authorized'
          ? input.admission.authority.decisionId
          : '',
        operation: 'derived_feature_creation',
        modelTraining: 'blocked',
        publicDerivedOutput: 'blocked',
        publicFactDisplay: 'blocked',
        rawFieldRedistribution: 'blocked',
      },
    });
  });

  it('permits only narrow, current, private derived-field use from the exact reviewed bundle', () => {
    const input = governedInput(rightsWith({ derived: 'allowed', broad: false }));
    const assessment = assessAflTradeHpnPrivateCalculationSourceUse({
      ...input,
      competition: 'AFLM',
      seasonYear: 2025,
      sourceFields: ['Goals', 'Hit.Outs'],
      evaluatedAt,
    });

    expect(assessment.content).toMatchObject({
      state: 'permitted_private_calculation',
      reasons: [],
      fields: [
        { sourceField: 'Goals', state: 'permitted_private_calculation' },
        { sourceField: 'Hit.Outs', state: 'permitted_private_calculation' },
      ],
      publicationEligible: false,
      publicationProhibited: true,
      effectiveRestriction: null,
    });
  });

  it('fails closed when the private reviewed-evidence admission is absent', () => {
    const input = governedInput(rightsWith({ derived: 'allowed', broad: false }));
    const assessment = assessAflTradeHpnPrivateCalculationSourceUse({
      ...input,
      admission: { state: 'blocked', reason: 'withdrawn', decisionId: null },
      competition: 'AFLM',
      seasonYear: 2025,
      sourceFields: ['Goals'],
      evaluatedAt,
    });

    expect(assessment.content).toMatchObject({
      state: 'not_permitted',
      reasons: ['private_evaluation_not_authorized'],
    });
  });

  it('fails closed when the rights artifact is not an exact member of the reviewed bundle', () => {
    const input = governedInput(rightsWith({ derived: 'allowed', broad: false }));
    const assessment = assessAflTradeHpnPrivateCalculationSourceUse({
      ...input,
      rightsArtifact: createAflTradeCanonicalJsonArtifactRef(
        { kind: 'different-rights' },
        input.rights.content.proposedAt
      ),
      competition: 'AFLM',
      seasonYear: 2025,
      sourceFields: ['Goals'],
      evaluatedAt,
    });

    expect(assessment.content).toMatchObject({
      state: 'not_permitted',
      reasons: ['reviewed_evidence_not_exact'],
    });
  });

  it('fails closed outside the exact season scope or current rights term', () => {
    const input = governedInput(rightsWith({ derived: 'allowed', broad: false }));
    const outOfScope = assessAflTradeHpnPrivateCalculationSourceUse({
      ...input,
      competition: 'AFLM',
      seasonYear: 2030,
      sourceFields: ['Goals'],
      evaluatedAt,
    });
    const expired = assessAflTradeHpnPrivateCalculationSourceUse({
      ...input,
      competition: 'AFLM',
      seasonYear: 2025,
      sourceFields: ['Goals'],
      evaluatedAt: '2028-08-16T05:00:00.000Z',
    });

    expect(outOfScope.content.reasons).toEqual(['rights_scope_mismatch']);
    expect(expired.content.reasons).toEqual(['rights_not_current']);
  });

  it('reports an unregistered HPN source field instead of silently admitting it', () => {
    const input = governedInput(rightsWith({ derived: 'allowed', broad: false }));
    const assessment = assessAflTradeHpnPrivateCalculationSourceUse({
      ...input,
      competition: 'AFLM',
      seasonYear: 2025,
      sourceFields: ['Not.A.Real.Field'],
      evaluatedAt,
    });

    expect(assessment.content).toMatchObject({
      state: 'not_permitted',
      reasons: ['source_field_not_registered'],
      fields: [
        {
          sourceField: 'Not.A.Real.Field',
          state: 'not_permitted',
          reasons: ['source_field_not_registered'],
        },
      ],
    });
  });
});
