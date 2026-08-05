import { describe, expect, it } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  aflTradeModelRunManifestSchema,
  type AflTradeModelRunManifest,
} from '@/server/aflTradeIntelligence/artifacts/modelRunManifest';
import {
  fitAflTradePickDistributionBenchmark,
  type AflTradePickDistributionBenchmarkConfig,
} from '@/server/aflTradeIntelligence/modeling/pickDistributionBenchmark';
import {
  aflTradePickValidationReportContentSchema,
  aflTradePickValidationReportSchema,
  validateAflTradePickDistributionBenchmark,
  type AflTradePickValidationConfig,
} from '@/server/aflTradeIntelligence/modeling/pickDistributionValidation';
import {
  AFL_TRADE_PICK_OUTCOME_CATEGORIES,
  createAflTradePickOutcomeObservationSet,
  type AflTradePickOutcomeObservation,
  type AflTradePickOutcomeObservationSetContent,
} from '@/server/aflTradeIntelligence/modeling/pickOutcomeContracts';

const digest = (character: string) => character.repeat(64);

function artifact(character: string) {
  const contentSha256 = digest(character);
  return {
    artifactId: `artifact:${contentSha256}`,
    contentSha256,
    storageUri: `artifact://sha256/${contentSha256}`,
    mediaType: 'application/json',
    byteLength: 128,
    createdAt: '2026-08-04T00:00:00.000Z',
  };
}

function matureOutcome(
  contribution: number,
  category: (typeof AFL_TRADE_PICK_OUTCOME_CATEGORIES)[number]
): AflTradePickOutcomeObservation['outcome'] {
  return {
    state: 'mature_observed',
    contribution,
    gamesPlayed: category === 'no_afl_game' ? 0 : 30,
    category,
  };
}

function observation({
  id,
  partition,
  draftYear,
  selection = 1,
  observedOutcome,
  selectionOverrides = {},
  era = 'era-a',
  playerPosition = 'midfielder',
  evidenceQuality = 'high',
}: {
  id: string;
  partition: AflTradePickOutcomeObservation['partition'];
  draftYear: number;
  selection?: number | null;
  observedOutcome: AflTradePickOutcomeObservation['outcome'];
  selectionOverrides?: Partial<AflTradePickOutcomeObservation['selection']>;
  era?: string;
  playerPosition?: string;
  evidenceQuality?: AflTradePickOutcomeObservation['evidenceQuality'];
}): AflTradePickOutcomeObservation {
  const outcomeObservedAt =
    observedOutcome.state === 'right_censored'
      ? `${draftYear + 1}-01-01T00:00:00.000Z`
      : `${draftYear + 3}-01-01T00:00:00.000Z`;
  return {
    observationId: `observation-${id}`,
    playerId: `player-${id}`,
    draftClassId: `draft-class-${draftYear}`,
    draftYear,
    partition,
    predictionCutoffAt: `${draftYear}-01-01T00:00:00.000Z`,
    selectionKnownAt: `${draftYear - 1}-12-31T00:00:00.000Z`,
    outcomeHorizonEndsAt: `${draftYear + 2}-12-31T00:00:00.000Z`,
    outcomeObservedAt,
    selection: {
      pathway: 'national',
      access: 'open',
      nominalSelectionNumber: selection,
      actualSelectionNumber: selection,
      bidSelectionNumber: null,
      draftRound: selection === null ? null : 1,
      ...selectionOverrides,
    },
    era,
    playerPosition,
    ageAtDraft: 18.5,
    evidenceQuality,
    outcome:
      observedOutcome.state === 'right_censored'
        ? { ...observedOutcome, censoredAt: outcomeObservedAt }
        : observedOutcome,
  };
}

function observationContent({
  datasetCharacter = '1',
  trainingCategories = AFL_TRADE_PICK_OUTCOME_CATEGORIES,
  contributionShift = 0,
}: {
  datasetCharacter?: string;
  trainingCategories?: readonly (typeof AFL_TRADE_PICK_OUTCOME_CATEGORIES)[number][];
  contributionShift?: number;
} = {}): AflTradePickOutcomeObservationSetContent {
  const training = trainingCategories.map((category, index) =>
    observation({
      id: `train-${category}`,
      partition: 'train',
      draftYear: 1998,
      observedOutcome: matureOutcome(
        category === 'no_afl_game' ? 0 : (index + 1) * 10 + contributionShift,
        category
      ),
    })
  );
  return {
    schemaVersion: 'afl-trade-pick-observation-set/v1',
    publicAssetBoundary: 'source_native_afl_draft_selection_no_fantasy_ownership',
    datasetId: `dataset:${digest(datasetCharacter)}`,
    modelProtocolId: `model-protocol:${digest('2')}`,
    valueUnitId: 'fixture-contribution-unit',
    fixedHorizonSeasons: 2,
    fixedHorizonDefinitionArtifactId: `artifact:${digest('3')}`,
    outcomeDefinitionArtifactId: `artifact:${digest('4')}`,
    curveEligibility: 'open_access_national_draft_actual_selection_only',
    observations: [
      ...training,
      observation({
        id: 'calibration-elite',
        partition: 'calibration',
        draftYear: 2004,
        observedOutcome: matureOutcome(55, 'elite'),
      }),
      observation({
        id: 'validation-regular',
        partition: 'validation',
        draftYear: 2008,
        observedOutcome: matureOutcome(35, 'regular_contributor'),
        playerPosition: 'forward',
      }),
      observation({
        id: 'validation-outside',
        partition: 'validation',
        draftYear: 2008,
        selection: 2,
        observedOutcome: matureOutcome(25, 'replacement_level'),
      }),
      observation({
        id: 'validation-restricted',
        partition: 'validation',
        draftYear: 2008,
        observedOutcome: matureOutcome(50, 'high_quality'),
        selectionOverrides: {
          access: 'academy_bid_match',
          bidSelectionNumber: 1,
        },
      }),
      observation({
        id: 'validation-rookie',
        partition: 'validation',
        draftYear: 2008,
        selection: null,
        observedOutcome: matureOutcome(20, 'short_career'),
        selectionOverrides: {
          pathway: 'rookie',
          nominalSelectionNumber: null,
          actualSelectionNumber: null,
          draftRound: null,
        },
      }),
      observation({
        id: 'final-no-game',
        partition: 'final_test',
        draftYear: 2012,
        observedOutcome: matureOutcome(0, 'no_afl_game'),
        evidenceQuality: 'medium',
      }),
      observation({
        id: 'final-unavailable',
        partition: 'final_test',
        draftYear: 2012,
        observedOutcome: { state: 'unavailable', reason: 'source_missing' },
      }),
      observation({
        id: 'final-censored',
        partition: 'final_test',
        draftYear: 2014,
        observedOutcome: {
          state: 'right_censored',
          contributionObservedToDate: 10,
          gamesObservedToDate: 5,
          censoredAt: '2015-01-01T00:00:00.000Z',
        },
      }),
    ],
  };
}

const benchmarkConfig: AflTradePickDistributionBenchmarkConfig = {
  schemaVersion: 'afl-trade-pick-distribution-benchmark-config/v1',
  minimumBlockObservations: 1,
  eligibility: 'mature_open_access_national_draft_training_observations',
  informationWeight: 'eligible_player_count',
  sparseBlockMergePolicy: 'nearest_adjacent_fitted_mean_left_tie_break',
  interpolation: 'left_block_carry_forward_within_training_domain',
  extrapolation: 'prohibited',
  estimatorStatus: 'benchmark_only_not_censor_aware_candidate',
};

function fittedFixture(options: Parameters<typeof observationContent>[0] = {}) {
  const set = createAflTradePickOutcomeObservationSet(observationContent(options));
  return { set, fit: fitAflTradePickDistributionBenchmark(set, benchmarkConfig) };
}

function modelWindows() {
  return {
    train: { from: '2020-01-01T00:00:00.000Z', to: '2021-01-01T00:00:00.000Z' },
    calibration: { from: '2021-01-08T00:00:00.000Z', to: '2022-01-01T00:00:00.000Z' },
    validation: { from: '2022-01-08T00:00:00.000Z', to: '2023-01-01T00:00:00.000Z' },
    finalTest: { from: '2023-01-08T00:00:00.000Z', to: '2024-01-01T00:00:00.000Z' },
    embargoDays: 7,
  };
}

function runManifest(
  fit: ReturnType<typeof fittedFixture>['fit'],
  overrides: Partial<AflTradeModelRunManifest['content']> = {}
): AflTradeModelRunManifest {
  const content: AflTradeModelRunManifest['content'] = {
    schemaVersion: 'afl-trade-model-run/v2',
    environment: 'test_fixture',
    modelId: 'fixture-pick-model',
    modelVersion: 'fixture-v1',
    datasetId: fit.content.datasetId,
    modelProtocolId: fit.content.modelProtocolId,
    codeCommitSha: digest('5').slice(0, 40),
    cleanWorktree: true,
    seed: 42,
    job: {
      jobId: 'fixture-job',
      attempt: 1,
      initiatedBy: 'fixture-owner',
      workerIdentity: 'fixture-worker',
    },
    startedAt: '2026-08-05T00:00:00.000Z',
    candidateLockedAt: '2026-08-05T00:30:00.000Z',
    finalTestEvaluatedAt: '2026-08-05T00:45:00.000Z',
    finishedAt: '2026-08-05T01:00:00.000Z',
    windows: modelWindows(),
    sourceCodeArtifact: artifact('6'),
    dependencyLockArtifact: artifact('7'),
    runtimeArtifact: artifact('8'),
    containerArtifact: artifact('9'),
    configurationArtifact: artifact('a'),
    environmentArtifact: artifact('b'),
    featureDefinitionArtifacts: [artifact('c')],
    outcome: {
      status: 'succeeded',
      modelArtifact: artifact('d'),
      validationReportArtifact: artifact('e'),
      baselineComparisonArtifact: artifact('f'),
      calibrationReportArtifact: artifact('0'),
      intervalCoverageArtifact: artifact('1'),
      subgroupReportArtifact: artifact('2'),
      sensitivityReportArtifact: artifact('3'),
      leakageAuditArtifact: artifact('4'),
      modelCardArtifact: artifact('5'),
      diagnosticsArtifact: artifact('6'),
    },
    ...overrides,
  };
  return aflTradeModelRunManifestSchema.parse({
    runId: createAflTradeContentAddress('model-run', content),
    content,
  });
}

function validationConfig(
  overrides: Partial<AflTradePickValidationConfig> = {}
): AflTradePickValidationConfig {
  return {
    schemaVersion: 'afl-trade-pick-validation-config/v1',
    evaluatedAt: '2026-08-06T00:00:00.000Z',
    minimumEligibleObservations: 3,
    minimumSubgroupObservations: 2,
    logLossZeroProbabilityPolicy: 'invalidate_without_probability_floor',
    rankedProbabilityScoreNormalization: 'divide_by_ordered_category_boundaries',
    contributionScore: 'empirical_distribution_crps',
    intervalCoverage: 'empirical_p10_p90_outcome_interval_not_model_interval',
    ...overrides,
  };
}

describe('AFL trade-intelligence pick-distribution validation', () => {
  it('derives proper held-out scores from a locked provenance chain without granting approval', () => {
    const { set, fit } = fittedFixture();
    const run = runManifest(fit);
    const report = validateAflTradePickDistributionBenchmark(set, fit, run, validationConfig());

    expect(report.content).toMatchObject({
      observationSetId: set.observationSetId,
      pickBenchmarkFitId: fit.benchmarkFitId,
      modelRunId: run.runId,
      datasetId: fit.content.datasetId,
      evaluationStatus: 'scored_not_approved',
      approvalStatus: 'not_assessed_by_validation_harness',
      expectedCurveMonotonicity: 'verified_non_increasing',
      inputObservationCount: set.content.observations.length,
    });
    expect(report.content.predictions).toHaveLength(3);
    expect(
      report.content.scoreScopes.map(({ scope, observationCount }) => ({
        scope,
        observationCount,
      }))
    ).toEqual([
      { scope: 'all_held_out', observationCount: 3 },
      { scope: 'calibration', observationCount: 1 },
      { scope: 'validation', observationCount: 1 },
      { scope: 'final_test', observationCount: 1 },
    ]);
    expect(report.content.scoreScopes[0].metrics).toMatchObject({
      zeroProbabilityObservationCount: 0,
    });
    expect(report.content.scoreScopes[0].metrics?.multiclassBrierScore).toBeCloseTo(5 / 6, 12);
    expect(report.content.scoreScopes[0].metrics?.logLoss).toBeCloseTo(Math.log(6), 12);
  });

  it('accounts explicitly for training, censoring, unavailable, pathway, access, and domain exclusions', () => {
    const { set, fit } = fittedFixture();
    const report = validateAflTradePickDistributionBenchmark(
      set,
      fit,
      runManifest(fit),
      validationConfig()
    );
    const reasons = new Map(
      report.content.excludedObservations.map(({ observationId, reason }) => [
        observationId,
        reason,
      ])
    );

    expect(
      set.content.observations
        .filter(({ partition }) => partition === 'train')
        .every(({ observationId }) => reasons.get(observationId) === 'training_partition')
    ).toBe(true);
    expect(reasons.get('observation-final-censored')).toBe('right_censored');
    expect(reasons.get('observation-final-unavailable')).toBe('outcome_unavailable');
    expect(reasons.get('observation-validation-rookie')).toBe('non_national_pathway');
    expect(reasons.get('observation-validation-restricted')).toBe('restricted_access');
    expect(reasons.get('observation-validation-outside')).toBe('outside_pick_curve_domain');
    expect(report.content.predictions.length + report.content.excludedObservations.length).toBe(
      set.content.observations.length
    );
  });

  it('invalidates unseen true outcomes rather than applying a hidden probability floor', () => {
    const { set, fit } = fittedFixture({
      trainingCategories: ['regular_contributor', 'elite'],
    });
    const report = validateAflTradePickDistributionBenchmark(
      set,
      fit,
      runManifest(fit),
      validationConfig()
    );

    expect(report.content.evaluationStatus).toBe('invalid_zero_probability_not_approved');
    expect(report.content.scoreScopes[0].metrics).toMatchObject({
      logLoss: null,
      zeroProbabilityObservationCount: 1,
    });
    expect(report.content.config.logLossZeroProbabilityPolicy).toBe(
      'invalidate_without_probability_floor'
    );
  });

  it('reports insufficient samples and subgroup sufficiency independently of calculable scores', () => {
    const { set, fit } = fittedFixture();
    const report = validateAflTradePickDistributionBenchmark(
      set,
      fit,
      runManifest(fit),
      validationConfig({
        minimumEligibleObservations: 10,
        minimumSubgroupObservations: 2,
      })
    );

    expect(report.content.evaluationStatus).toBe('insufficient_eligible_observations_not_approved');
    expect(report.content.scoreScopes[0].metrics).not.toBeNull();
    expect(report.content.subgroups.some(({ status }) => status === 'scored')).toBe(true);
    expect(
      report.content.subgroups.some(({ status }) => status === 'insufficient_observations')
    ).toBe(true);
  });

  it('requires a successful locked candidate with matching dataset and protocol provenance', () => {
    const { set, fit } = fittedFixture();
    expect(() =>
      validateAflTradePickDistributionBenchmark(
        set,
        fit,
        runManifest(fit, { datasetId: `dataset:${digest('d')}` }),
        validationConfig()
      )
    ).toThrow(/provenance chain/i);

    const failedRun = runManifest(fit, {
      candidateLockedAt: null,
      finalTestEvaluatedAt: null,
      outcome: {
        status: 'failed',
        failureClassification: 'validation_failure',
        failureArtifact: artifact('d'),
        diagnosticsArtifact: artifact('e'),
      },
    });
    expect(() =>
      validateAflTradePickDistributionBenchmark(set, fit, failedRun, validationConfig())
    ).toThrow(/successful locked/i);
    expect(() =>
      validateAflTradePickDistributionBenchmark(
        set,
        fit,
        runManifest(fit),
        validationConfig({ evaluatedAt: '2026-08-05T00:50:00.000Z' })
      )
    ).toThrow(/run completion/i);
  });

  it('evaluates drift only against unique definition-compatible explicit reference fits', () => {
    const { set, fit } = fittedFixture();
    const reference = fittedFixture({ datasetCharacter: 'e', contributionShift: 5 }).fit;
    const report = validateAflTradePickDistributionBenchmark(
      set,
      fit,
      runManifest(fit),
      validationConfig(),
      [reference]
    );

    expect(report.content.curveStability).toMatchObject({
      status: 'evaluated_against_explicit_references',
      comparisons: [
        {
          referenceBenchmarkFitId: reference.benchmarkFitId,
          referenceDatasetId: reference.content.datasetId,
          sharedSelectionCount: 1,
          meanOutcomeDistributionTotalVariation: 0,
        },
      ],
    });
    expect(
      report.content.curveStability.comparisons[0].meanAbsoluteExpectedContributionDrift
    ).toBeCloseTo(25 / 6, 12);
    expect(
      report.content.curveStability.comparisons[0].maximumAbsoluteExpectedContributionDrift
    ).toBeCloseTo(25 / 6, 12);
    expect(() =>
      validateAflTradePickDistributionBenchmark(set, fit, runManifest(fit), validationConfig(), [
        reference,
        reference,
      ])
    ).toThrow(/unique/i);
  });

  it('rejects score, subgroup, accounting, chronology, ownership, and content-address tampering', () => {
    const { set, fit } = fittedFixture();
    const report = validateAflTradePickDistributionBenchmark(
      set,
      fit,
      runManifest(fit),
      validationConfig()
    );
    expect(
      aflTradePickValidationReportContentSchema.safeParse({
        ...report.content,
        inputObservationCount: report.content.inputObservationCount + 1,
      }).success
    ).toBe(false);
    expect(
      aflTradePickValidationReportContentSchema.safeParse({
        ...report.content,
        scoreScopes: report.content.scoreScopes.map((scope, index) =>
          index === 0 && scope.metrics !== null
            ? {
                ...scope,
                metrics: { ...scope.metrics, multiclassBrierScore: 0 },
              }
            : scope
        ),
      }).success
    ).toBe(false);
    expect(
      aflTradePickValidationReportContentSchema.safeParse({
        ...report.content,
        subgroups: report.content.subgroups.slice(1),
      }).success
    ).toBe(false);
    expect(
      aflTradePickValidationReportSchema.safeParse({
        ...report,
        content: {
          ...report.content,
          ownerId: 'fantasy-user',
          fantasyLeagueId: 'fantasy-league',
        },
      }).success
    ).toBe(false);
    expect(
      aflTradePickValidationReportSchema.safeParse({
        ...report,
        content: { ...report.content, approvalStatus: 'approved' },
      }).success
    ).toBe(false);
  });
});
