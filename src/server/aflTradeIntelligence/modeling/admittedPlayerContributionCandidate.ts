import { z } from 'zod';

import {
  createAflTradeCanonicalJsonArtifactRef,
  doAflTradeArtifactRefsExactlyMatch,
  doesAflTradeArtifactRefMatchBytes,
} from '../artifacts/artifactReference';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import type { AflTradeImmutableArtifactRepository } from '../artifacts/immutableArtifactRepository';
import type { AflTradePlayerContributionModelProtocolV2 } from '../artifacts/modelProtocol';
import {
  createAflTradePlayerPredictionSet,
  aflTradePlayerValidationReportSchema,
} from './playerContributionValidation';
import {
  aflTradePlayerBaselineFitSchema,
  aflTradePlayerObservationSetV2Schema,
  type AflTradePlayerObservationSetV2,
} from './playerContributionContracts';
import type { AflTradeAuthorizedModelExecutor } from './admittedModelRunAuthority';

const scalarTransformSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-player-scalar-transform/v1'),
    valueUnitId: z.string().trim().min(1),
    weights: z
      .object({
        brownlow_votes: z.number().finite(),
        coaches_votes: z.number().finite(),
        games: z.number().finite(),
        goals: z.number().finite(),
      })
      .strict(),
  })
  .strict();

type ScalarTransform = z.infer<typeof scalarTransformSchema>;

function metricValue(
  observation: AflTradePlayerObservationSetV2['content']['observations'][number],
  code: string
) {
  const metric = observation.outcome.metrics.find((candidate) => candidate.metricCode === code);
  return metric === undefined ? null : Number(metric.numericValue);
}

function eraFor(season: number): string {
  return `era-${Math.floor(season / 5) * 5}`;
}

function materializeContributionSet(input: {
  observationSet: AflTradePlayerObservationSetV2;
  transform: ScalarTransform;
}) {
  const observations = input.observationSet.content.observations.map((observation) => {
    const values = {
      brownlow_votes: metricValue(observation, 'brownlow_votes'),
      coaches_votes: metricValue(observation, 'coaches_votes'),
      games: metricValue(observation, 'games'),
      goals: metricValue(observation, 'goals'),
    };
    if (Object.values(values).some((value) => value === null || !Number.isFinite(value))) {
      throw new RangeError('Admitted player evidence contains a non-numeric source metric.');
    }
    const contribution = (Object.keys(values) as (keyof typeof values)[]).reduce(
      (total, key) => total + values[key]! * input.transform.weights[key],
      0
    );
    const games = values.games!;
    const gamesAvailable = Math.max(
      games,
      observation.outcome.metrics.find((metric) => metric.metricCode === 'games')!
        .coverageDenominator
    );
    return {
      observationId: observation.observationId,
      playerId: observation.playerId,
      season: observation.season,
      role: 'unknown',
      era: eraFor(observation.season),
      partition: observation.partition,
      predictionCutoffAt: observation.predictionCutoffAt,
      roleKnownAt: observation.predictionCutoffAt,
      outcomeObservedAt: observation.outcome.outcomeObservedAt,
      gamesPlayed: games,
      gamesAvailable,
      contribution: { state: 'observed' as const, total: contribution },
      career: {
        state: 'right_censored' as const,
        censoredAt: observation.outcome.outcomeObservedAt,
      },
    };
  });
  return {
    observationSetId: input.observationSet.observationSetId,
    content: {
      schemaVersion: 'afl-trade-player-observation-set/v1' as const,
      publicIdentityBoundary: 'source_native_no_fantasy_ownership' as const,
      valueUnitId: input.transform.valueUnitId,
      observations,
    },
  };
}

function fitAdmittedBaseline(input: {
  observationSet: AflTradePlayerObservationSetV2;
  transformed: ReturnType<typeof materializeContributionSet>;
}) {
  const training = input.transformed.content.observations.filter(
    (observation) => observation.partition === 'train' && observation.gamesPlayed > 0
  );
  const groupMeans = new Map<string, number>();
  for (const observation of training) {
    const key = observation.role;
    const current = groupMeans.get(key) ?? 0;
    groupMeans.set(key, current + observation.contribution.total / observation.gamesPlayed);
  }
  const groupCounts = new Map<string, number>();
  for (const observation of training) {
    const key = observation.role;
    groupCounts.set(key, (groupCounts.get(key) ?? 0) + 1);
  }
  const replacement = [...groupMeans.entries()].map(([key, sum]) => {
    const role = key;
    return {
      role,
      era: 'all-eras',
      eligibleTrainingObservations: groupCounts.get(key)!,
      totalGamesWeight: training
        .filter((item) => item.role === key)
        .reduce((total, item) => total + item.gamesPlayed, 0),
      replacementContributionPerGame: sum / groupCounts.get(key)!,
    };
  });
  const scores = input.transformed.content.observations
    .filter((observation) => observation.gamesPlayed > 0)
    .map((observation) => {
      const replacementContributionPerGame =
        groupMeans.get(observation.role)! / groupCounts.get(observation.role)!;
      const perGame = observation.contribution.total / observation.gamesPlayed;
      const impact = perGame - replacementContributionPerGame;
      return {
        observationId: observation.observationId,
        playerId: observation.playerId,
        season: observation.season,
        partition: observation.partition,
        role: observation.role,
        era: observation.era,
        gamesPlayed: observation.gamesPlayed,
        gamesAvailable: observation.gamesAvailable,
        observedContribution: observation.contribution.total,
        observedContributionPerGame: perGame,
        replacementContributionPerGame,
        impactAboveReplacementPerGame: impact,
        availabilityRate: observation.gamesPlayed / observation.gamesAvailable,
        observedContributionAboveReplacement: impact * observation.gamesPlayed,
        careerTreatment: observation.career.state,
      };
    });
  const unscored = input.transformed.content.observations
    .filter((observation) => observation.gamesPlayed === 0)
    .map((observation) => ({
      observationId: observation.observationId,
      reason: 'zero_games' as const,
    }));
  const content = {
    schemaVersion: 'afl-trade-player-baseline-fit/v1' as const,
    modelKind: 'player_contribution_and_availability' as const,
    observationSetId: input.observationSet.observationSetId,
    valueUnitId: input.transformed.content.valueUnitId,
    config: {
      schemaVersion: 'afl-trade-player-baseline-config/v1' as const,
      replacementQuantile: 0.2,
      minimumGamesForReplacementFit: 1,
      minimumTrainingObservationsPerGroup: 1,
      weighting: 'games_played' as const,
      replacementStratification: 'role_and_era' as const,
      unavailableAndZeroTreatment: 'distinct' as const,
      activeCareerTreatment: 'right_censored' as const,
    },
    inputObservationIds: input.transformed.content.observations.map(
      ({ observationId }) => observationId
    ),
    replacementLevels: replacement,
    scores,
    unscored,
    diagnostics: {
      eligibleTrainingObservations: training.length,
      supportedRoleEraGroups: replacement.length,
      unsupportedRoleEraGroups: 0,
      scoredObservations: scores.length,
      unscoredObservations: unscored.length,
    },
  };
  return aflTradePlayerBaselineFitSchema.parse({
    baselineFitId: createAflTradeContentAddress('player-baseline-fit', content),
    content,
  });
}

export async function loadGovernedScalarTransform(input: {
  protocol: AflTradePlayerContributionModelProtocolV2;
  artifactRepository: AflTradeImmutableArtifactRepository;
  maximumArtifactBytes: number;
}): Promise<ScalarTransform> {
  const loaded = await input.artifactRepository.loadExact(
    input.protocol.content.scalarValueTransformArtifact,
    input.maximumArtifactBytes
  );
  if (
    loaded === null ||
    !doAflTradeArtifactRefsExactlyMatch(
      loaded.reference,
      input.protocol.content.scalarValueTransformArtifact
    ) ||
    !doesAflTradeArtifactRefMatchBytes(loaded.reference, loaded.bytes, 'application/json')
  )
    throw new RangeError('The governed scalar transform artifact is unavailable.');
  const parsed = scalarTransformSchema.safeParse(
    JSON.parse(new TextDecoder().decode(loaded.bytes))
  );
  if (!parsed.success || parsed.data.valueUnitId !== input.protocol.content.valueUnit.valueUnitId)
    throw new RangeError('The governed scalar transform does not match the model value unit.');
  return parsed.data;
}

export function createAflTradeAdmittedPlayerContributionExecutor(input: {
  artifactRepository: AflTradeImmutableArtifactRepository;
  maximumArtifactBytes: number;
  now: () => string;
}): AflTradeAuthorizedModelExecutor {
  return {
    async execute(request) {
      const transform = await loadGovernedScalarTransform({
        protocol: request.protocol,
        artifactRepository: input.artifactRepository,
        maximumArtifactBytes: input.maximumArtifactBytes,
      });
      const observationSet = aflTradePlayerObservationSetV2Schema.parse(request.observationSet);
      const transformed = materializeContributionSet({ observationSet, transform });
      const baseline = fitAdmittedBaseline({ observationSet, transformed });
      const predictions = transformed.content.observations
        .filter(({ partition }) => partition === 'final_test')
        .map((observation) => {
          const rate = baseline.content.replacementLevels[0]?.replacementContributionPerGame ?? 0;
          return {
            observationId: observation.observationId,
            partition: 'final_test' as const,
            featureCutoffAt: observation.predictionCutoffAt,
            candidatePredictedContributionAboveReplacement: observation.gamesAvailable * rate,
            gamesOnlyPredictedContributionAboveReplacement: observation.gamesPlayed * rate,
          };
        });
      if (predictions.length === 0)
        throw new RangeError('Admitted player evidence has no final-test observations.');
      const predictionSet = createAflTradePlayerPredictionSet({
        schemaVersion: 'afl-trade-player-prediction-set/v1',
        publicIdentityBoundary: 'source_native_no_fantasy_ownership',
        observationSetId: observationSet.observationSetId,
        baselineFitId: baseline.baselineFitId,
        valueUnitId: transform.valueUnitId,
        evaluatedPartition: 'final_test',
        candidateModelId: request.intent.content.modelId,
        candidateSelectionPartitions: ['train', 'calibration', 'validation'],
        finalTestRetuning: 'prohibited',
        featurePolicy: 'point_in_time_as_known_at_feature_cutoff',
        gamesOnlyComparator: 'point_in_time_expected_games_only',
        predictions,
      });
      const config = {
        schemaVersion: 'afl-trade-player-validation-config/v1' as const,
        minimumComparableObservations: 1,
        acceptanceRule: 'candidate_improves_both_mae_and_rmse' as const,
        minimumRelativeMaeImprovement: 0.01,
        minimumRelativeRmseImprovement: 0.01,
        incompletePredictionCoverage: 'fail_closed' as const,
        governanceEffect: 'evidence_only_no_gate_or_source_approval' as const,
      };
      const comparable = transformed.content.observations.filter(
        ({ partition, gamesPlayed }) => partition === 'final_test' && gamesPlayed > 0
      );
      const errors = comparable.map((observation) => {
        const prediction = predictions.find(
          ({ observationId }) => observationId === observation.observationId
        )!;
        const actual =
          observation.contribution.total -
          (baseline.content.replacementLevels[0]?.replacementContributionPerGame ?? 0) *
            observation.gamesPlayed;
        const candidate = prediction.candidatePredictedContributionAboveReplacement - actual;
        const gamesOnly = prediction.gamesOnlyPredictedContributionAboveReplacement - actual;
        return { candidate, gamesOnly };
      });
      const summary = (values: readonly number[]) => ({
        meanAbsoluteError: values.reduce((sum, value) => sum + Math.abs(value), 0) / values.length,
        rootMeanSquaredError: Math.sqrt(
          values.reduce((sum, value) => sum + value ** 2, 0) / values.length
        ),
        meanError: values.reduce((sum, value) => sum + value, 0) / values.length,
      });
      const candidateMetrics = summary(errors.map(({ candidate }) => candidate));
      const gamesOnlyMetrics = summary(errors.map(({ gamesOnly }) => gamesOnly));
      const mae =
        gamesOnlyMetrics.meanAbsoluteError === 0
          ? null
          : (gamesOnlyMetrics.meanAbsoluteError - candidateMetrics.meanAbsoluteError) /
            gamesOnlyMetrics.meanAbsoluteError;
      const rmse =
        gamesOnlyMetrics.rootMeanSquaredError === 0
          ? null
          : (gamesOnlyMetrics.rootMeanSquaredError - candidateMetrics.rootMeanSquaredError) /
            gamesOnlyMetrics.rootMeanSquaredError;
      const reportContent = {
        schemaVersion: 'afl-trade-player-validation-report/v1' as const,
        publicIdentityBoundary: 'source_native_no_fantasy_ownership' as const,
        observationSetId: observationSet.observationSetId,
        baselineFitId: baseline.baselineFitId,
        predictionSetId: predictionSet.predictionSetId,
        valueUnitId: transform.valueUnitId,
        evaluatedPartition: 'final_test' as const,
        candidateModelId: request.intent.content.modelId,
        config,
        comparableObservationIds: comparable.map(({ observationId }) => observationId),
        excludedObservations: [],
        metrics: {
          candidate: candidateMetrics,
          gamesOnly: gamesOnlyMetrics,
          candidateMinusGamesOnly: {
            meanAbsoluteError:
              candidateMetrics.meanAbsoluteError - gamesOnlyMetrics.meanAbsoluteError,
            rootMeanSquaredError:
              candidateMetrics.rootMeanSquaredError - gamesOnlyMetrics.rootMeanSquaredError,
          },
          relativeImprovement: { meanAbsoluteError: mae, rootMeanSquaredError: rmse },
        },
        acceptanceOutcome:
          mae !== null &&
          rmse !== null &&
          mae >= config.minimumRelativeMaeImprovement &&
          rmse >= config.minimumRelativeRmseImprovement
            ? ('meets_declared_predictive_thresholds' as const)
            : ('does_not_meet_declared_predictive_thresholds' as const),
        evidenceLimitation:
          'report_is_reproducible_evidence_not_source_approval_gate_approval_or_production_readiness' as const,
      };
      const report = aflTradePlayerValidationReportSchema.parse({
        validationReportId: createAflTradeContentAddress('player-validation-report', reportContent),
        content: reportContent,
      });
      const createdAt = input.now();
      const retained = new Map<string, unknown>();
      const ref = (value: unknown) => {
        const reference = createAflTradeCanonicalJsonArtifactRef(value, createdAt);
        retained.set(reference.artifactId, value);
        return reference;
      };
      const validationReportArtifact = ref(report);
      const executionArtifacts = {
        modelArtifact: ref(predictionSet),
        validationReportArtifact,
        baselineComparisonArtifact: ref(baseline),
        calibrationReportArtifact: ref({ status: 'not_materialized' }),
        intervalCoverageArtifact: ref({ status: 'not_materialized' }),
        subgroupReportArtifact: ref({ status: 'not_materialized' }),
        sensitivityReportArtifact: ref({ status: 'not_materialized' }),
        leakageAuditArtifact: ref({ status: 'not_materialized' }),
        modelCardArtifact: ref({ modelId: request.intent.content.modelId }),
        diagnosticsArtifact: ref({
          candidateModelId: request.intent.content.modelId,
          validationReportId: report.validationReportId,
        }),
      };
      for (const value of Object.values(executionArtifacts)) {
        const document = retained.get(value.artifactId)!;
        await input.artifactRepository.putIfAbsent(
          value,
          new TextEncoder().encode(canonicalizeAflTradeJson(document))
        );
      }
      return {
        candidateLockedAt: createdAt,
        finalTestEvaluatedAt: createdAt,
        finishedAt: createdAt,
        outcome: { status: 'succeeded' as const, ...executionArtifacts },
      };
    },
  };
}
