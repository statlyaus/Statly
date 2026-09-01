import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import {
  doesAflTradeArtifactRefMatchCanonicalJson,
  doAflTradeArtifactRefsExactlyMatch,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import {
  aflTradePlayerContributionModelProtocolV2Schema,
  type AflTradePlayerContributionModelProtocolV2,
} from '../artifacts/modelProtocol';
import {
  aflTradeModelRunManifestV3Schema,
  type AflTradeModelRunManifestV3,
} from '../artifacts/modelRunManifest';
import type { AflTradeAcquisitionSpellMetric } from '../outcomes/acquisitionSpellMetricContracts';
import {
  createAflTradeAdmittedPlayerPredictions,
  loadGovernedAflTradePlayerFeatureSet,
  loadGovernedAflTradeAdmittedPlayerCandidate,
  loadGovernedScalarTransform,
  materializeAflTradeAdmittedPlayerContributionSet,
  type AflTradeAdmittedPlayerExecutableArtifact,
} from './admittedPlayerContributionCandidate';
import {
  aflTradePlayerBaselineFitSchema,
  aflTradePlayerObservationSetSchema,
  aflTradePlayerObservationSetV2Schema,
  type AflTradePlayerBaselineFit,
  type AflTradePlayerObservationSet,
  type AflTradePlayerObservationSetV2,
} from './playerContributionContracts';
import { fitAflTradePlayerContributionBaseline } from './playerContributionBaseline';
import {
  aflTradePlayerPredictionSetSchema,
  type AflTradePlayerPredictionSet,
} from './playerContributionValidation';
import {
  aflTradePlayerPavObservationSetSchema,
  type AflTradePlayerPavObservationSet,
} from './playerPavObservationContracts';

export const AFL_TRADE_PLAYER_AGGREGATE_STAT_RESIDUAL_AUDIT_SCHEMA_VERSION =
  'afl-trade-player-aggregate-stat-residual-audit/v1' as const;
export const AFL_TRADE_PLAYER_AGGREGATE_STAT_RESIDUAL_AUDIT_CONFIG_SCHEMA_VERSION =
  'afl-trade-player-aggregate-stat-residual-audit-config/v1' as const;

const finite = z.number().finite();
const publicId = z.string().trim().min(1).max(240);
const featureSchema = z.enum([
  'offensive_pav_per_game',
  'midfield_pav_per_game',
  'defensive_pav_per_game',
  'total_pav_per_game',
  'historical_games_per_feature_season',
]);
const profileSchema = z.enum(['offensive', 'midfield', 'defensive', 'mixed']);

export const aflTradePlayerAggregateStatResidualAuditConfigSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PLAYER_AGGREGATE_STAT_RESIDUAL_AUDIT_CONFIG_SCHEMA_VERSION),
    minimumComparableObservations: z.number().int().positive().max(100_000),
    minimumCorrelationObservations: z.number().int().min(2).max(100_000),
    governanceEffect: z.literal('evidence_only_no_gate_model_selection_promotion_or_publication'),
  })
  .strict();

const errorSummarySchema = z
  .object({ meanAbsoluteError: z.number().finite().nonnegative(), meanError: finite })
  .strict();
const residualSummarySchema = errorSummarySchema
  .extend({
    signedResidualCorrelation: finite.min(-1).max(1).nullable(),
    absoluteResidualCorrelation: finite.min(-1).max(1).nullable(),
  })
  .strict();

const reportContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PLAYER_AGGREGATE_STAT_RESIDUAL_AUDIT_SCHEMA_VERSION),
    publicIdentityBoundary: z.literal('source_native_no_fantasy_ownership'),
    publicationEligible: z.literal(false),
    sourceObservationSetId: aflTradeContentAddressedIdSchema('player-observation-set'),
    materializedObservationSetId: aflTradeContentAddressedIdSchema('player-observation-set'),
    modelProtocolId: aflTradeContentAddressedIdSchema('model-protocol'),
    scalarTransformArtifactId: aflTradeContentAddressedIdSchema('artifact'),
    pointInTimeFeatureValuesArtifactId: aflTradeContentAddressedIdSchema('artifact'),
    candidateModelArtifactId: aflTradeContentAddressedIdSchema('artifact'),
    modelRunId: aflTradeContentAddressedIdSchema('model-run'),
    baselineFitId: aflTradeContentAddressedIdSchema('player-baseline-fit'),
    predictionSetId: aflTradeContentAddressedIdSchema('player-prediction-set'),
    pavObservationSetId: aflTradeContentAddressedIdSchema('player-pav-observation-set'),
    valueUnitId: publicId,
    evaluatedPartition: z.enum(['validation', 'final_test']),
    config: aflTradePlayerAggregateStatResidualAuditConfigSchema,
    coverage: z
      .object({
        evaluatedObservationCount: z.number().int().positive(),
        comparableObservationCount: z.number().int().positive(),
        excludedObservations: z.array(
          z
            .object({
              observationId: publicId,
              reason: z.enum([
                'baseline_unscored',
                'missing_pav_observation',
                'incomplete_historical_pav',
              ]),
            })
            .strict()
        ),
      })
      .strict(),
    featureResiduals: z.array(
      z
        .object({
          feature: featureSchema,
          count: z.number().int().positive(),
          candidate: residualSummarySchema,
          gamesOnly: residualSummarySchema,
          correlationStatus: z.enum(['available', 'insufficient_support', 'no_variance']),
        })
        .strict()
    ),
    componentProfiles: z.array(
      z
        .object({
          profile: profileSchema,
          count: z.number().int().positive(),
          candidate: errorSummarySchema,
          gamesOnly: errorSummarySchema,
        })
        .strict()
    ),
    leakageFence: z
      .object({
        pavFeatureValuesUsed: z.literal(true),
        pavTargetValuesUsed: z.literal(false),
        contributionOutcomeUsedOnlyForHeldOutResidual: z.literal(true),
      })
      .strict(),
    evidenceLimitation: z.literal(
      'diagnostic_report_only_not_model_input_source_approval_gate_approval_production_readiness_or_publication'
    ),
  })
  .strict();

export const aflTradePlayerAggregateStatResidualAuditSchema = z
  .object({
    auditReportId: aflTradeContentAddressedIdSchema('player-aggregate-stat-residual-audit'),
    content: reportContentSchema,
  })
  .strict()
  .superRefine((report, context) => {
    addAflTradeContentAddressIssue(
      'player-aggregate-stat-residual-audit',
      report.auditReportId,
      report.content,
      context,
      ['auditReportId']
    );
  });

export type AflTradePlayerAggregateStatResidualAuditConfig = z.infer<
  typeof aflTradePlayerAggregateStatResidualAuditConfigSchema
>;
export type AflTradePlayerAggregateStatResidualAudit = z.infer<
  typeof aflTradePlayerAggregateStatResidualAuditSchema
>;

interface ComparableRow {
  candidateResidual: number;
  gamesOnlyResidual: number;
  profile: z.infer<typeof profileSchema>;
  features: Record<z.infer<typeof featureSchema>, number>;
}

function mean(values: readonly number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function correlation(left: readonly number[], right: readonly number[]): number | null {
  const leftMean = mean(left);
  const rightMean = mean(right);
  const numerator = left.reduce(
    (sum, value, index) => sum + (value - leftMean) * (right[index]! - rightMean),
    0
  );
  const leftScale = Math.sqrt(left.reduce((sum, value) => sum + (value - leftMean) ** 2, 0));
  const rightScale = Math.sqrt(right.reduce((sum, value) => sum + (value - rightMean) ** 2, 0));
  return leftScale === 0 || rightScale === 0 ? null : numerator / (leftScale * rightScale);
}

function errorSummary(
  rows: readonly ComparableRow[],
  key: 'candidateResidual' | 'gamesOnlyResidual'
) {
  const residuals = rows.map((row) => row[key]);
  return { meanAbsoluteError: mean(residuals.map(Math.abs)), meanError: mean(residuals) };
}

function dominantProfile(offensive: number, midfield: number, defensive: number) {
  const magnitudes = [Math.abs(offensive), Math.abs(midfield), Math.abs(defensive)];
  const maximum = Math.max(...magnitudes);
  return magnitudes.filter((value) => value === maximum).length === 1
    ? (['offensive', 'midfield', 'defensive'][magnitudes.indexOf(maximum)] as z.infer<
        typeof profileSchema
      >)
    : ('mixed' as const);
}

function summarizePavFeatureValues(
  pav: AflTradePlayerPavObservationSet['content']['observations'][number]
) {
  const coveredSeasons = new Set(pav.featureValues.map(({ seasonYear }) => seasonYear));
  const complete =
    coveredSeasons.size === pav.featureCalculationSeasons.length &&
    pav.featureCalculationSeasons.every((season) => coveredSeasons.has(season));
  const totals = pav.featureValues.reduce(
    (summary, value) => ({
      games: summary.games + value.gamesPlayed,
      offensive: summary.offensive + value.offensivePav,
      midfield: summary.midfield + value.midfieldPav,
      defensive: summary.defensive + value.defensivePav,
      total: summary.total + value.totalPav,
    }),
    { games: 0, offensive: 0, midfield: 0, defensive: 0, total: 0 }
  );
  return { complete, totals };
}

export function evaluateAflTradePlayerAggregateStatResiduals(input: {
  contributionObservationSet: AflTradePlayerObservationSetV2;
  materializedContributionObservationSet: AflTradePlayerObservationSet;
  protocol: AflTradePlayerContributionModelProtocolV2;
  candidateModelArtifact: AflTradeArtifactRef;
  modelRunManifest: AflTradeModelRunManifestV3;
  spellMetrics: readonly AflTradeAcquisitionSpellMetric[];
  executableArtifacts: readonly AflTradeAdmittedPlayerExecutableArtifact[];
  baselineFit: AflTradePlayerBaselineFit;
  predictionSet: AflTradePlayerPredictionSet;
  pavObservationSet: AflTradePlayerPavObservationSet;
  config: AflTradePlayerAggregateStatResidualAuditConfig;
}): AflTradePlayerAggregateStatResidualAudit {
  const contributionSet = aflTradePlayerObservationSetV2Schema.parse(
    input.contributionObservationSet
  );
  const materializedSet = aflTradePlayerObservationSetSchema.parse(
    input.materializedContributionObservationSet
  );
  const protocol = aflTradePlayerContributionModelProtocolV2Schema.parse(input.protocol);
  const modelRun = aflTradeModelRunManifestV3Schema.parse(input.modelRunManifest);
  const baseline = aflTradePlayerBaselineFitSchema.parse(input.baselineFit);
  const predictions = aflTradePlayerPredictionSetSchema.parse(input.predictionSet);
  const pavSet = aflTradePlayerPavObservationSetSchema.parse(input.pavObservationSet);
  const config = aflTradePlayerAggregateStatResidualAuditConfigSchema.parse(input.config);
  if (
    contributionSet.content.modelProtocolId !== protocol.protocolId ||
    contributionSet.content.datasetId !== protocol.content.datasetId ||
    contributionSet.content.datasetAdmissionId !== protocol.content.datasetAdmission.admissionId
  ) {
    throw new RangeError(
      'Residual-audit protocol must bind the exact admitted dataset and observation set.'
    );
  }
  const transform = loadGovernedScalarTransform({
    protocol,
    executableArtifacts: input.executableArtifacts,
  });
  const featureSet = loadGovernedAflTradePlayerFeatureSet({
    protocol,
    executableArtifacts: input.executableArtifacts,
    observationSet: contributionSet,
  });
  const replayedMaterialization = materializeAflTradeAdmittedPlayerContributionSet({
    observationSet: contributionSet,
    transform,
    featureSet,
    spellMetrics: input.spellMetrics,
  });
  if (replayedMaterialization.set.observationSetId !== materializedSet.observationSetId) {
    throw new RangeError(
      'Residual-audit materialized contribution set must equal the governed deterministic replay.'
    );
  }
  if (
    baseline.content.observationSetId !== materializedSet.observationSetId ||
    predictions.content.observationSetId !== materializedSet.observationSetId ||
    predictions.content.baselineFitId !== baseline.baselineFitId ||
    predictions.content.valueUnitId !== baseline.content.valueUnitId ||
    baseline.content.valueUnitId !== materializedSet.content.valueUnitId
  ) {
    throw new RangeError(
      'Residual-audit artifacts must bind the same observation set, fit, and unit.'
    );
  }
  const expectedBaseline = fitAflTradePlayerContributionBaseline(
    materializedSet,
    baseline.content.config
  );
  if (expectedBaseline.baselineFitId !== baseline.baselineFitId) {
    throw new RangeError(
      'Residual-audit baseline must equal the deterministic fit of the materialized contribution set.'
    );
  }
  const candidateModel = loadGovernedAflTradeAdmittedPlayerCandidate({
    reference: input.candidateModelArtifact,
    executableArtifacts: input.executableArtifacts,
  });
  if (
    modelRun.content.outcome.status !== 'succeeded' ||
    modelRun.content.modelId !== candidateModel.modelId ||
    modelRun.content.datasetId !== contributionSet.content.datasetId ||
    modelRun.content.datasetAdmissionId !== contributionSet.content.datasetAdmissionId ||
    modelRun.content.modelProtocolId !== protocol.protocolId ||
    modelRun.content.observationSetId !== contributionSet.observationSetId ||
    modelRun.content.configurationArtifact.artifactId !== candidateModel.configurationArtifactId ||
    !doAflTradeArtifactRefsExactlyMatch(
      modelRun.content.outcome.modelArtifact,
      input.candidateModelArtifact
    ) ||
    !doesAflTradeArtifactRefMatchCanonicalJson(
      modelRun.content.outcome.baselineComparisonArtifact,
      baseline
    ) ||
    candidateModel.sourceObservationSetId !== contributionSet.observationSetId ||
    candidateModel.materializedObservationSetId !== materializedSet.observationSetId ||
    candidateModel.baselineFitId !== baseline.baselineFitId ||
    candidateModel.scalarTransformArtifactId !==
      protocol.content.scalarValueTransformArtifact.artifactId ||
    candidateModel.pointInTimeFeatureValuesArtifactId !==
      protocol.content.pointInTimeFeatureValuesArtifact!.artifactId ||
    candidateModel.modelId !== predictions.content.candidateModelId
  ) {
    throw new RangeError(
      'Residual-audit candidate model must bind the exact governed materialization and baseline.'
    );
  }
  const admittedObservationIds = contributionSet.content.observations
    .map(({ observationId }) => observationId)
    .sort();
  const baselineInputIds = [...baseline.content.inputObservationIds].sort();
  if (
    admittedObservationIds.length !== baselineInputIds.length ||
    admittedObservationIds.some((observationId, index) => observationId !== baselineInputIds[index])
  ) {
    throw new RangeError(
      'Residual-audit baseline membership must equal the admitted observation set.'
    );
  }

  const partition = predictions.content.evaluatedPartition;
  const replayedPredictions = createAflTradeAdmittedPlayerPredictions({
    partition,
    set: materializedSet,
    baseline,
    predictorByObservationId: replayedMaterialization.predictorByObservationId,
    coefficients: candidateModel.coefficients,
    modelId: candidateModel.modelId,
  });
  if (replayedPredictions.predictionSetId !== predictions.predictionSetId) {
    throw new RangeError(
      'Residual-audit predictions must equal the locked candidate-model replay.'
    );
  }
  const evaluated = contributionSet.content.observations.filter(
    (observation) => observation.partition === partition
  );
  if (
    predictions.content.predictions.length !== evaluated.length ||
    evaluated.some(
      ({ observationId }) =>
        !predictions.content.predictions.some(
          (prediction) => prediction.observationId === observationId
        )
    )
  ) {
    throw new RangeError(
      'Residual-audit prediction coverage must exactly match the held-out partition.'
    );
  }

  const comparable: ComparableRow[] = [];
  const excluded: Array<{
    observationId: string;
    reason: 'baseline_unscored' | 'missing_pav_observation' | 'incomplete_historical_pav';
  }> = [];
  for (const observation of evaluated) {
    const prediction = predictions.content.predictions.find(
      (candidate) => candidate.observationId === observation.observationId
    )!;
    if (prediction.featureCutoffAt !== observation.predictionCutoffAt) {
      throw new RangeError('Residual-audit prediction cutoff must match the admitted observation.');
    }
    const score = baseline.content.scores.find(
      (candidate) => candidate.observationId === observation.observationId
    );
    if (!score) {
      excluded.push({ observationId: observation.observationId, reason: 'baseline_unscored' });
      continue;
    }
    if (
      score.playerId !== observation.playerId ||
      score.season !== observation.season ||
      score.partition !== observation.partition
    ) {
      throw new RangeError(
        'Residual-audit baseline score must match the admitted player and season.'
      );
    }
    const pavMatches = pavSet.content.observations.filter(
      (candidate) =>
        candidate.partition === partition &&
        candidate.playerId === observation.playerId &&
        candidate.acquisitionSpell.spellId === observation.acquisitionSpellId &&
        candidate.acquisitionSpell.spellVersionId === observation.acquisitionSpellVersionId &&
        candidate.predictionSeason + 1 === observation.season
    );
    if (pavMatches.length > 1) {
      throw new RangeError('Residual audit found duplicate exact player-PAV matches.');
    }
    const pav = pavMatches[0];
    if (!pav) {
      excluded.push({
        observationId: observation.observationId,
        reason: 'missing_pav_observation',
      });
      continue;
    }
    if (
      Date.parse(pav.predictionCutoffAt) > Date.parse(observation.predictionCutoffAt) ||
      pav.featureValues.some(
        (value) =>
          Date.parse(value.effectiveThrough) > Date.parse(observation.featureKnownThrough) ||
          Date.parse(value.calculatedAt) > Date.parse(observation.featureKnownThrough)
      )
    ) {
      throw new RangeError('Player-PAV features were not known by the admitted prediction cutoff.');
    }
    const featureSummary = summarizePavFeatureValues(pav);
    if (!featureSummary.complete || featureSummary.totals.games === 0) {
      excluded.push({
        observationId: observation.observationId,
        reason: 'incomplete_historical_pav',
      });
      continue;
    }
    const { games, offensive, midfield, defensive, total } = featureSummary.totals;
    const offensivePerGame = offensive / games;
    const midfieldPerGame = midfield / games;
    const defensivePerGame = defensive / games;
    comparable.push({
      candidateResidual:
        prediction.candidatePredictedContributionAboveReplacement -
        score.observedContributionAboveReplacement,
      gamesOnlyResidual:
        prediction.gamesOnlyPredictedContributionAboveReplacement -
        score.observedContributionAboveReplacement,
      profile: dominantProfile(offensivePerGame, midfieldPerGame, defensivePerGame),
      features: {
        offensive_pav_per_game: offensivePerGame,
        midfield_pav_per_game: midfieldPerGame,
        defensive_pav_per_game: defensivePerGame,
        total_pav_per_game: total / games,
        historical_games_per_feature_season: games / pav.featureCalculationSeasons.length,
      },
    });
  }
  if (comparable.length < config.minimumComparableObservations) {
    throw new RangeError(
      'Residual-audit comparable observations do not meet the declared minimum.'
    );
  }

  const featureResiduals = featureSchema.options.map((feature) => {
    const values = comparable.map((row) => row.features[feature]);
    const candidateResiduals = comparable.map((row) => row.candidateResidual);
    const gamesOnlyResiduals = comparable.map((row) => row.gamesOnlyResidual);
    const hasSupport = comparable.length >= config.minimumCorrelationObservations;
    const candidateSigned = hasSupport ? correlation(values, candidateResiduals) : null;
    const candidateAbsolute = hasSupport
      ? correlation(values, candidateResiduals.map(Math.abs))
      : null;
    const gamesOnlySigned = hasSupport ? correlation(values, gamesOnlyResiduals) : null;
    const gamesOnlyAbsolute = hasSupport
      ? correlation(values, gamesOnlyResiduals.map(Math.abs))
      : null;
    return {
      feature,
      count: comparable.length,
      candidate: {
        ...errorSummary(comparable, 'candidateResidual'),
        signedResidualCorrelation: candidateSigned,
        absoluteResidualCorrelation: candidateAbsolute,
      },
      gamesOnly: {
        ...errorSummary(comparable, 'gamesOnlyResidual'),
        signedResidualCorrelation: gamesOnlySigned,
        absoluteResidualCorrelation: gamesOnlyAbsolute,
      },
      correlationStatus: !hasSupport
        ? ('insufficient_support' as const)
        : [candidateSigned, candidateAbsolute, gamesOnlySigned, gamesOnlyAbsolute].some(
              (value) => value === null
            )
          ? ('no_variance' as const)
          : ('available' as const),
    };
  });
  const componentProfiles = profileSchema.options.flatMap((profile) => {
    const rows = comparable.filter((row) => row.profile === profile);
    return rows.length === 0
      ? []
      : [
          {
            profile,
            count: rows.length,
            candidate: errorSummary(rows, 'candidateResidual'),
            gamesOnly: errorSummary(rows, 'gamesOnlyResidual'),
          },
        ];
  });
  const content = reportContentSchema.parse({
    schemaVersion: AFL_TRADE_PLAYER_AGGREGATE_STAT_RESIDUAL_AUDIT_SCHEMA_VERSION,
    publicIdentityBoundary: 'source_native_no_fantasy_ownership',
    publicationEligible: false,
    sourceObservationSetId: contributionSet.observationSetId,
    materializedObservationSetId: materializedSet.observationSetId,
    modelProtocolId: protocol.protocolId,
    scalarTransformArtifactId: protocol.content.scalarValueTransformArtifact.artifactId,
    pointInTimeFeatureValuesArtifactId:
      protocol.content.pointInTimeFeatureValuesArtifact!.artifactId,
    candidateModelArtifactId: input.candidateModelArtifact.artifactId,
    modelRunId: modelRun.runId,
    baselineFitId: baseline.baselineFitId,
    predictionSetId: predictions.predictionSetId,
    pavObservationSetId: pavSet.observationSetId,
    valueUnitId: baseline.content.valueUnitId,
    evaluatedPartition: partition,
    config,
    coverage: {
      evaluatedObservationCount: evaluated.length,
      comparableObservationCount: comparable.length,
      excludedObservations: excluded.sort((left, right) =>
        left.observationId.localeCompare(right.observationId)
      ),
    },
    featureResiduals,
    componentProfiles,
    leakageFence: {
      pavFeatureValuesUsed: true,
      pavTargetValuesUsed: false,
      contributionOutcomeUsedOnlyForHeldOutResidual: true,
    },
    evidenceLimitation:
      'diagnostic_report_only_not_model_input_source_approval_gate_approval_production_readiness_or_publication',
  });
  return aflTradePlayerAggregateStatResidualAuditSchema.parse({
    auditReportId: createAflTradeContentAddress('player-aggregate-stat-residual-audit', content),
    content,
  });
}
