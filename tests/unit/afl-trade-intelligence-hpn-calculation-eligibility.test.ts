import {
  createAflTradeByteArtifactRef,
  createAflTradeCanonicalJsonArtifactRef,
} from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  createAflTradeHpnCalculationEligibilityReport,
  listAflTradeHpnRequiredSemanticFields,
  type AflTradeHpnCalculationFieldAssessmentInput,
} from '@/server/aflTradeIntelligence/modeling/hpnCalculationEligibility';
import { createAflTradeHpnPavMethod } from '@/server/aflTradeIntelligence/modeling/hpnPlayerApproximateValue';

const evaluatedAt = '2026-08-16T03:00:00.000Z';
const ref = (name: string) => createAflTradeCanonicalJsonArtifactRef({ name }, evaluatedAt);
const run = (character: string) => `provider-normalization-run:${character.repeat(64)}`;
const map = (character: string) => `hpn-pav-field-map:${character.repeat(64)}`;
const methodBytes = new TextEncoder().encode('<html>retained HPN method</html>');
const method = createAflTradeHpnPavMethod({
  sourceArtifact: createAflTradeByteArtifactRef(
    methodBytes,
    'text/html',
    '2026-08-16T02:00:00.000Z'
  ),
  sourceBytes: methodBytes,
  capturedAt: '2026-08-16T02:00:00.000Z',
});
const methodArtifact = createAflTradeCanonicalJsonArtifactRef(method, evaluatedAt);

function field(
  semanticField: string,
  overrides: Partial<AflTradeHpnCalculationFieldAssessmentInput> = {}
): AflTradeHpnCalculationFieldAssessmentInput {
  const identity = ['player', 'match', 'club', 'homeClub', 'awayClub'].includes(semanticField);
  return {
    semanticField: semanticField as AflTradeHpnCalculationFieldAssessmentInput['semanticField'],
    sourceFields: [semanticField],
    rawAvailability: { state: 'available', evidenceRefs: [ref(`raw:${semanticField}`)] },
    fieldMapReview: {
      state: 'current_approved',
      fieldMapId: map('c'),
      evidenceRefs: [ref(`map:${semanticField}`)],
    },
    sourceUse: {
      state: 'permitted_private_calculation',
      evidenceRefs: [ref(`rights:${semanticField}`)],
    },
    factualReview: {
      state: 'current_approved',
      evidenceRefs: [ref(`fact:${semanticField}`)],
    },
    canonicalIdentity: {
      state: identity ? 'current_approved' : 'not_applicable',
      evidenceRefs: [ref(`identity:${semanticField}`)],
    },
    ...overrides,
  };
}

function source(
  inputKind: 'completed_match_result' | 'player_match_stats',
  role: 'primary' | 'corroborating' | null,
  character: string
) {
  return {
    selectionState: 'selected' as const,
    normalizationRunId: run(character),
    provider: `provider:${character}`,
    inputKind,
    role,
    selectionEvidenceRefs: [ref(`selection:${character}`)],
    fields: listAflTradeHpnRequiredSemanticFields(inputKind).map((name) => field(name)),
  };
}

function reportInput() {
  return {
    valuationScopeKey: 'workbook:2025',
    seasonYear: 2025,
    method: { state: 'authenticated' as const, method, methodArtifact },
    authoritySnapshotArtifact: ref('authority-snapshot'),
    sources: [
      source('completed_match_result', null, '1'),
      source('player_match_stats', 'primary', '2'),
      source('player_match_stats', 'corroborating', '3'),
    ],
    evaluatedAt,
  };
}

describe('HPN calculation eligibility report', () => {
  it('content-addresses exact eligibility for every required field and source role', () => {
    const first = createAflTradeHpnCalculationEligibilityReport(reportInput());
    const second = createAflTradeHpnCalculationEligibilityReport({
      ...reportInput(),
      sources: [...reportInput().sources].reverse().map((item) => ({
        ...item,
        fields: [...item.fields].reverse(),
      })),
    });

    expect(first).toEqual(second);
    expect(first.reportId).toMatch(/^hpn-calculation-eligibility:[a-f0-9]{64}$/);
    expect(first.content).toMatchObject({
      state: 'eligible',
      blockers: [],
      evidenceProfile: {
        state: 'corroborated',
        limitations: [],
      },
      methodSelection: {
        state: 'authenticated',
        methodId: method.methodId,
        methodArtifact,
      },
      counts: {
        requiredFields: 21,
        blockedRequiredFields: 0,
        optionalFields: 15,
        blockedOptionalFields: 0,
        eligibleFields: 36,
        blockedFields: 0,
        totalFields: 36,
      },
      publicationEligible: false,
      publicationProhibited: true,
    });
  });

  it('reports raw presence separately from current factual review and never treats missing as zero', () => {
    const input = reportInput();
    const primary = input.sources.find(({ role }) => role === 'primary')!;
    if (primary.selectionState !== 'selected') {
      throw new Error('Expected a selected primary source fixture.');
    }
    primary.fields = primary.fields.map((assessment) =>
      assessment.semanticField === 'hitOuts'
        ? field('hitOuts', {
            factualReview: {
              state: 'missing',
              evidenceRefs: [ref('missing-hit-outs-review')],
            },
          })
        : assessment
    );
    const report = createAflTradeHpnCalculationEligibilityReport(input);
    const reportedPrimary = report.content.sources.find(({ role }) => role === 'primary')!;
    if (reportedPrimary.selectionState !== 'selected') {
      throw new Error('Expected a selected primary source report.');
    }
    const hitOuts = reportedPrimary.fields.find(
      ({ semanticField }) => semanticField === 'hitOuts'
    )!;

    expect(hitOuts).toMatchObject({
      rawAvailability: { state: 'available' },
      factualReview: { state: 'missing' },
      state: 'blocked',
      blockers: ['factual_review_not_current'],
    });
    expect(report.content).toMatchObject({
      state: 'blocked',
      counts: { eligibleFields: 35, blockedFields: 1, totalFields: 36 },
    });
  });

  it('requires exact required-field coverage and rejects a prohibited source use', () => {
    const incomplete = reportInput();
    incomplete.sources[1]!.fields = incomplete.sources[1]!.fields.filter(
      ({ semanticField }) => semanticField !== 'tackles'
    );
    expect(() => createAflTradeHpnCalculationEligibilityReport(incomplete)).toThrow(
      /every required HPN semantic field/i
    );

    const prohibited = reportInput();
    prohibited.sources[1]!.fields = prohibited.sources[1]!.fields.map((assessment) =>
      assessment.semanticField === 'inside50s'
        ? field('inside50s', {
            sourceUse: {
              state: 'not_permitted',
              evidenceRefs: [ref('inside-50-rights-blocker')],
            },
          })
        : assessment
    );
    const report = createAflTradeHpnCalculationEligibilityReport(prohibited);
    const primary = report.content.sources[1]!;
    if (primary.selectionState !== 'selected') {
      throw new Error('Expected a selected primary source report.');
    }
    expect(primary.fields.find(({ semanticField }) => semanticField === 'inside50s')).toMatchObject(
      { state: 'blocked', blockers: ['source_use_not_permitted'] }
    );
  });

  it('keeps an explicitly limited single-source private calculation reviewable when corroboration is absent', () => {
    const input = reportInput();

    const report = createAflTradeHpnCalculationEligibilityReport({
      ...input,
      sources: [
        input.sources[0]!,
        input.sources[1]!,
        {
          selectionState: 'missing',
          normalizationRunId: null,
          provider: null,
          inputKind: 'player_match_stats',
          role: 'corroborating',
          selectionEvidenceRefs: [ref('missing-corroborating-source')],
        },
      ],
    });
    expect(report.content).toMatchObject({
      state: 'eligible',
      blockers: [],
      evidenceProfile: {
        state: 'single_source',
        limitations: ['no_independent_player_stats_corroboration'],
      },
      counts: {
        requiredFields: 21,
        blockedRequiredFields: 0,
        optionalFields: 0,
        blockedOptionalFields: 0,
        totalFields: 21,
        eligibleFields: 21,
        blockedFields: 0,
      },
    });
    expect(report.content.sources[2]).toMatchObject({
      selectionState: 'missing',
      normalizationRunId: null,
      provider: null,
    });
    expect(report.content.sources[2]).not.toHaveProperty('fields');
  });

  it('blocks when a required primary source is absent', () => {
    const input = reportInput();

    const report = createAflTradeHpnCalculationEligibilityReport({
      ...input,
      sources: [
        input.sources[0]!,
        {
          selectionState: 'missing',
          normalizationRunId: null,
          provider: null,
          inputKind: 'player_match_stats',
          role: 'primary',
          selectionEvidenceRefs: [ref('missing-primary-source')],
        },
        input.sources[2]!,
      ],
    });
    expect(report.content).toMatchObject({
      state: 'blocked',
      blockers: ['required_source_missing'],
      evidenceProfile: {
        state: 'single_source',
        limitations: ['no_independent_player_stats_corroboration'],
      },
      counts: {
        requiredFields: 6,
        blockedRequiredFields: 0,
        optionalFields: 15,
        blockedOptionalFields: 0,
      },
    });
  });

  it('does not overstate same-provider or partially unusable corroboration', () => {
    const sameProvider = reportInput();
    sameProvider.sources[2]!.provider = sameProvider.sources[1]!.provider;
    const sameProviderReport = createAflTradeHpnCalculationEligibilityReport(sameProvider);

    expect(sameProviderReport.content).toMatchObject({
      state: 'eligible',
      evidenceProfile: {
        state: 'single_source',
        limitations: ['no_independent_player_stats_corroboration'],
      },
    });

    const blockedOptional = reportInput();
    blockedOptional.sources[2]!.fields = blockedOptional.sources[2]!.fields.map((assessment) =>
      assessment.semanticField === 'tackles'
        ? field('tackles', {
            factualReview: {
              state: 'disputed',
              evidenceRefs: [ref('disputed-corroborating-tackles')],
            },
          })
        : assessment
    );
    const blockedOptionalReport = createAflTradeHpnCalculationEligibilityReport(blockedOptional);

    expect(blockedOptionalReport.content).toMatchObject({
      state: 'eligible',
      evidenceProfile: {
        state: 'single_source',
        limitations: ['no_independent_player_stats_corroboration'],
      },
      counts: {
        blockedRequiredFields: 0,
        blockedOptionalFields: 1,
        blockedFields: 1,
      },
    });
  });

  it('allows one retained normalization run to back distinct result and player projections', () => {
    const input = reportInput();
    input.sources[1]!.normalizationRunId = input.sources[0]!.normalizationRunId;
    input.sources[1]!.provider = input.sources[0]!.provider;

    const report = createAflTradeHpnCalculationEligibilityReport(input);

    expect(report.content).toMatchObject({
      state: 'eligible',
      evidenceProfile: { state: 'corroborated' },
    });
    expect(report.content.sources.slice(0, 2).map((source) => source.normalizationRunId)).toEqual([
      input.sources[0]!.normalizationRunId,
      input.sources[0]!.normalizationRunId,
    ]);
  });

  it('seals a blocked report when the HPN method is not authenticated', () => {
    const input = {
      ...reportInput(),
      method: {
        state: 'missing' as const,
        evidenceRefs: [ref('missing-method')],
      },
    };
    const report = createAflTradeHpnCalculationEligibilityReport(input);

    expect(report.content).toMatchObject({
      state: 'blocked',
      blockers: ['method_not_authenticated'],
      methodSelection: { state: 'missing', methodId: null },
      counts: { totalFields: 36, eligibleFields: 36, blockedFields: 0 },
    });
  });
});
