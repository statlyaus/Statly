import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradePickPavPolicy } from '@/server/aflTradeIntelligence/modeling/pickOutcomeContracts';
import { fitAflTradePickPavDistributionBenchmark } from '@/server/aflTradeIntelligence/modeling/pickPavDistributionBenchmark';
import {
  aflTradePickPavValidationReportSchema,
  validateAflTradePickPavDistributionBenchmark,
} from '@/server/aflTradeIntelligence/modeling/pickPavDistributionValidation';
import { materializeAflTradePickPavObservationSet } from '@/server/aflTradeIntelligence/modeling/pickPavObservationService';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const addressed = (prefix: string, value: string) => `${prefix}:${sha(value)}`;
const releaseId = addressed('outcome-release', 'validation-release');
const methodId = addressed('hpn-pav-method', 'validation-method');
const years = [2000, 2001, 2002, 2003, 2006, 2009, 2012] as const;
const trainingSelections = new Map<number, number>([
  [2000, 10],
  [2001, 14],
  [2002, 14],
  [2003, 20],
]);
const contributions = new Map<number, number>([
  [2000, 100],
  [2001, 60],
  [2002, 80],
  [2003, 20],
  [2006, 70],
  [2009, 65],
  [2012, 75],
]);

function policy(calibrationYear = 2006) {
  return createAflTradePickPavPolicy({
    schemaVersion: 'afl-trade-pick-pav-policy/v1',
    authorityBoundary:
      'private_released_draft_selection_exact_finalized_hpn_pav_no_grade_publication_or_fantasy_ownership',
    publicationEligible: false,
    environment: 'test_fixture',
    competition: 'AFLM',
    policyVersion: 'validation-v1',
    supportedPathway: 'national',
    supportedAccess: 'open',
    firstOutcomeSeasonOffset: 1,
    fixedHorizonSeasons: 1,
    methodId,
    sourceValueUnit: 'season_pav',
    outcomeValueUnit: 'fixed_horizon_pav',
    categoryMinimums: {
      replacementLevel: 10,
      regularContributor: 30,
      highQuality: 60,
      elite: 90,
    },
    partitions: [
      { role: 'train', fromDraftYear: 2000, throughDraftYear: 2003 },
      {
        role: 'calibration',
        fromDraftYear: calibrationYear,
        throughDraftYear: calibrationYear,
      },
      { role: 'validation', fromDraftYear: 2009, throughDraftYear: 2009 },
      { role: 'final_test', fromDraftYear: 2012, throughDraftYear: 2012 },
    ],
    approvalDecision: {
      id: addressed('review-decision', 'validation-policy'),
      sha256: sha('validation-policy'),
    },
    createdAt: '1999-01-01T00:00:00.000Z',
  });
}

function observationSet(options: { unsupportedFinalPick?: boolean; reverse?: boolean } = {}) {
  const orderedYears = options.reverse ? [...years].reverse() : [...years];
  const selections = orderedYears.map((draftYear) => {
    const selectionNumber =
      trainingSelections.get(draftYear) ??
      (options.unsupportedFinalPick && draftYear === 2012 ? 25 : 14);
    return {
      releaseId,
      selectionId: addressed('draft-selection', `${draftYear}:${selectionNumber}`),
      eventId: `draft:${draftYear}:national`,
      eventVersionId: addressed('event-version', `draft:${draftYear}:national`),
      eventDate: `${draftYear}-11-20`,
      recordedAt: `${draftYear}-11-21T00:00:00.000Z`,
      draftYear,
      pathway: 'national' as const,
      actualSelectionNumber: selectionNumber,
      nominalSelectionNumber: selectionNumber,
      draftRound: selectionNumber <= 20 ? 1 : 2,
      pickId: `pick:${draftYear}:national:${selectionNumber}`,
      playerId: `player:${draftYear}`,
      clubId: `club:${draftYear}`,
      access: {
        state: 'open' as const,
        decision: {
          id: addressed('review-decision', `access:${draftYear}`),
          sha256: sha(`access:${draftYear}`),
        },
        recordedAt: `${draftYear}-11-22T00:00:00.000Z`,
      },
    };
  });
  const calculations = orderedYears.map((draftYear) => {
    const seasonYear = draftYear + 1;
    const calculationSha256 = sha(`calculation:${draftYear}`);
    const sourceRowIds = Array.from(
      { length: 10 },
      (_, index) => `decoded-row:${draftYear}:${index + 1}`
    );
    return {
      calculation: {
        calculationId: `hpn-pav-season:${calculationSha256}`,
        calculationSha256,
        inputSetId: addressed('hpn-pav-input-set', `input:${draftYear}`),
        methodId,
        seasonYear,
        effectiveThrough: `${seasonYear}-12-31T23:59:59.000Z`,
        calculatedAt: `${seasonYear + 1}-01-01T00:00:00.000Z`,
      },
      playerValues: [
        {
          calculationId: `hpn-pav-season:${calculationSha256}`,
          calculationSha256,
          seasonYear,
          spellVersionId: addressed('acquisition-spell-version', `spell:${draftYear}`),
          playerId: `player:${draftYear}`,
          playerSha256: sha(`player:${draftYear}`),
          clubId: `club:${draftYear}`,
          sourceRowIds,
          gamesPlayed: sourceRowIds.length,
          totalPav: contributions.get(draftYear)!,
        },
      ],
    };
  });
  return materializeAflTradePickPavObservationSet({
    environment: 'test_fixture',
    competition: 'AFLM',
    createdAt: '2015-01-02T00:00:00.000Z',
    knowledgeCutoffAt: '2015-01-01T00:00:00.000Z',
    releaseId,
    policy: policy(),
    selections,
    calculations,
  });
}

function temporallyLeakyObservationSet() {
  const source = observationSet();
  const calibration = source.content.observations.find(
    ({ partition }) => partition === 'calibration'
  )!;
  const calculation = source.content.calculations.find(
    ({ seasonYear }) => seasonYear === calibration.selection.draftYear + 1
  )!;
  const playerValue = calibration.playerValues[0]!;
  return materializeAflTradePickPavObservationSet({
    environment: 'test_fixture',
    competition: 'AFLM',
    createdAt: source.content.createdAt,
    knowledgeCutoffAt: source.content.knowledgeCutoffAt,
    releaseId,
    policy: policy(2004),
    selections: source.content.observations.map(({ selection }) =>
      selection.selectionId === calibration.selection.selectionId
        ? {
            ...selection,
            selectionId: addressed('draft-selection', '2004:14'),
            eventId: 'draft:2004:national',
            eventVersionId: addressed('event-version', 'draft:2004:national'),
            eventDate: '2004-11-20',
            recordedAt: '2004-11-21T00:00:00.000Z',
            draftYear: 2004,
            pickId: 'pick:2004:national:14',
            playerId: 'player:2004',
            clubId: 'club:2004',
            access: {
              state: 'open' as const,
              decision: {
                id: addressed('review-decision', 'access:2004'),
                sha256: sha('access:2004'),
              },
              recordedAt: '2004-11-22T00:00:00.000Z',
            },
          }
        : selection
    ),
    calculations: source.content.calculations.map((member) => {
      if (member.calculationId !== calculation.calculationId) {
        const matchingValues = source.content.observations.flatMap((observation) =>
          observation.playerValues.filter(
            ({ calculationId }) => calculationId === member.calculationId
          )
        );
        return { calculation: member, playerValues: matchingValues };
      }
      const calculationSha256 = sha('calculation:2004');
      const sourceRowIds = Array.from(
        { length: 10 },
        (_, index) => `decoded-row:2004:${index + 1}`
      );
      return {
        calculation: {
          ...member,
          calculationId: `hpn-pav-season:${calculationSha256}`,
          calculationSha256,
          inputSetId: addressed('hpn-pav-input-set', 'input:2004'),
          seasonYear: 2005,
          effectiveThrough: '2005-12-31T23:59:59.000Z',
          calculatedAt: '2006-01-01T00:00:00.000Z',
        },
        playerValues: [
          {
            ...playerValue,
            calculationId: `hpn-pav-season:${calculationSha256}`,
            calculationSha256,
            seasonYear: 2005,
            spellVersionId: addressed('acquisition-spell-version', 'spell:2004'),
            playerId: 'player:2004',
            playerSha256: sha('player:2004'),
            clubId: 'club:2004',
            sourceRowIds,
          },
        ],
      };
    }),
  });
}

const benchmarkConfig = {
  schemaVersion: 'afl-trade-pick-pav-distribution-benchmark-config/v1' as const,
  minimumBlockObservations: 1,
  eligibility: 'mature_open_access_national_draft_training_observations' as const,
  informationWeight: 'eligible_selection_count' as const,
  smoother: 'weighted_non_increasing_isotonic' as const,
  sparseBlockMergePolicy: 'nearest_adjacent_fitted_mean_left_tie_break' as const,
  interpolation: 'left_block_carry_forward_within_training_domain' as const,
  extrapolation: 'prohibited' as const,
  estimatorStatus: 'benchmark_only_requires_temporal_validation_and_approval' as const,
};

const validationConfig = {
  schemaVersion: 'afl-trade-pick-pav-validation-config/v1' as const,
  evaluatedAt: '2015-01-03T00:00:00.000Z',
  minimumEligibleObservations: 3,
  minimumPartitionObservations: 1,
  nominalIntervalCoverage: 0.8 as const,
};

describe('exact-pick PAV distribution validation', () => {
  it('scores each held-out partition against the exact trained pick distribution', () => {
    const observations = observationSet();
    const benchmark = fitAflTradePickPavDistributionBenchmark(observations, benchmarkConfig);
    const report = validateAflTradePickPavDistributionBenchmark(
      observations,
      benchmark,
      validationConfig
    );

    expect(report.content.evaluationStatus).toBe('scored_not_approved');
    expect(report.content.predictions).toHaveLength(3);
    expect(report.content.predictions.map(({ partition }) => partition)).toEqual([
      'calibration',
      'validation',
      'final_test',
    ]);
    expect(
      report.content.predictions.every(({ actualSelectionNumber }) => actualSelectionNumber === 14)
    ).toBe(true);
    expect(report.content.predictions[0]).toMatchObject({
      predictedExpectedContribution: 70,
      p10Contribution: 60,
      p90Contribution: 80,
      predictedExpectedGames: 10,
      observedContribution: 70,
      observedGames: 10,
    });
    const allHeldOut = report.content.scoreScopes.find(({ scope }) => scope === 'all_held_out');
    expect(allHeldOut?.observationCount).toBe(3);
    expect(allHeldOut?.metrics).toMatchObject({
      meanAbsoluteContributionError: 10 / 3,
      empiricalP10P90Coverage: 1,
      meanAbsoluteGamesError: 0,
      zeroProbabilityObservationCount: 0,
    });
    expect(report.content.publicationEligible).toBe(false);
  });

  it('excludes held-out selections outside the trained domain and reports insufficient coverage', () => {
    const observations = observationSet({ unsupportedFinalPick: true });
    const benchmark = fitAflTradePickPavDistributionBenchmark(observations, benchmarkConfig);
    const report = validateAflTradePickPavDistributionBenchmark(
      observations,
      benchmark,
      validationConfig
    );

    expect(report.content.evaluationStatus).toBe('insufficient_eligible_observations_not_approved');
    expect(report.content.excludedObservations).toContainEqual({
      observationId: observations.content.observations.find(
        ({ partition }) => partition === 'final_test'
      )!.observationId,
      reason: 'outside_training_domain',
    });
  });

  it('is input-order deterministic and rejects outcomes unavailable at evaluation time', () => {
    const forward = observationSet();
    const reverse = observationSet({ reverse: true });
    const forwardReport = validateAflTradePickPavDistributionBenchmark(
      forward,
      fitAflTradePickPavDistributionBenchmark(forward, benchmarkConfig),
      validationConfig
    );
    const reverseReport = validateAflTradePickPavDistributionBenchmark(
      reverse,
      fitAflTradePickPavDistributionBenchmark(reverse, benchmarkConfig),
      validationConfig
    );
    expect(reverseReport).toEqual(forwardReport);

    expect(() =>
      validateAflTradePickPavDistributionBenchmark(
        forward,
        fitAflTradePickPavDistributionBenchmark(forward, benchmarkConfig),
        { ...validationConfig, evaluatedAt: '2010-01-01T00:00:00.000Z' }
      )
    ).toThrow(/evaluation time|observed after/i);
  });

  it('rejects a same-shape report whose scored result was substituted', () => {
    const observations = observationSet();
    const report = validateAflTradePickPavDistributionBenchmark(
      observations,
      fitAflTradePickPavDistributionBenchmark(observations, benchmarkConfig),
      validationConfig
    );
    const tampered = structuredClone(report);
    tampered.content.predictions[0]!.predictedExpectedContribution += 1;

    expect(() => aflTradePickPavValidationReportSchema.parse(tampered)).toThrow(
      /prediction|metric|content-address/i
    );
  });

  it('rejects a fit whose training labels were unavailable at the first held-out prediction', () => {
    expect(() =>
      fitAflTradePickPavDistributionBenchmark(temporallyLeakyObservationSet(), benchmarkConfig)
    ).toThrow(/training label|held-out prediction|label-purged|leakage/i);
  });

  it('re-derives the benchmark instead of trusting substituted support under the same ancestry', () => {
    const observations = observationSet();
    const benchmark = fitAflTradePickPavDistributionBenchmark(observations, benchmarkConfig);
    const substituted = structuredClone(benchmark);
    substituted.content.distributionBlocks[0]!.empiricalSupport[0]!.draftYear = 1998;
    substituted.benchmarkId = createAflTradeContentAddress(
      'pick-pav-benchmark',
      substituted.content
    );

    expect(() =>
      validateAflTradePickPavDistributionBenchmark(observations, substituted, validationConfig)
    ).toThrow(/exact fitted benchmark|substitut|observation-set/i);
  });
});
