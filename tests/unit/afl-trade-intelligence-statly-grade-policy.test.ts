// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  deriveAflTradeStatlyGrades,
  deriveAflTradeStatlyGradesFromProbabilities,
  type AflTradeStatlyGradeResult,
} from '@/server/aflTradeIntelligence/valuation/statlyGradePolicy';
import type { AflTradeValueSummary } from '@/types/aflTradeIntelligence';

const CONFIDENCE_DIMENSIONS = [
  'model_calibration',
  'data_coverage',
  'identity',
  'lineage',
  'source_freshness',
] as const;

function valueSummary({
  probabilities,
  practicalEquivalenceProbability = 0.1,
  availability = 'available',
  coverageRatio = 1,
  confidence = 'high',
  developmentPreview = false,
  view = 'current',
}: {
  probabilities: readonly number[];
  practicalEquivalenceProbability?: number;
  availability?: 'available' | 'available_partial' | 'stale';
  coverageRatio?: number;
  confidence?: 'low' | 'moderate' | 'high';
  developmentPreview?: boolean;
  view?: 'at_trade' | 'realized' | 'remaining' | 'current';
}): AflTradeValueSummary {
  const clubs = probabilities.map((probability, index) => ({
    aflClubId: `afl-club:${index + 1}`,
    clubName: `Club ${index + 1}`,
    expectedValue: 50 + index,
    medianValue: 50 + index,
    interval: { lower: 40 + index, upper: 60 + index, level: 0.8 },
    finishesAheadProbability: probability,
  }));
  const completeCoverage = { status: 'complete', coverageRatio: 1, excludedAssetCount: 0 } as const;
  const partialCoverage = {
    status: 'partial',
    coverageRatio,
    excludedAssetCount: 1,
  } as const;
  const favouredClub = clubs.reduce((leader, club) =>
    club.finishesAheadProbability > leader.finishesAheadProbability ? club : leader
  );
  const assessment = probabilities.every((probability) => probability === probabilities[0])
    ? ({
        interpretation: 'balanced_within_uncertainty',
        favouredAflClubId: null,
        scope: coverageRatio === 1 ? 'complete_trade' : 'included_assets_only',
      } as const)
    : ({
        interpretation: 'strongly_leans_to_club',
        favouredAflClubId: favouredClub.aflClubId,
        scope: coverageRatio === 1 ? 'complete_trade' : 'included_assets_only',
      } as const);

  const common = {
    view,
    modelVintage: view === 'at_trade' ? ('original_vintage' as const) : ('current' as const),
    unit: {
      id: 'statly-football-value-v1',
      label: 'Statly football value',
      description: 'A public AFL football-contribution value unit.',
      direction: 'higher_is_better' as const,
    },
    clubValues: clubs,
    practicalEquivalenceProbability,
    comparisonBasis:
      coverageRatio === 1 ? ('complete_trade' as const) : ('included_assets_only' as const),
    assessment,
    confidence: {
      level: confidence,
      dimensions: CONFIDENCE_DIMENSIONS.map((kind) => ({
        kind,
        level: confidence,
        reasonCode: `test:${kind}`,
        explanation: `Test evidence for ${kind}.`,
      })),
    },
    methodologyHref: '/draft/trades/methodology',
    warnings: developmentPreview
      ? [
          {
            code: 'development-workbook-preview',
            message: 'Development-only workbook result.',
            severity: 'warning' as const,
          },
        ]
      : [],
  };

  if (availability === 'available') {
    return { ...common, availability, coverage: completeCoverage };
  }
  if (availability === 'stale') {
    return {
      ...common,
      availability,
      coverage: coverageRatio === 1 ? completeCoverage : partialCoverage,
      reasonCode: 'test:stale',
      message: 'The calculation is stale.',
      nextAction: null,
      warnings: [
        {
          code: 'test:stale',
          message: 'The calculation is stale.',
          severity: 'warning',
        },
      ],
      staleSince: '2026-08-08T00:00:00.000Z',
    };
  }
  return {
    ...common,
    availability,
    coverage: partialCoverage,
    reasonCode: 'test:partial',
    message: 'Some assets are excluded.',
    nextAction: null,
    warnings: [
      {
        code: 'test:partial',
        message: 'Some assets are excluded.',
        severity: 'warning',
      },
    ],
  };
}

function clubGrades(result: AflTradeStatlyGradeResult) {
  return result.clubs.map(({ aflClubId, grade, state }) => ({ aflClubId, grade, state }));
}

describe('Statly AFL trade grade policy', () => {
  it('grades an even two-club trade as B for both clubs', () => {
    const result = deriveAflTradeStatlyGrades(
      valueSummary({ probabilities: [0.45, 0.45], practicalEquivalenceProbability: 0.1 })
    );

    expect(clubGrades(result)).toEqual([
      { aflClubId: 'afl-club:1', grade: 'B', state: 'graded' },
      { aflClubId: 'afl-club:2', grade: 'B', state: 'graded' },
    ]);
  });

  it('awards A+ only to a decisively superior side and D to the trailing side', () => {
    const result = deriveAflTradeStatlyGrades(
      valueSummary({ probabilities: [0.765, 0.135], practicalEquivalenceProbability: 0.1 })
    );

    expect(clubGrades(result)).toEqual([
      { aflClubId: 'afl-club:1', grade: 'A+', state: 'graded' },
      { aflClubId: 'afl-club:2', grade: 'D', state: 'graded' },
    ]);
  });

  it('normalizes the fair baseline for the number of clubs', () => {
    const threeClub = deriveAflTradeStatlyGrades(
      valueSummary({ probabilities: [0.3, 0.3, 0.3], practicalEquivalenceProbability: 0.1 })
    );
    const twoClub = deriveAflTradeStatlyGrades(
      valueSummary({ probabilities: [0.3, 0.6], practicalEquivalenceProbability: 0.1 })
    );

    expect(threeClub.clubs.map(({ grade }) => grade)).toEqual(['B', 'B', 'B']);
    expect(twoClub.clubs[0]?.grade).toBe('C+');
  });

  it('marks sufficiently covered partial calculations as provisional', () => {
    const result = deriveAflTradeStatlyGrades(
      valueSummary({
        probabilities: [0.63, 0.27],
        practicalEquivalenceProbability: 0.1,
        availability: 'available_partial',
        coverageRatio: 0.85,
        confidence: 'moderate',
      })
    );

    expect(result.state).toBe('provisional');
    expect(
      result.clubs.every(({ state, grade }) => state === 'provisional' && grade !== null)
    ).toBe(true);
  });

  it('withholds grades when valued asset coverage is below the policy floor', () => {
    const result = deriveAflTradeStatlyGrades(
      valueSummary({
        probabilities: [0.63, 0.27],
        practicalEquivalenceProbability: 0.1,
        availability: 'available_partial',
        coverageRatio: 0.5,
        confidence: 'low',
      })
    );

    expect(result.state).toBe('unavailable');
    expect(result.reasonCode).toBe('insufficient_grade_coverage');
    expect(
      result.clubs.every(({ grade, state }) => grade === null && state === 'unavailable')
    ).toBe(true);
  });

  it('marks stale numerical calculations as provisional rather than final', () => {
    const result = deriveAflTradeStatlyGrades(
      valueSummary({ probabilities: [0.54, 0.36], availability: 'stale' })
    );

    expect(result.state).toBe('provisional');
    expect(result.reasonCode).toBe('stale_valuation');
  });

  it('keeps publication-ineligible workbook previews provisional', () => {
    const result = deriveAflTradeStatlyGrades(
      valueSummary({ probabilities: [0.765, 0.135], developmentPreview: true })
    );

    expect(result.state).toBe('provisional');
    expect(result.reasonCode).toBe('development_preview');
    expect(
      result.clubs.every(({ state, grade }) => state === 'provisional' && grade !== null)
    ).toBe(true);
  });

  it('grades an authenticated package-probability projection without requiring a public response shape', () => {
    const result = deriveAflTradeStatlyGradesFromProbabilities({
      view: 'current',
      availability: 'available',
      clubs: [
        {
          aflClubId: 'afl-club:adelaide',
          clubName: 'Adelaide',
          finishesAheadProbability: 0.9,
        },
        {
          aflClubId: 'afl-club:st-kilda',
          clubName: 'St Kilda',
          finishesAheadProbability: 0.1,
        },
      ],
      confidenceLevel: 'high',
      coverageRatio: 1,
      coverageStatus: 'complete',
      developmentPreview: true,
      practicalEquivalenceProbability: 0,
    });

    expect(result).toMatchObject({
      view: 'current',
      state: 'provisional',
      reasonCode: 'development_preview',
      clubs: [
        { aflClubId: 'afl-club:adelaide', grade: 'A+', state: 'provisional' },
        { aflClubId: 'afl-club:st-kilda', grade: 'D', state: 'provisional' },
      ],
    });
  });

  it('rejects malformed or non-exhaustive package probabilities at the shared policy seam', () => {
    expect(() =>
      deriveAflTradeStatlyGradesFromProbabilities({
        view: 'current',
        availability: 'available',
        clubs: [
          {
            aflClubId: 'afl-club:adelaide',
            clubName: 'Adelaide',
            finishesAheadProbability: Number.NaN,
          },
          {
            aflClubId: 'afl-club:adelaide',
            clubName: 'Adelaide duplicate',
            finishesAheadProbability: 0.1,
          },
        ],
        confidenceLevel: 'high',
        coverageRatio: 1,
        coverageStatus: 'complete',
        developmentPreview: true,
        practicalEquivalenceProbability: 0,
      })
    ).toThrow();

    expect(() =>
      deriveAflTradeStatlyGradesFromProbabilities({
        view: 'current',
        availability: 'available',
        clubs: [
          {
            aflClubId: 'afl-club:adelaide',
            clubName: 'Adelaide',
            finishesAheadProbability: 0.6,
          },
          {
            aflClubId: 'afl-club:st-kilda',
            clubName: 'St Kilda',
            finishesAheadProbability: 0.3,
          },
        ],
        confidenceLevel: 'high',
        coverageRatio: 1,
        coverageStatus: 'complete',
        developmentPreview: true,
        practicalEquivalenceProbability: 0,
      })
    ).toThrow('probabilities must exhaust unit mass');
  });

  it('rejects contradictory coverage status and ratios at the shared policy seam', () => {
    const common = {
      view: 'current' as const,
      availability: 'available' as const,
      clubs: [
        {
          aflClubId: 'afl-club:adelaide',
          clubName: 'Adelaide',
          finishesAheadProbability: 0.5,
        },
        {
          aflClubId: 'afl-club:st-kilda',
          clubName: 'St Kilda',
          finishesAheadProbability: 0.5,
        },
      ],
      confidenceLevel: 'high' as const,
      developmentPreview: false,
      practicalEquivalenceProbability: 0,
    };

    expect(() =>
      deriveAflTradeStatlyGradesFromProbabilities({
        ...common,
        coverageRatio: 0.8,
        coverageStatus: 'complete',
      })
    ).toThrow('Complete coverage requires ratio 1');
    expect(() =>
      deriveAflTradeStatlyGradesFromProbabilities({
        ...common,
        coverageRatio: 1,
        coverageStatus: 'partial',
      })
    ).toThrow('partial coverage requires a ratio below 1');
  });

  it('returns no club grades when no numerical valuation exists', () => {
    const result = deriveAflTradeStatlyGrades({
      view: 'current',
      availability: 'not_calculated',
      modelVintage: null,
      temporalContext: null,
      reasonCode: 'no-active-publication',
      message: 'No active publication is available.',
      nextAction: null,
      methodologyHref: '/draft/trades/methodology',
      warnings: [],
    });

    expect(result).toMatchObject({
      view: 'current',
      state: 'unavailable',
      reasonCode: 'valuation_not_available',
      clubs: [],
    });
  });

  it('rejects injected legacy fields rather than treating them as grade evidence', () => {
    const summary = valueSummary({ probabilities: [0.45, 0.45] });

    expect(() =>
      deriveAflTradeStatlyGrades({
        ...summary,
        legacyExpected: 80,
        legacyActual: 90,
      })
    ).toThrow();
  });
});
