import { z } from 'zod';

import {
  createAflTradeCanonicalJsonArtifactRef,
  doesAflTradeArtifactRefMatchBytes,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import {
  verifyAflTradeArtifactReadback,
  type AflTradeImmutableArtifactRepository,
} from '../artifacts/immutableArtifactRepository';
import type { AflTradePlayerContributionModelProtocolV2 } from '../artifacts/modelProtocol';
import type { AflTradeAcquisitionSpellMetric } from '../outcomes/acquisitionSpellMetricContracts';
import type { AflTradeAuthorizedModelExecutor } from './admittedModelRunAuthority';
import { fitAflTradePlayerContributionBaseline } from './playerContributionBaseline';
import {
  aflTradePlayerBaselineConfigSchema,
  aflTradePlayerObservationSetV2Schema,
  createAflTradePlayerObservationSet,
  type AflTradePlayerBaselineFit,
  type AflTradePlayerObservationSet,
  type AflTradePlayerObservationSetV2,
} from './playerContributionContracts';
import {
  aflTradePlayerValidationConfigSchema,
  createAflTradePlayerPredictionSet,
  evaluateAflTradePlayerPredictions,
} from './playerContributionValidation';

const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u);
const nonnegativeNumericStringSchema = z.string().regex(/^(0|[1-9]\d*)(\.\d+)?$/u);

export const AFL_TRADE_PLAYER_POINT_IN_TIME_FEATURE_SET_SCHEMA_VERSION =
  'afl-trade-player-point-in-time-feature-set/v1' as const;
export const AFL_TRADE_ADMITTED_PLAYER_CANDIDATE_CONFIG_SCHEMA_VERSION =
  'afl-trade-admitted-player-candidate-config/v1' as const;
export const AFL_TRADE_ADMITTED_PLAYER_CANDIDATE_SCHEMA_VERSION =
  'afl-trade-admitted-player-candidate/v1' as const;
export const AFL_TRADE_ADMITTED_PLAYER_EXECUTOR_BUILD_SCHEMA_VERSION =
  'afl-trade-admitted-player-executor-build/v1' as const;

export const aflTradeAdmittedPlayerExecutorBuildSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_ADMITTED_PLAYER_EXECUTOR_BUILD_SCHEMA_VERSION),
    implementationId: z.literal('statly-admitted-player-contribution-candidate'),
    candidateSchemaVersion: z.literal(AFL_TRADE_ADMITTED_PLAYER_CANDIDATE_SCHEMA_VERSION),
    codeCommitSha: z.string().regex(/^[a-f0-9]{40}([a-f0-9]{24})?$/u),
    cleanWorktree: z.literal(true),
    dependencyLockArtifactId: z.string().regex(/^artifact:[a-f0-9]{64}$/u),
    runtimeArtifactId: z.string().regex(/^artifact:[a-f0-9]{64}$/u),
    containerArtifactId: z.string().regex(/^artifact:[a-f0-9]{64}$/u),
    environmentArtifactId: z.string().regex(/^artifact:[a-f0-9]{64}$/u),
  })
  .strict();

const scalarTransformSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-player-scalar-transform/v1'),
    valueUnitId: publicIdSchema,
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

export const aflTradePlayerPointInTimeFeatureSetSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PLAYER_POINT_IN_TIME_FEATURE_SET_SCHEMA_VERSION),
    datasetId: z.string().regex(/^dataset:[a-f0-9]{64}$/u),
    createdAt: z.iso.datetime({ offset: true }),
    roleTaxonomyArtifactId: z.string().regex(/^artifact:[a-f0-9]{64}$/u),
    eraDefinitionArtifactId: z.string().regex(/^artifact:[a-f0-9]{64}$/u),
    rows: z
      .array(
        z
          .object({
            datasetRowId: z.string().regex(/^valuation-dataset-row:[a-f0-9]{64}$/u),
            featureKnownThrough: z.iso.datetime({ offset: true }),
            role: publicIdSchema,
            roleKnownAt: z.iso.datetime({ offset: true }),
            era: publicIdSchema,
            values: z
              .array(
                z
                  .object({
                    memberId: z.string().trim().min(1).max(200),
                    recordSha256: z.string().regex(/^[a-f0-9]{64}$/u),
                    numericValue: nonnegativeNumericStringSchema,
                  })
                  .strict()
              )
              .min(1)
              .max(1000),
          })
          .strict()
          .superRefine((row, context) => {
            const ids = row.values.map(({ memberId }) => memberId);
            if (
              new Set(ids).size !== ids.length ||
              ids.some((id, index) => index > 0 && ids[index - 1]! >= id)
            ) {
              context.addIssue({
                code: 'custom',
                path: ['values'],
                message: 'Point-in-time feature values must be unique and canonically ordered.',
              });
            }
            if (Date.parse(row.roleKnownAt) > Date.parse(row.featureKnownThrough)) {
              context.addIssue({
                code: 'custom',
                path: ['roleKnownAt'],
                message: 'A governed role must be known by the feature boundary.',
              });
            }
          })
      )
      .min(4)
      .max(100_000),
  })
  .strict()
  .superRefine((set, context) => {
    const ids = set.rows.map(({ datasetRowId }) => datasetRowId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: 'custom',
        path: ['rows'],
        message: 'Point-in-time feature rows must bind unique admitted dataset rows.',
      });
    }
  });

const candidateConfigSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_ADMITTED_PLAYER_CANDIDATE_CONFIG_SCHEMA_VERSION),
    baseline: aflTradePlayerBaselineConfigSchema,
    validation: aflTradePlayerValidationConfigSchema,
    ridgeLambda: z.number().finite().positive().max(1_000_000),
    intervalCoverageLevel: z.number().finite().gt(0.5).lt(1),
  })
  .strict();

type ScalarTransform = z.infer<typeof scalarTransformSchema>;
type PointInTimeFeatureSet = z.infer<typeof aflTradePlayerPointInTimeFeatureSetSchema>;
type ExecutableArtifact = Readonly<{ artifactId: string; bytes: Uint8Array }>;

function parseAuthenticatedJson<T>(input: {
  reference: AflTradeArtifactRef;
  executableArtifacts: readonly ExecutableArtifact[];
  schema: z.ZodType<T>;
  label: string;
}): T {
  const matching = input.executableArtifacts.filter(
    ({ artifactId }) => artifactId === input.reference.artifactId
  );
  if (
    matching.length !== 1 ||
    !doesAflTradeArtifactRefMatchBytes(input.reference, matching[0]!.bytes, 'application/json')
  ) {
    throw new RangeError(`The governed ${input.label} artifact is unavailable.`);
  }
  let document: unknown;
  try {
    document = JSON.parse(new TextDecoder().decode(matching[0]!.bytes));
  } catch {
    throw new RangeError(`The governed ${input.label} artifact is not valid JSON.`);
  }
  const parsed = input.schema.safeParse(document);
  if (!parsed.success) {
    throw new RangeError(`The governed ${input.label} artifact has invalid content.`);
  }
  return parsed.data;
}

export function loadGovernedScalarTransform(input: {
  protocol: AflTradePlayerContributionModelProtocolV2;
  executableArtifacts: readonly ExecutableArtifact[];
}): ScalarTransform {
  const transform = parseAuthenticatedJson({
    reference: input.protocol.content.scalarValueTransformArtifact,
    executableArtifacts: input.executableArtifacts,
    schema: scalarTransformSchema,
    label: 'scalar transform',
  });
  if (transform.valueUnitId !== input.protocol.content.valueUnit.valueUnitId) {
    throw new RangeError('The governed scalar transform does not match the model value unit.');
  }
  return transform;
}

function loadGovernedFeatureSet(input: {
  protocol: AflTradePlayerContributionModelProtocolV2;
  executableArtifacts: readonly ExecutableArtifact[];
  observationSet: AflTradePlayerObservationSetV2;
}): PointInTimeFeatureSet {
  const reference = input.protocol.content.pointInTimeFeatureValuesArtifact;
  if (reference === undefined) {
    throw new RangeError('The protocol has no governed point-in-time feature values artifact.');
  }
  const featureSet = parseAuthenticatedJson({
    reference,
    executableArtifacts: input.executableArtifacts,
    schema: aflTradePlayerPointInTimeFeatureSetSchema,
    label: 'point-in-time feature values',
  });
  if (featureSet.datasetId !== input.observationSet.content.datasetId) {
    throw new RangeError('The governed feature values do not bind the admitted dataset.');
  }
  if (
    featureSet.roleTaxonomyArtifactId !==
      input.protocol.content.footballContext.roleTaxonomyArtifact.artifactId ||
    featureSet.eraDefinitionArtifactId !==
      input.protocol.content.footballContext.eraDefinitionArtifact.artifactId
  ) {
    throw new RangeError('Governed role and era values do not bind the protocol definitions.');
  }
  return featureSet;
}

function metricValue(
  observation: AflTradePlayerObservationSetV2['content']['observations'][number],
  code: 'brownlow_votes' | 'coaches_votes' | 'games' | 'goals'
): number {
  const metric = observation.outcome.metrics.find((candidate) => candidate.metricCode === code);
  const value = metric === undefined ? Number.NaN : Number(metric.numericValue);
  if (!Number.isFinite(value)) {
    throw new RangeError('Admitted player evidence contains a non-numeric target metric.');
  }
  return value;
}

function groupKey(role: string, era: string): string {
  return `${role}\u0000${era}`;
}

function latestFeatureMetrics(input: {
  observation: AflTradePlayerObservationSetV2['content']['observations'][number];
  row: PointInTimeFeatureSet['rows'][number];
  spellMetricById: ReadonlyMap<string, AflTradeAcquisitionSpellMetric>;
}) {
  const expected = [...input.observation.featureInputs].sort((left, right) =>
    left.memberId.localeCompare(right.memberId)
  );
  if (
    input.row.values.length !== expected.length ||
    expected.some((feature, index) => {
      const value = input.row.values[index];
      return (
        value === undefined ||
        value.memberId !== feature.memberId ||
        value.recordSha256 !== feature.recordSha256
      );
    })
  ) {
    throw new RangeError('Point-in-time feature values do not bind the exact admitted members.');
  }
  const latest = new Map<
    'brownlow_votes' | 'coaches_votes' | 'games' | 'goals',
    { effectiveThrough: string; memberId: string; value: number }
  >();
  for (const feature of expected) {
    const retained = input.row.values.find(({ memberId }) => memberId === feature.memberId)!;
    const numericValue = Number(retained.numericValue);
    if (!Number.isFinite(numericValue)) {
      throw new RangeError('Point-in-time feature values must be finite.');
    }
    if (feature.kind !== 'acquisition_spell_metric') continue;
    const fact = input.spellMetricById.get(feature.memberId);
    if (
      fact === undefined ||
      fact.factSha256 !== feature.recordSha256 ||
      fact.content.availability.state !== 'complete' ||
      fact.content.availability.numericValue !== retained.numericValue ||
      fact.content.spell.spellVersionId !== feature.spellVersionId ||
      fact.content.spell.playerId !== feature.playerId ||
      fact.content.spell.playerId !== input.observation.playerId ||
      fact.content.spell.clubId !== feature.clubId ||
      fact.content.spell.clubId !== input.observation.clubId ||
      fact.content.rule.metricCode !== feature.metricCode ||
      fact.content.effectiveThrough !== feature.effectiveThrough ||
      fact.content.recordedAt !== feature.recordedAt
    ) {
      throw new RangeError(
        'A point-in-time feature value does not match its exact authenticated metric fact.'
      );
    }
    const current = latest.get(feature.metricCode);
    if (
      current === undefined ||
      feature.effectiveThrough > current.effectiveThrough ||
      (feature.effectiveThrough === current.effectiveThrough && feature.memberId > current.memberId)
    ) {
      latest.set(feature.metricCode, {
        effectiveThrough: feature.effectiveThrough,
        memberId: feature.memberId,
        value: numericValue,
      });
    }
  }
  return {
    brownlow_votes: latest.get('brownlow_votes')?.value ?? 0,
    coaches_votes: latest.get('coaches_votes')?.value ?? 0,
    games: latest.get('games')?.value ?? 0,
    goals: latest.get('goals')?.value ?? 0,
  };
}

function materializeContributionSet(input: {
  observationSet: AflTradePlayerObservationSetV2;
  transform: ScalarTransform;
  featureSet: PointInTimeFeatureSet;
  spellMetrics: readonly AflTradeAcquisitionSpellMetric[];
}) {
  const spellMetricById = new Map(
    input.spellMetrics.map((metric) => [metric.spellMetricVersionId, metric] as const)
  );
  if (spellMetricById.size !== input.spellMetrics.length) {
    throw new RangeError('Authenticated feature metric facts must be unique.');
  }
  const rowsById = new Map(input.featureSet.rows.map((row) => [row.datasetRowId, row] as const));
  if (
    rowsById.size !== input.observationSet.content.observations.length ||
    input.observationSet.content.observations.some(
      ({ datasetRowId }) => !rowsById.has(datasetRowId)
    )
  ) {
    throw new RangeError(
      'Point-in-time feature rows must cover the exact admitted observation set.'
    );
  }
  const predictorByObservationId = new Map<
    string,
    Readonly<{ expectedGames: number; priorContributionPerGame: number }>
  >();
  const observations = input.observationSet.content.observations.map((observation) => {
    const row = rowsById.get(observation.datasetRowId)!;
    if (
      row.featureKnownThrough !== observation.featureKnownThrough ||
      Date.parse(row.featureKnownThrough) > Date.parse(observation.predictionCutoffAt) ||
      Date.parse(row.roleKnownAt) > Date.parse(observation.predictionCutoffAt)
    ) {
      throw new RangeError('Governed feature and role values must be known at prediction cutoff.');
    }
    const featureMetrics = latestFeatureMetrics({ observation, row, spellMetricById });
    const priorContribution = (
      Object.keys(featureMetrics) as (keyof typeof featureMetrics)[]
    ).reduce((total, code) => total + featureMetrics[code] * input.transform.weights[code], 0);
    const expectedGames = featureMetrics.games;
    predictorByObservationId.set(observation.observationId, {
      expectedGames,
      priorContributionPerGame: expectedGames === 0 ? 0 : priorContribution / expectedGames,
    });
    const targetValues = {
      brownlow_votes: metricValue(observation, 'brownlow_votes'),
      coaches_votes: metricValue(observation, 'coaches_votes'),
      games: metricValue(observation, 'games'),
      goals: metricValue(observation, 'goals'),
    };
    const contribution = (Object.keys(targetValues) as (keyof typeof targetValues)[]).reduce(
      (total, code) => total + targetValues[code] * input.transform.weights[code],
      0
    );
    const targetGames = targetValues.games;
    const targetUniverse = observation.outcome.metrics.find(
      ({ metricCode }) => metricCode === 'games'
    )!.coverageDenominator;
    if (targetUniverse <= 0 || targetGames > targetUniverse) {
      throw new RangeError('Admitted target games require one valid observed match universe.');
    }
    return {
      observationId: observation.observationId,
      playerId: observation.playerId,
      acquisitionSpellId: observation.acquisitionSpellId,
      season: observation.season,
      role: row.role,
      era: row.era,
      partition: observation.partition,
      predictionCutoffAt: observation.predictionCutoffAt,
      roleKnownAt: row.roleKnownAt,
      outcomeObservedAt: observation.outcome.outcomeObservedAt,
      gamesPlayed: targetGames,
      gamesAvailable: targetUniverse,
      contribution: { state: 'observed' as const, total: contribution },
      career: {
        state: 'right_censored' as const,
        censoredAt: observation.outcome.outcomeObservedAt,
      },
    };
  });
  return {
    set: createAflTradePlayerObservationSet({
      schemaVersion: 'afl-trade-player-observation-set/v1',
      publicIdentityBoundary: 'source_native_no_fantasy_ownership',
      valueUnitId: input.transform.valueUnitId,
      observations,
    }),
    predictorByObservationId,
  };
}

interface CandidateCoefficients {
  gamesOnly: number;
  candidateGames: number;
  candidatePriorContribution: number;
}

function fitCandidate(input: {
  set: AflTradePlayerObservationSet;
  baseline: AflTradePlayerBaselineFit;
  predictorByObservationId: ReadonlyMap<
    string,
    Readonly<{ expectedGames: number; priorContributionPerGame: number }>
  >;
  ridgeLambda: number;
}): CandidateCoefficients {
  const replacementByGroup = new Map(
    input.baseline.content.replacementLevels.map((level) => [
      groupKey(level.role, level.era),
      level.replacementContributionPerGame,
    ])
  );
  const training = input.baseline.content.scores.flatMap((score) => {
    if (score.partition !== 'train') return [];
    const predictor = input.predictorByObservationId.get(score.observationId);
    const replacement = replacementByGroup.get(groupKey(score.role, score.era));
    if (predictor === undefined || replacement === undefined) return [];
    return [
      {
        games: predictor.expectedGames,
        priorContribution:
          predictor.expectedGames * (predictor.priorContributionPerGame - replacement),
        target: score.observedContributionAboveReplacement,
      },
    ];
  });
  if (training.length < 2) {
    throw new RangeError('The admitted candidate requires at least two scored training rows.');
  }
  const lambda = input.ridgeLambda;
  const gg = training.reduce((sum, row) => sum + row.games ** 2, 0);
  const gp = training.reduce((sum, row) => sum + row.games * row.priorContribution, 0);
  const pp = training.reduce((sum, row) => sum + row.priorContribution ** 2, 0);
  const gy = training.reduce((sum, row) => sum + row.games * row.target, 0);
  const py = training.reduce((sum, row) => sum + row.priorContribution * row.target, 0);
  const determinant = (gg + lambda) * (pp + lambda) - gp ** 2;
  if (!Number.isFinite(determinant) || determinant <= 0) {
    throw new RangeError('The admitted candidate training matrix is not estimable.');
  }
  const coefficients = {
    gamesOnly: gy / (gg + lambda),
    candidateGames: ((pp + lambda) * gy - gp * py) / determinant,
    candidatePriorContribution: ((gg + lambda) * py - gp * gy) / determinant,
  };
  if (Object.values(coefficients).some((value) => !Number.isFinite(value))) {
    throw new RangeError('The admitted candidate produced non-finite coefficients.');
  }
  return coefficients;
}

function predictionValues(input: {
  observation: AflTradePlayerObservationSet['content']['observations'][number];
  baseline: AflTradePlayerBaselineFit;
  predictorByObservationId: ReadonlyMap<
    string,
    Readonly<{ expectedGames: number; priorContributionPerGame: number }>
  >;
  coefficients: CandidateCoefficients;
}) {
  const predictor = input.predictorByObservationId.get(input.observation.observationId)!;
  const replacement = input.baseline.content.replacementLevels.find(
    ({ role, era }) => role === input.observation.role && era === input.observation.era
  )?.replacementContributionPerGame;
  const priorContribution =
    replacement === undefined
      ? 0
      : predictor.expectedGames * (predictor.priorContributionPerGame - replacement);
  return {
    candidate:
      input.coefficients.candidateGames * predictor.expectedGames +
      input.coefficients.candidatePriorContribution * priorContribution,
    gamesOnly: input.coefficients.gamesOnly * predictor.expectedGames,
  };
}

function createPredictions(input: {
  partition: 'validation' | 'final_test';
  set: AflTradePlayerObservationSet;
  baseline: AflTradePlayerBaselineFit;
  predictorByObservationId: ReadonlyMap<
    string,
    Readonly<{ expectedGames: number; priorContributionPerGame: number }>
  >;
  coefficients: CandidateCoefficients;
  modelId: string;
}) {
  return createAflTradePlayerPredictionSet({
    schemaVersion: 'afl-trade-player-prediction-set/v1',
    publicIdentityBoundary: 'source_native_no_fantasy_ownership',
    observationSetId: input.set.observationSetId,
    baselineFitId: input.baseline.baselineFitId,
    valueUnitId: input.set.content.valueUnitId,
    evaluatedPartition: input.partition,
    candidateModelId: input.modelId,
    candidateSelectionPartitions:
      input.partition === 'validation'
        ? ['train', 'calibration']
        : ['train', 'calibration', 'validation'],
    finalTestRetuning: 'prohibited',
    featurePolicy: 'point_in_time_as_known_at_feature_cutoff',
    gamesOnlyComparator: 'point_in_time_expected_games_only',
    predictions: input.set.content.observations
      .filter(({ partition }) => partition === input.partition)
      .map((observation) => {
        const values = predictionValues({ ...input, observation });
        return {
          observationId: observation.observationId,
          partition: input.partition,
          featureCutoffAt: observation.predictionCutoffAt,
          candidatePredictedContributionAboveReplacement: values.candidate,
          gamesOnlyPredictedContributionAboveReplacement: values.gamesOnly,
        };
      }),
  });
}

function residualsFor(input: {
  partition: 'calibration' | 'validation' | 'final_test';
  set: AflTradePlayerObservationSet;
  baseline: AflTradePlayerBaselineFit;
  predictorByObservationId: ReadonlyMap<
    string,
    Readonly<{ expectedGames: number; priorContributionPerGame: number }>
  >;
  coefficients: CandidateCoefficients;
}) {
  const observationById = new Map(
    input.set.content.observations.map((observation) => [observation.observationId, observation])
  );
  return input.baseline.content.scores.flatMap((score) => {
    if (score.partition !== input.partition) return [];
    const observation = observationById.get(score.observationId)!;
    const prediction = predictionValues({ ...input, observation });
    return [
      {
        observationId: score.observationId,
        role: score.role,
        era: score.era,
        actual: score.observedContributionAboveReplacement,
        candidate: prediction.candidate,
        gamesOnly: prediction.gamesOnly,
        absoluteCandidateError: Math.abs(
          prediction.candidate - score.observedContributionAboveReplacement
        ),
      },
    ];
  });
}

function quantile(values: readonly number[], probability: number): number {
  if (values.length === 0) throw new RangeError('Interval calibration requires scored evidence.');
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(probability * sorted.length) - 1)]!;
}

async function retainArtifacts(input: {
  repository: AflTradeImmutableArtifactRepository;
  createdAt: string;
  maximumArtifactBytes: number;
  documents: Readonly<Record<string, unknown>>;
}) {
  const references: Record<string, AflTradeArtifactRef> = {};
  for (const [name, document] of Object.entries(input.documents)) {
    const reference = createAflTradeCanonicalJsonArtifactRef(document, input.createdAt);
    const bytes = new TextEncoder().encode(canonicalizeAflTradeJson(document));
    const retained = await input.repository.putIfAbsent(reference, bytes);
    await verifyAflTradeArtifactReadback(
      input.repository,
      retained.reference,
      Date.parse(input.createdAt) > Date.parse(retained.reference.createdAt)
        ? input.createdAt
        : retained.reference.createdAt,
      input.maximumArtifactBytes
    );
    references[name] = retained.reference;
  }
  return references;
}

export function createAflTradeAdmittedPlayerContributionExecutor(input: {
  artifactRepository: AflTradeImmutableArtifactRepository;
  maximumArtifactBytes: number;
  now: () => string | Promise<string>;
}): AflTradeAuthorizedModelExecutor {
  return {
    async execute(request) {
      const executorBuild = parseAuthenticatedJson({
        reference: request.intent.content.sourceCodeArtifact,
        executableArtifacts: request.executableArtifacts,
        schema: aflTradeAdmittedPlayerExecutorBuildSchema,
        label: 'admitted player executor build',
      });
      if (
        executorBuild.codeCommitSha !== request.intent.content.codeCommitSha ||
        executorBuild.cleanWorktree !== request.intent.content.cleanWorktree ||
        executorBuild.dependencyLockArtifactId !==
          request.intent.content.dependencyLockArtifact.artifactId ||
        executorBuild.runtimeArtifactId !== request.intent.content.runtimeArtifact.artifactId ||
        executorBuild.containerArtifactId !== request.intent.content.containerArtifact.artifactId ||
        executorBuild.environmentArtifactId !==
          request.intent.content.environmentArtifact.artifactId
      ) {
        throw new RangeError(
          'The authenticated executor build does not bind the declared execution ancestry.'
        );
      }
      const observationSet = aflTradePlayerObservationSetV2Schema.parse(request.observationSet);
      const transform = loadGovernedScalarTransform({
        protocol: request.protocol,
        executableArtifacts: request.executableArtifacts,
      });
      const featureSet = loadGovernedFeatureSet({
        protocol: request.protocol,
        executableArtifacts: request.executableArtifacts,
        observationSet,
      });
      const config = parseAuthenticatedJson({
        reference: request.intent.content.configurationArtifact,
        executableArtifacts: request.executableArtifacts,
        schema: candidateConfigSchema,
        label: 'candidate configuration',
      });
      const materialized = materializeContributionSet({
        observationSet,
        transform,
        featureSet,
        spellMetrics: request.spellMetrics,
      });
      const baseline = fitAflTradePlayerContributionBaseline(materialized.set, config.baseline);
      const coefficients = fitCandidate({
        set: materialized.set,
        baseline,
        predictorByObservationId: materialized.predictorByObservationId,
        ridgeLambda: config.ridgeLambda,
      });
      const validationPredictions = createPredictions({
        partition: 'validation',
        set: materialized.set,
        baseline,
        predictorByObservationId: materialized.predictorByObservationId,
        coefficients,
        modelId: request.intent.content.modelId,
      });
      const validationReport = evaluateAflTradePlayerPredictions(
        materialized.set,
        baseline,
        validationPredictions,
        config.validation
      );
      const calibrationResiduals = residualsFor({
        partition: 'calibration',
        set: materialized.set,
        baseline,
        predictorByObservationId: materialized.predictorByObservationId,
        coefficients,
      });
      const intervalRadius = quantile(
        calibrationResiduals.map(({ absoluteCandidateError }) => absoluteCandidateError),
        config.intervalCoverageLevel
      );
      const candidateLockedAt = await input.now();
      const finalPredictions = createPredictions({
        partition: 'final_test',
        set: materialized.set,
        baseline,
        predictorByObservationId: materialized.predictorByObservationId,
        coefficients,
        modelId: request.intent.content.modelId,
      });
      const finalReport = evaluateAflTradePlayerPredictions(
        materialized.set,
        baseline,
        finalPredictions,
        config.validation
      );
      const finalResiduals = residualsFor({
        partition: 'final_test',
        set: materialized.set,
        baseline,
        predictorByObservationId: materialized.predictorByObservationId,
        coefficients,
      });
      const finalTestEvaluatedAt = await input.now();
      const finishedAt = await input.now();
      const subgroupRows = new Map<string, typeof finalResiduals>();
      for (const residual of finalResiduals) {
        const key = groupKey(residual.role, residual.era);
        const group = subgroupRows.get(key) ?? [];
        group.push(residual);
        subgroupRows.set(key, group);
      }
      const sensitivity = [config.ridgeLambda / 2, config.ridgeLambda * 2].map((ridgeLambda) => {
        const alternative = fitCandidate({
          set: materialized.set,
          baseline,
          predictorByObservationId: materialized.predictorByObservationId,
          ridgeLambda,
        });
        const residuals = residualsFor({
          partition: 'validation',
          set: materialized.set,
          baseline,
          predictorByObservationId: materialized.predictorByObservationId,
          coefficients: alternative,
        });
        return {
          ridgeLambda,
          comparableObservations: residuals.length,
          meanAbsoluteError:
            residuals.reduce((sum, row) => sum + row.absoluteCandidateError, 0) / residuals.length,
        };
      });
      const featureReference = request.protocol.content.pointInTimeFeatureValuesArtifact!;
      const documents = {
        modelArtifact: {
          schemaVersion: AFL_TRADE_ADMITTED_PLAYER_CANDIDATE_SCHEMA_VERSION,
          modelId: request.intent.content.modelId,
          sourceObservationSetId: observationSet.observationSetId,
          materializedObservationSetId: materialized.set.observationSetId,
          scalarTransformArtifactId:
            request.protocol.content.scalarValueTransformArtifact.artifactId,
          pointInTimeFeatureValuesArtifactId: featureReference.artifactId,
          configurationArtifactId: request.intent.content.configurationArtifact.artifactId,
          baselineFitId: baseline.baselineFitId,
          coefficients,
          trainingPartition: 'train',
          finalTestRetuning: 'prohibited',
        },
        selectionValidationReportArtifact: validationReport,
        validationReportArtifact: finalReport,
        baselineComparisonArtifact: baseline,
        calibrationReportArtifact: {
          schemaVersion: 'afl-trade-player-calibration-report/v1',
          observationSetId: materialized.set.observationSetId,
          partition: 'calibration',
          comparableObservations: calibrationResiduals.length,
          absoluteResiduals: calibrationResiduals.map(
            ({ observationId, absoluteCandidateError }) => ({
              observationId,
              absoluteCandidateError,
            })
          ),
          intervalCoverageLevel: config.intervalCoverageLevel,
          calibratedIntervalRadius: intervalRadius,
        },
        intervalCoverageArtifact: {
          schemaVersion: 'afl-trade-player-interval-coverage-report/v1',
          calibrationPartition: 'calibration',
          evaluatedPartition: 'final_test',
          intervalCoverageLevel: config.intervalCoverageLevel,
          intervalRadius,
          comparableObservations: finalResiduals.length,
          coveredObservations: finalResiduals.filter(
            ({ absoluteCandidateError }) => absoluteCandidateError <= intervalRadius
          ).length,
        },
        subgroupReportArtifact: {
          schemaVersion: 'afl-trade-player-subgroup-report/v1',
          evaluatedPartition: 'final_test',
          dimensions: ['role', 'era'],
          groups: [...subgroupRows.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, rows]) => {
              const [role, era] = key.split('\u0000');
              return {
                role,
                era,
                comparableObservations: rows.length,
                meanAbsoluteError:
                  rows.reduce((sum, row) => sum + row.absoluteCandidateError, 0) / rows.length,
              };
            }),
          unsupportedProtocolDimensions: [
            'position',
            'age',
            'availability_state',
            'evidence_quality',
          ],
        },
        sensitivityReportArtifact: {
          schemaVersion: 'afl-trade-player-sensitivity-report/v1',
          evaluatedPartition: 'validation',
          parameter: 'ridgeLambda',
          primary: config.ridgeLambda,
          alternatives: sensitivity,
        },
        leakageAuditArtifact: {
          schemaVersion: 'afl-trade-player-leakage-audit/v1',
          sourceObservationSetId: observationSet.observationSetId,
          featureArtifactId: featureReference.artifactId,
          binding: 'exact_admitted_feature_member_ids_and_hashes',
          verifiedRows: observationSet.content.observations.length,
          targetMemberReuse: 'prohibited_and_rejected',
          featureCutoffPolicy: 'point_in_time_as_known_at_prediction_cutoff',
          targetMetricsUsedOnlyForOutcomeAndEvaluation: true,
        },
        modelCardArtifact: {
          schemaVersion: 'afl-trade-player-model-card/v1',
          modelId: request.intent.content.modelId,
          modelKind: 'ridge_linear_prior_contribution_and_expected_games',
          publicationEligible: false,
          identityBoundary: 'source_native_no_fantasy_ownership',
          trainingPartition: 'train',
          selectionEvidence: validationReport.validationReportId,
          finalEvidence: finalReport.validationReportId,
          limitations: request.protocol.content.limitations,
        },
        diagnosticsArtifact: {
          schemaVersion: 'afl-trade-admitted-player-candidate-diagnostics/v1',
          sourceObservations: observationSet.content.observations.length,
          materializedObservations: materialized.set.content.observations.length,
          scoredTrainingObservations: baseline.content.scores.filter(
            ({ partition }) => partition === 'train'
          ).length,
          calibrationObservations: calibrationResiduals.length,
          validationReportId: validationReport.validationReportId,
          validationOutcome: validationReport.content.acceptanceOutcome,
          finalValidationReportId: finalReport.validationReportId,
          finalValidationOutcome: finalReport.content.acceptanceOutcome,
        },
      };
      const retained = await retainArtifacts({
        repository: input.artifactRepository,
        createdAt: finishedAt,
        maximumArtifactBytes: input.maximumArtifactBytes,
        documents,
      });
      return {
        candidateLockedAt,
        finalTestEvaluatedAt,
        finishedAt,
        outcome: {
          status: 'succeeded' as const,
          modelArtifact: retained.modelArtifact!,
          selectionValidationReportArtifact: retained.selectionValidationReportArtifact!,
          validationReportArtifact: retained.validationReportArtifact!,
          baselineComparisonArtifact: retained.baselineComparisonArtifact!,
          calibrationReportArtifact: retained.calibrationReportArtifact!,
          intervalCoverageArtifact: retained.intervalCoverageArtifact!,
          subgroupReportArtifact: retained.subgroupReportArtifact!,
          sensitivityReportArtifact: retained.sensitivityReportArtifact!,
          leakageAuditArtifact: retained.leakageAuditArtifact!,
          modelCardArtifact: retained.modelCardArtifact!,
          diagnosticsArtifact: retained.diagnosticsArtifact!,
        },
      };
    },
  };
}

export type AflTradeAdmittedPlayerCandidateConfig = z.infer<typeof candidateConfigSchema>;
export type AflTradePlayerPointInTimeFeatureSet = PointInTimeFeatureSet;
