import { z } from 'zod';
import { createAflTradeContentAddress } from '../artifacts/contentAddress';

const POINT_ARITHMETIC_TOLERANCE = 8 * Number.EPSILON;
const horizons = ['annual_1', 'annual_2', 'annual_3', 'cumulative_3'] as const;
const score = z.number().finite().nonnegative();
const probability = z.number().finite().min(0).max(1);
const pair = z.object({ candidate: score, baseline: score }).strict();
const interval = (bound: z.ZodNumber) =>
  z
    .object({ lower: bound, upper: bound })
    .strict()
    .refine((value) => value.lower <= value.upper, 'Interval bounds must be ordered.');
const orderedHorizons = <T extends { horizon: string }>(rows: T[]) =>
  rows.every((row, index) => row.horizon === horizons[index]);
const inputSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-native-pav-acceptance-input/v1'),
    cumulativeCrps: pair.nullable(),
    horizons: z
      .array(
        z
          .object({
            horizon: z.enum(horizons),
            coverage: probability.nullable(),
            mae: pair.nullable(),
          })
          .strict()
      )
      .length(4)
      .refine(orderedHorizons, 'Exactly four canonical horizons required.'),
    precision: z
      .object({
        jointConfidence: z.literal(0.95),
        scope: z.literal('simultaneous_all_nine_criteria'),
        methodReference: z.string().regex(/^artifact:[a-f0-9]{64}$/),
        improvement: interval(z.number().finite().max(1)).nullable(),
        horizons: z
          .array(
            z
              .object({
                horizon: z.enum(horizons),
                coverage: interval(probability).nullable(),
                maeRatio: interval(score).nullable(),
              })
              .strict()
          )
          .length(4)
          .refine(orderedHorizons, 'Exactly four canonical precision horizons required.'),
      })
      .strict()
      .nullable(),
  })
  .strict();

/** Retain through existing protocol artifact custody; creation supplies no review or run authority. */
export function createAflTradeNativePavAcceptanceCriteria() {
  const content = {
    schemaVersion: 'afl-trade-native-pav-acceptance-criteria/v1' as const,
    target: 'three_season_receiving_spell_pav' as const,
    primaryMetric: 'cumulative_crps' as const,
    weighting: 'equal_observation_exact_paired_support' as const,
    minimumRelativeImprovement: 0.05,
    nominalIntervalCoverage: 0.8,
    acceptableCoverage: { lower: 0.75, upper: 0.85 },
    maximumMaeRatio: 1.05,
    jointConfidence: 0.95,
    precisionScope: 'simultaneous_all_nine_criteria' as const,
    horizons: [...horizons],
    zeroReference: 'inconclusive' as const,
    pointArithmeticTolerance: POINT_ARITHMETIC_TOLERANCE,
    pointToleranceScale: 'max_one_absolute_estimate' as const,
    qualificationGranted: false as const,
  };
  return {
    criteriaId: createAflTradeContentAddress('native-pav-acceptance-criteria', content),
    content,
  };
}

type Status = 'pass' | 'fail' | 'inconclusive';
type Criterion = {
  criterion: string;
  status: Status;
  reason:
    | 'within_tolerance'
    | 'outside_tolerance'
    | 'overlaps_tolerance'
    | 'precision_unestablished'
    | 'score_unavailable'
    | 'zero_reference'
    | 'point_outside_tolerance';
  estimate: number | null;
  rawScores: { candidate: number; baseline: number } | null;
};

function compare(
  criterion: string,
  estimate: number | null,
  bounds: { lower: number; upper: number } | null | undefined,
  lower: number,
  upper: number,
  unavailableReason: 'score_unavailable' | 'zero_reference' = 'score_unavailable',
  rawScores: { candidate: number; baseline: number } | null = null
): Criterion {
  const evidence = { criterion, estimate, rawScores };
  if (estimate === null) return { ...evidence, status: 'inconclusive', reason: unavailableReason };
  if (!Number.isFinite(estimate)) throw new RangeError('Acceptance arithmetic must remain finite.');
  if (!bounds) return { ...evidence, status: 'inconclusive', reason: 'precision_unestablished' };
  // Roundoff allowance applies only to derived ratios, never supplied confidence bounds.
  const tolerance = rawScores ? POINT_ARITHMETIC_TOLERANCE * Math.max(1, Math.abs(estimate)) : 0;
  if (
    bounds.lower >= lower &&
    bounds.upper <= upper &&
    (estimate < lower - tolerance || estimate > upper + tolerance)
  )
    return { ...evidence, status: 'inconclusive', reason: 'point_outside_tolerance' };
  if (bounds.lower >= lower && bounds.upper <= upper)
    return { ...evidence, status: 'pass', reason: 'within_tolerance' };
  if (bounds.upper < lower || bounds.lower > upper)
    return { ...evidence, status: 'fail', reason: 'outside_tolerance' };
  return { ...evidence, status: 'inconclusive', reason: 'overlaps_tolerance' };
}

/**
 * Conditional numerical assessment of caller-supplied summaries and simultaneous bounds only.
 * Does not estimate confidence, authenticate method/report custody or certify joint coverage.
 * Callers must authenticate exact paired support, nominal coverage, baseline selection, method
 * review and final-run identity before using this diagnostic in the existing qualification review.
 */
export function assessAflTradeNativePavAcceptance(unparsed: unknown) {
  const input = inputSchema.parse(unparsed);
  const definition = createAflTradeNativePavAcceptanceCriteria();
  const policy = definition.content;
  const crps = input.cumulativeCrps;
  const criteria: Criterion[] = [
    compare(
      'cumulative_crps_improvement',
      crps && crps.baseline > 0 ? 1 - crps.candidate / crps.baseline : null,
      input.precision?.improvement,
      policy.minimumRelativeImprovement,
      1,
      crps?.baseline === 0 ? 'zero_reference' : 'score_unavailable',
      crps
    ),
  ];
  input.horizons.forEach((row, index) => {
    const precision = input.precision?.horizons[index];
    criteria.push(
      compare(
        `${row.horizon}_coverage`,
        row.coverage,
        precision?.coverage,
        policy.acceptableCoverage.lower,
        policy.acceptableCoverage.upper
      )
    );
    criteria.push(
      compare(
        `${row.horizon}_mae_ratio`,
        row.mae && row.mae.baseline > 0 ? row.mae.candidate / row.mae.baseline : null,
        precision?.maeRatio,
        0,
        policy.maximumMaeRatio,
        row.mae?.baseline === 0 ? 'zero_reference' : 'score_unavailable',
        row.mae
      )
    );
  });
  const status: Status = criteria.some((criterion) => criterion.status === 'fail')
    ? 'fail'
    : criteria.some((criterion) => criterion.status === 'inconclusive')
      ? 'inconclusive'
      : 'pass';
  return {
    criteriaId: definition.criteriaId,
    authorityBoundary: 'conditional_numerical_assessment_no_method_or_model_approval' as const,
    precisionMethodReference: input.precision?.methodReference ?? null,
    status,
    criteria,
    qualificationGranted: false as const,
  };
}
