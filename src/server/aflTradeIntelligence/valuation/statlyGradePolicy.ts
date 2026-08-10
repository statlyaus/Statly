import {
  aflTradeValueResultSchema,
  aflTradeValueSummarySchema,
  type AflTradeValueSummary,
} from '@/types/aflTradeIntelligence';

export const AFL_TRADE_STATLY_GRADES = ['A+', 'A', 'B+', 'B', 'C+', 'C', 'D'] as const;

export type AflTradeStatlyGrade = (typeof AFL_TRADE_STATLY_GRADES)[number];
export type AflTradeStatlyGradeState = 'graded' | 'provisional' | 'unavailable';

export interface AflTradeStatlyClubGrade {
  aflClubId: string;
  clubName: string;
  grade: AflTradeStatlyGrade | null;
  state: AflTradeStatlyGradeState;
  normalizedPerformance: number | null;
  finishesAheadProbability: number | null;
}

export interface AflTradeStatlyGradeResult {
  view: AflTradeValueSummary['view'];
  state: AflTradeStatlyGradeState;
  reasonCode:
    | 'complete_valuation'
    | 'partial_valuation'
    | 'low_confidence'
    | 'stale_valuation'
    | 'previous_calculation_retained'
    | 'development_preview'
    | 'insufficient_grade_coverage'
    | 'valuation_not_available';
  coverageRatio: number | null;
  practicalEquivalenceProbability: number | null;
  clubs: readonly AflTradeStatlyClubGrade[];
}

export const AFL_TRADE_STATLY_GRADE_POLICY = Object.freeze({
  schemaVersion: 'afl-trade-statly-grade-policy/v1' as const,
  minimumCoverageRatio: 0.7,
  baseline: 'equal_finish_probability_adjusted_for_party_count' as const,
  practicalEquivalenceTreatment: 'condition_on_non_equivalent_outcome' as const,
  sourceRecordedGradeTreatment: 'prohibited' as const,
  sourceExpectedActualTreatment: 'prohibited' as const,
  thresholds: Object.freeze([
    { grade: 'A+' as const, minimum: 0.85 },
    { grade: 'A' as const, minimum: 0.72 },
    { grade: 'B+' as const, minimum: 0.6 },
    { grade: 'B' as const, minimum: 0.45 },
    { grade: 'C+' as const, minimum: 0.32 },
    { grade: 'C' as const, minimum: 0.2 },
    { grade: 'D' as const, minimum: 0 },
  ]),
});

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function normalizedPerformance({
  clubProbability,
  clubCount,
  practicalEquivalenceProbability,
}: {
  clubProbability: number;
  clubCount: number;
  practicalEquivalenceProbability: number;
}): number {
  const competitiveProbability = 1 - practicalEquivalenceProbability;
  const equalBaseline = 1 / clubCount;
  if (competitiveProbability <= Number.EPSILON) {
    return 0.5;
  }

  const conditionalProbability = clampUnit(clubProbability / competitiveProbability);
  if (conditionalProbability >= equalBaseline) {
    return clampUnit(0.5 + (0.5 * (conditionalProbability - equalBaseline)) / (1 - equalBaseline));
  }
  return clampUnit((0.5 * conditionalProbability) / equalBaseline);
}

function letterGrade(performance: number): AflTradeStatlyGrade {
  return (
    AFL_TRADE_STATLY_GRADE_POLICY.thresholds.find(
      ({ minimum }) => performance + Number.EPSILON >= minimum
    )?.grade ?? 'D'
  );
}

function numericalState({
  availability,
  confidenceLevel,
  coverageRatio,
  coverageStatus,
  developmentPreview,
}: {
  availability: 'available' | 'available_partial' | 'stale' | 'failed_previous_available';
  confidenceLevel: 'low' | 'moderate' | 'high';
  coverageRatio: number;
  coverageStatus: 'complete' | 'partial';
  developmentPreview: boolean;
}): {
  state: AflTradeStatlyGradeState;
  reasonCode: AflTradeStatlyGradeResult['reasonCode'];
} {
  if (coverageRatio < AFL_TRADE_STATLY_GRADE_POLICY.minimumCoverageRatio) {
    return { state: 'unavailable', reasonCode: 'insufficient_grade_coverage' };
  }
  if (developmentPreview) {
    return { state: 'provisional', reasonCode: 'development_preview' };
  }
  if (availability === 'stale') {
    return { state: 'provisional', reasonCode: 'stale_valuation' };
  }
  if (availability === 'failed_previous_available') {
    return { state: 'provisional', reasonCode: 'previous_calculation_retained' };
  }
  if (coverageStatus === 'partial' || availability === 'available_partial') {
    return { state: 'provisional', reasonCode: 'partial_valuation' };
  }
  if (confidenceLevel === 'low') {
    return { state: 'provisional', reasonCode: 'low_confidence' };
  }
  return { state: 'graded', reasonCode: 'complete_valuation' };
}

function unavailableGradeResult(view: AflTradeValueSummary['view']): AflTradeStatlyGradeResult {
  return Object.freeze({
    view,
    state: 'unavailable',
    reasonCode: 'valuation_not_available',
    coverageRatio: null,
    practicalEquivalenceProbability: null,
    clubs: Object.freeze([]),
  });
}

function deriveNumericalGrades({
  availability,
  clubs,
  confidenceLevel,
  coverageRatio,
  coverageStatus,
  developmentPreview,
  practicalEquivalenceProbability,
  view,
}: {
  availability: 'available' | 'available_partial' | 'stale' | 'failed_previous_available';
  clubs: readonly {
    aflClubId: string;
    clubName: string;
    finishesAheadProbability: number;
  }[];
  confidenceLevel: 'low' | 'moderate' | 'high';
  coverageRatio: number;
  coverageStatus: 'complete' | 'partial';
  developmentPreview: boolean;
  practicalEquivalenceProbability: number;
  view: AflTradeValueSummary['view'];
}): AflTradeStatlyGradeResult {
  const { state, reasonCode } = numericalState({
    availability,
    confidenceLevel,
    coverageRatio,
    coverageStatus,
    developmentPreview,
  });
  const clubGrades = clubs.map((club) => {
    if (state === 'unavailable') {
      return Object.freeze({
        aflClubId: club.aflClubId,
        clubName: club.clubName,
        grade: null,
        state,
        normalizedPerformance: null,
        finishesAheadProbability: club.finishesAheadProbability,
      });
    }
    const performance = normalizedPerformance({
      clubProbability: club.finishesAheadProbability,
      clubCount: clubs.length,
      practicalEquivalenceProbability,
    });
    return Object.freeze({
      aflClubId: club.aflClubId,
      clubName: club.clubName,
      grade: letterGrade(performance),
      state,
      normalizedPerformance: performance,
      finishesAheadProbability: club.finishesAheadProbability,
    });
  });

  return Object.freeze({
    view,
    state,
    reasonCode,
    coverageRatio,
    practicalEquivalenceProbability,
    clubs: Object.freeze(clubGrades),
  });
}

export function deriveAflTradeStatlyGrades(input: unknown): AflTradeStatlyGradeResult {
  const summary = aflTradeValueSummarySchema.parse(input);
  if (!('clubValues' in summary)) {
    return unavailableGradeResult(summary.view);
  }

  return deriveNumericalGrades({
    availability: summary.availability,
    clubs: summary.clubValues,
    confidenceLevel: summary.confidence.level,
    coverageRatio: summary.coverage.coverageRatio,
    coverageStatus: summary.coverage.status,
    developmentPreview: summary.warnings.some(
      ({ code }) => code === 'development-workbook-preview'
    ),
    practicalEquivalenceProbability: summary.practicalEquivalenceProbability,
    view: summary.view,
  });
}

export function deriveAflTradeStatlyGradesFromDetail(input: unknown): AflTradeStatlyGradeResult {
  const value = aflTradeValueResultSchema.parse(input);
  if (!('clubValues' in value)) {
    return unavailableGradeResult(value.view);
  }

  const probabilities = new Map(
    value.comparison.probabilities.map((entry) => [entry.aflClubId, entry.finishesAhead] as const)
  );
  return deriveNumericalGrades({
    availability: value.availability,
    clubs: value.clubValues.map((club) => ({
      aflClubId: club.aflClubId,
      clubName: club.clubName,
      finishesAheadProbability: probabilities.get(club.aflClubId) ?? 0,
    })),
    confidenceLevel: value.confidence.level,
    coverageRatio: value.coverage.coverageRatio,
    coverageStatus: value.coverage.excludedAssetCount === 0 ? 'complete' : 'partial',
    developmentPreview: value.warnings.some(({ code }) => code === 'development-workbook-preview'),
    practicalEquivalenceProbability: value.comparison.practicalEquivalenceProbability,
    view: value.view,
  });
}
