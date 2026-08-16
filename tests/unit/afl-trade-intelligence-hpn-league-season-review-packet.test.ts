import {
  createAflTradeByteArtifactRef,
  createAflTradeCanonicalJsonArtifactRef,
} from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  createAflTradeHpnCalculationEligibilityReport,
  listAflTradeHpnRequiredSemanticFields,
  type AflTradeHpnCalculationFieldAssessmentInput,
} from '@/server/aflTradeIntelligence/modeling/hpnCalculationEligibility';
import { createAflTradeHpnLeagueSeasonReviewPacket } from '@/server/aflTradeIntelligence/modeling/hpnLeagueSeasonReviewPacket';
import { createAflTradeHpnPavMethod } from '@/server/aflTradeIntelligence/modeling/hpnPlayerApproximateValue';

const evaluatedAt = '2026-08-16T03:00:00.000Z';
const createdAt = '2026-08-16T04:00:00.000Z';
const ref = (name: string, at = evaluatedAt) =>
  createAflTradeCanonicalJsonArtifactRef({ name }, at);
const run = (season: number, character: string) =>
  `provider-normalization-run:${season.toString(16).padStart(4, character).slice(-4)}${character.repeat(60)}`;
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
const authenticatedMethod = { state: 'authenticated' as const, method, methodArtifact };

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
      evidenceRefs: [ref(`source-use:${semanticField}`)],
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

function selectedSource(
  seasonYear: number,
  inputKind: 'completed_match_result' | 'player_match_stats',
  role: 'primary' | 'corroborating' | null,
  character: string
) {
  return {
    selectionState: 'selected' as const,
    normalizationRunId: run(seasonYear, character),
    provider: `provider:${character}`,
    inputKind,
    role,
    selectionEvidenceRefs: [ref(`selection:${seasonYear}:${character}`)],
    fields: listAflTradeHpnRequiredSemanticFields(inputKind).map((name) => field(name)),
  };
}

function report(
  seasonYear: number,
  missingCorroborating = false,
  selectedMethod:
    | typeof authenticatedMethod
    | { readonly state: 'missing'; readonly evidenceRefs: readonly ReturnType<typeof ref>[] } =
    authenticatedMethod
) {
  const corroborating = missingCorroborating
    ? {
      selectionState: 'missing',
      normalizationRunId: null,
      provider: null,
      inputKind: 'player_match_stats',
      role: 'corroborating',
      selectionEvidenceRefs: [ref(`missing-selection:${seasonYear}`)],
    } as const
    : selectedSource(seasonYear, 'player_match_stats', 'corroborating', '3');
  const sources = [
    selectedSource(seasonYear, 'completed_match_result', null, '1'),
    selectedSource(seasonYear, 'player_match_stats', 'primary', '2'),
    corroborating,
  ];
  return createAflTradeHpnCalculationEligibilityReport({
    valuationScopeKey: 'workbook:2025',
    seasonYear,
    method: selectedMethod,
    authoritySnapshotArtifact: ref(`authority:${seasonYear}`),
    sources,
    evaluatedAt,
  });
}

function binding(seasonYear: number, missingCorroborating = false) {
  const eligibilityReport = report(seasonYear, missingCorroborating);
  return {
    eligibilityReport,
    eligibilityReportArtifact: createAflTradeCanonicalJsonArtifactRef(
      eligibilityReport,
      evaluatedAt
    ),
  };
}

describe('HPN league-season review packet', () => {
  it('content-addresses complete season coverage and honest blocker totals', () => {
    const first = createAflTradeHpnLeagueSeasonReviewPacket({
      valuationScopeKey: 'workbook:2025',
      fromSeason: 2024,
      throughSeason: 2025,
      reports: [binding(2025, true), binding(2024)],
      createdAt,
    });
    const second = createAflTradeHpnLeagueSeasonReviewPacket({
      valuationScopeKey: 'workbook:2025',
      fromSeason: 2024,
      throughSeason: 2025,
      reports: [binding(2024), binding(2025, true)],
      createdAt,
    });

    expect(first).toEqual(second);
    expect(first.packetId).toMatch(/^hpn-league-season-review-packet:[a-f0-9]{64}$/);
    expect(first.content).toMatchObject({
      state: 'ready_for_human_review',
      methodSelection: {
        state: 'authenticated',
        methodId: method.methodId,
        methodArtifact,
      },
      counts: {
        seasonCount: 2,
        eligibleSeasons: 2,
        blockedSeasons: 0,
        corroboratedSeasons: 1,
        singleSourceSeasons: 1,
        sourceSlots: 6,
        missingSourceSlots: 1,
        totalFields: 57,
        eligibleFields: 57,
        blockedFields: 0,
      },
      missingSources: [
        { seasonYear: 2025, slot: 'corroborating_player_stats' },
      ],
      reviewDisposition: 'requires_human_decision',
      publicationEligible: false,
      publicationProhibited: true,
    });
  });

  it('rejects a partial season range or duplicate season report', () => {
    expect(() =>
      createAflTradeHpnLeagueSeasonReviewPacket({
        valuationScopeKey: 'workbook:2025',
        fromSeason: 2024,
        throughSeason: 2025,
        reports: [binding(2024)],
        createdAt,
      })
    ).toThrow(/every requested season exactly once/i);
    expect(() =>
      createAflTradeHpnLeagueSeasonReviewPacket({
        valuationScopeKey: 'workbook:2025',
        fromSeason: 2024,
        throughSeason: 2025,
        reports: [binding(2024), binding(2024)],
        createdAt,
      })
    ).toThrow(/every requested season exactly once/i);
  });

  it('rejects a report whose immutable artifact or ancestry does not match', () => {
    const reportBinding = binding(2024);
    expect(() =>
      createAflTradeHpnLeagueSeasonReviewPacket({
        valuationScopeKey: 'workbook:2025',
        fromSeason: 2024,
        throughSeason: 2024,
        reports: [
          {
            ...reportBinding,
            eligibilityReportArtifact: ref('not-the-report'),
          },
        ],
        createdAt,
      })
    ).toThrow(/exact eligibility-report artifact/i);
    expect(() =>
      createAflTradeHpnLeagueSeasonReviewPacket({
        valuationScopeKey: 'another-scope',
        fromSeason: 2024,
        throughSeason: 2024,
        reports: [reportBinding],
        createdAt,
      })
    ).toThrow(/scope and method ancestry/i);
  });

  it('seals one shared missing-method blocker and rejects mixed method ancestry', () => {
    const missingMethod = {
      state: 'missing' as const,
      evidenceRefs: [ref('missing-method')],
    };
    const missingBindings = [2024, 2025].map((seasonYear) => {
      const eligibilityReport = report(seasonYear, false, missingMethod);
      return {
        eligibilityReport,
        eligibilityReportArtifact: createAflTradeCanonicalJsonArtifactRef(
          eligibilityReport,
          evaluatedAt
        ),
      };
    });
    const packet = createAflTradeHpnLeagueSeasonReviewPacket({
      valuationScopeKey: 'workbook:2025',
      fromSeason: 2024,
      throughSeason: 2025,
      reports: missingBindings,
      createdAt,
    });

    expect(packet.content).toMatchObject({
      state: 'blocked',
      methodSelection: { state: 'missing', methodId: null },
      blockerCounts: [{ blocker: 'method_not_authenticated', count: 2 }],
      counts: { eligibleSeasons: 0, blockedSeasons: 2 },
    });
    expect(() =>
      createAflTradeHpnLeagueSeasonReviewPacket({
        valuationScopeKey: 'workbook:2025',
        fromSeason: 2024,
        throughSeason: 2025,
        reports: [binding(2024), missingBindings[1]!],
        createdAt,
      })
    ).toThrow(/scope and method ancestry/i);
  });
});
