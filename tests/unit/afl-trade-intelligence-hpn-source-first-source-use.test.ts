import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createLocalAflTradeFiveSeasonAflTablesAuthority } from '@/server/aflTradeIntelligence/development/localFiveSeasonAflTablesAuthority';
import { assessAflTradeHpnSourceFirstCalculationSourceUse } from '@/server/aflTradeIntelligence/modeling/hpnPrivateCalculationSourceUse';
import { createLocalAflTradeHpnCompletedResultFieldMapCandidate } from '@/server/aflTradeIntelligence/development/localHpnFieldMapCandidates';
import { listAflTradeHpnCandidateSourceFields } from '@/server/aflTradeIntelligence/modeling/hpnFieldMapCandidate';
import {
  createAflTradeHpnFieldMapReviewDecision,
  createAflTradeHpnProjectedFieldMap,
} from '@/server/aflTradeIntelligence/modeling/hpnProjectedFieldMap';

function permittedInput() {
  const authority = createLocalAflTradeFiveSeasonAflTablesAuthority(2025);
  const rights = authority.capture.sourceRights;
  const at = '2026-08-16T05:00:00.000Z';
  const decodeRef = createAflTradeCanonicalJsonArtifactRef(authority.fieldMap, at);
  const candidate = createLocalAflTradeHpnCompletedResultFieldMapCandidate({
    seasonYear: 2025,
    providerDecodeMap: authority.fieldMap,
    providerDecodeMapArtifact: decodeRef,
    createdAt: at,
  });
  const input = {
    rights,
    rightsArtifact: createAflTradeCanonicalJsonArtifactRef(rights, at),
    competition: 'AFLM',
    seasonYear: 2025,
    valuationScopeKey: 'afl-men:2025-trades',
    sourceFields: [
      ...new Set(candidate.content.semanticBindings.flatMap(listAflTradeHpnCandidateSourceFields)),
    ],
    evaluatedAt: at,
    source: {
      captureId: `source-capture:${'1'.repeat(64)}`,
      sourceSnapshotId: `source-snapshot:${'2'.repeat(64)}`,
      sourceArtifact: createAflTradeCanonicalJsonArtifactRef({ synthetic: 'raw source' }, at),
      normalizationRunId: `provider-normalization-run:${'3'.repeat(64)}`,
      normalizationFinalizationSha256: '4'.repeat(64),
      providerDecodeMapId: authority.fieldMap.mapId,
      providerDecodeMapSha256: decodeRef.contentSha256,
      sourceSchemaSha256: candidate.content.sourceSchemaSha256,
      gateDecisionId: `gate-decision:${'7'.repeat(64)}`,
      gateProposalId: `gate-proposal:${'8'.repeat(64)}`,
      gateDecisionKey: 'synthetic-source-first',
    },
  };
  return { candidate, input, at };
}

it('pairs exact source-first assessment with review v3 while preserving projected map v1', () => {
  const { candidate, input, at } = permittedInput();
  const sourceUseAssessment = assessAflTradeHpnSourceFirstCalculationSourceUse(input);
  expect(sourceUseAssessment.content.state).toBe('permitted_private_calculation');
  const candidateArtifact = createAflTradeCanonicalJsonArtifactRef(candidate, at);
  const decision = createAflTradeHpnFieldMapReviewDecision({
    candidate,
    candidateArtifact,
    sourceUseAssessment,
    sourceUseAssessmentArtifact: createAflTradeCanonicalJsonArtifactRef(sourceUseAssessment, at),
    decision: 'approved',
    reviewerId: 'synthetic-reviewer',
    rationale: 'Synthetic source-first schema proof only.',
    decidedAt: at,
  });
  expect(decision.content.schemaVersion).toBe('afl-trade-hpn-field-map-review-decision/v3');
  const map = createAflTradeHpnProjectedFieldMap({
    candidate,
    candidateArtifact,
    decision,
    decisionArtifact: createAflTradeCanonicalJsonArtifactRef(decision, at),
  });
  expect(map.content.schemaVersion).toBe('afl-trade-hpn-projected-field-map/v1');
});

it.each(['providerDecodeMapId', 'providerDecodeMapSha256', 'sourceSchemaSha256'] as const)(
  'rejects a source-first assessment transplanted from another %s',
  (field) => {
    const { candidate, input, at } = permittedInput();
    input.source[field] = field === 'providerDecodeMapId' ? 'another-decode-map' : 'a'.repeat(64);
    const sourceUseAssessment = assessAflTradeHpnSourceFirstCalculationSourceUse(input);
    expect(() =>
      createAflTradeHpnFieldMapReviewDecision({
        candidate,
        candidateArtifact: createAflTradeCanonicalJsonArtifactRef(candidate, at),
        sourceUseAssessment,
        sourceUseAssessmentArtifact: createAflTradeCanonicalJsonArtifactRef(
          sourceUseAssessment,
          at
        ),
        decision: 'approved',
        reviewerId: 'synthetic-reviewer',
        rationale: 'Synthetic negative.',
        decidedAt: at,
      })
    ).toThrow('exact source decoder');
  }
);

it('rejects future evidence and duplicate source fields', () => {
  const { input } = permittedInput();
  expect(() =>
    assessAflTradeHpnSourceFirstCalculationSourceUse({
      ...input,
      evaluatedAt: '2026-08-16T04:00:00.000Z',
    })
  ).toThrow('before assessment');
  expect(() =>
    assessAflTradeHpnSourceFirstCalculationSourceUse({ ...input, sourceFields: ['Goals', 'Goals'] })
  ).toThrow('unique canonical');
});

it('does not assess a rights proposal before it was proposed, even with a backdated artifact reference', () => {
  const { input } = permittedInput();
  const content = { ...input.rights.content, proposedAt: '2026-08-16T05:01:00.000Z' };
  const rights = {
    content,
    rightsArtifactId: createAflTradeContentAddress('source-rights', content),
  };
  const assessment = assessAflTradeHpnSourceFirstCalculationSourceUse({
    ...input,
    rights,
    rightsArtifact: createAflTradeCanonicalJsonArtifactRef(rights, input.evaluatedAt),
  });
  expect(assessment.content.state).toBe('not_permitted');
  expect(assessment.content.reasons).toContain('rights_not_current');
});

it('does not promote archive-only source rights into source-first HPN calculation permission', () => {
  const base = createLocalAflTradeFiveSeasonAflTablesAuthority(2025).capture.sourceRights;
  const content = {
    ...base.content,
    operations: { ...base.content.operations, derived_feature_creation: 'blocked' as const },
    fields: base.content.fields.map((field) => ({
      ...field,
      uses: { ...field.uses, derived_feature: 'blocked' as const },
    })),
  };
  const rights = {
    content,
    rightsArtifactId: createAflTradeContentAddress('source-rights', content),
  };
  const assessment = assessAflTradeHpnSourceFirstCalculationSourceUse({
    rights,
    rightsArtifact: createAflTradeCanonicalJsonArtifactRef(rights, rights.content.proposedAt),
    competition: 'AFLM',
    seasonYear: 2025,
    valuationScopeKey: 'afl-men:2025-trades',
    sourceFields: ['Goals'],
    evaluatedAt: '2026-08-16T05:00:00.000Z',
    source: {
      captureId: `source-capture:${'1'.repeat(64)}`,
      sourceSnapshotId: `source-snapshot:${'2'.repeat(64)}`,
      sourceArtifact: createAflTradeCanonicalJsonArtifactRef(
        { synthetic: 'raw source' },
        rights.content.proposedAt
      ),
      normalizationRunId: `provider-normalization-run:${'3'.repeat(64)}`,
      normalizationFinalizationSha256: '4'.repeat(64),
      providerDecodeMapId: 'synthetic-decode-map',
      providerDecodeMapSha256: '5'.repeat(64),
      sourceSchemaSha256: '6'.repeat(64),
      gateDecisionId: `gate-decision:${'7'.repeat(64)}`,
      gateProposalId: `gate-proposal:${'8'.repeat(64)}`,
      gateDecisionKey: 'synthetic-source-first',
    },
  });
  expect(assessment.content.schemaVersion).toBe('afl-trade-hpn-private-source-use-assessment/v2');
  expect(assessment.content.state).toBe('not_permitted');
  expect(assessment.content.reasons).toContain('derived_feature_operation_blocked');
  expect(assessment.content.reasons).toContain('derived_source_field_blocked');
});
