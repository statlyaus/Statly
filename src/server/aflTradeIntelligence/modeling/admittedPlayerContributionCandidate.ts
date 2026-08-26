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
  evaluateAflTradePlayerPredictions,
} from './playerContributionValidation';
import { fitAflTradePlayerContributionBaseline } from './playerContributionBaseline';
import {
  aflTradePlayerBaselineConfigSchema,
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
      const materialized = materializeContributionSet({ observationSet, transform });
      const transformed = {
        observationSetId: createAflTradeContentAddress(
          'player-observation-set',
          materialized.content
        ),
        content: materialized.content,
      };
      const baselineConfig = aflTradePlayerBaselineConfigSchema.parse({
        schemaVersion: 'afl-trade-player-baseline-config/v1',
        replacementQuantile: 0.2,
        minimumGamesForReplacementFit: 1,
        minimumTrainingObservationsPerGroup: 1,
        weighting: 'games_played',
        replacementStratification: 'role_and_era',
        unavailableAndZeroTreatment: 'distinct',
        activeCareerTreatment: 'right_censored',
      });
      const baseline = fitAflTradePlayerContributionBaseline(transformed, baselineConfig);
      const replacementByGroup = new Map(
        baseline.content.replacementLevels.map((level) => [
          `${level.role}\u0000${level.era}`,
          level.replacementContributionPerGame,
        ])
      );
      const predictions = transformed.content.observations
        .filter(({ partition }) => partition === 'final_test')
        .map((observation) => {
          const rate = replacementByGroup.get(`${observation.role}\u0000${observation.era}`);
          if (rate === undefined) return null;
          return {
            observationId: observation.observationId,
            partition: 'final_test' as const,
            featureCutoffAt: observation.predictionCutoffAt,
            candidatePredictedContributionAboveReplacement: observation.gamesAvailable * rate,
            gamesOnlyPredictedContributionAboveReplacement: observation.gamesPlayed * rate,
          };
        })
        .filter((prediction): prediction is NonNullable<typeof prediction> => prediction !== null);
      if (predictions.length === 0)
        throw new RangeError('Admitted player evidence has no final-test observations.');
      const predictionSet = createAflTradePlayerPredictionSet({
        schemaVersion: 'afl-trade-player-prediction-set/v1',
        publicIdentityBoundary: 'source_native_no_fantasy_ownership',
        observationSetId: transformed.observationSetId,
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
      const report = evaluateAflTradePlayerPredictions(
        transformed,
        baseline,
        predictionSet,
        config
      );
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
