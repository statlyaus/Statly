import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  createAflTradeHpnCalculationEligibilityReport,
  listAflTradeHpnRequiredSemanticFields,
  type AflTradeHpnCalculationFieldAssessmentInput,
} from '@/server/aflTradeIntelligence/modeling/hpnCalculationEligibility';

const evaluatedAt = '2026-08-16T03:00:00.000Z';
const ref = (name: string) => createAflTradeCanonicalJsonArtifactRef({ name }, evaluatedAt);
const run = (character: string) => `provider-normalization-run:${character.repeat(64)}`;
const map = (character: string) => `hpn-pav-field-map:${character.repeat(64)}`;

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
    normalizationRunId: run(character),
    provider: `provider:${character}`,
    inputKind,
    role,
    fields: listAflTradeHpnRequiredSemanticFields(inputKind).map((name) => field(name)),
  };
}

function reportInput() {
  return {
    valuationScopeKey: 'workbook:2025',
    seasonYear: 2025,
    methodId: `hpn-pav-method:${'d'.repeat(64)}`,
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
});
