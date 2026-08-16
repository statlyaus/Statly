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
      methodSelection: {
        state: 'authenticated',
        methodId: method.methodId,
        methodArtifact,
      },
      counts: { eligibleFields: 36, blockedFields: 0, totalFields: 36 },
      publicationEligible: false,
      publicationProhibited: true,
    });
  });

  it('reports raw presence separately from current factual review and never treats missing as zero', () => {
    const input = reportInput();
    const primary = input.sources.find(({ role }) => role === 'primary')!;
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
    const hitOuts = report.content.sources
      .find(({ role }) => role === 'primary')!
      .fields.find(({ semanticField }) => semanticField === 'hitOuts')!;

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
    prohibited.sources[2]!.fields = prohibited.sources[2]!.fields.map((assessment) =>
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
    expect(
      report.content.sources[2]!.fields.find(
        ({ semanticField }) => semanticField === 'inside50s'
      )
    ).toMatchObject({ state: 'blocked', blockers: ['source_use_not_permitted'] });
  });

  it('can seal an honest blocker report when a required source run does not exist', () => {
    const input = reportInput();
    input.sources[2] = {
      selectionState: 'missing',
      normalizationRunId: null,
      provider: null,
      inputKind: 'player_match_stats',
      role: 'corroborating',
      selectionEvidenceRefs: [ref('missing-corroborating-source')],
      fields: listAflTradeHpnRequiredSemanticFields('player_match_stats').map((name) =>
        field(name, {
          rawAvailability: {
            state: 'missing',
            evidenceRefs: [ref(`missing-raw:${name}`)],
          },
          fieldMapReview: {
            state: 'missing',
            evidenceRefs: [ref(`missing-map:${name}`)],
          },
          sourceUse: {
            state: 'unreviewed',
            evidenceRefs: [ref(`missing-rights:${name}`)],
          },
          factualReview: {
            state: 'missing',
            evidenceRefs: [ref(`missing-fact:${name}`)],
          },
          canonicalIdentity: {
            state: 'incomplete',
            evidenceRefs: [ref(`missing-identity:${name}`)],
          },
        })
      ),
    };

    const report = createAflTradeHpnCalculationEligibilityReport(input);
    expect(report.content).toMatchObject({
      state: 'blocked',
      counts: { totalFields: 36, eligibleFields: 21, blockedFields: 15 },
    });
    expect(report.content.sources[2]).toMatchObject({
      selectionState: 'missing',
      normalizationRunId: null,
      provider: null,
    });
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
