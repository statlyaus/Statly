import { describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { aflTradeModelRunManifestV3Schema } from '@/server/aflTradeIntelligence/artifacts/modelRunManifest';
import {
  createAflTradeAdmittedPlayerPredictions,
  loadGovernedAflTradePlayerFeatureSet,
  loadGovernedScalarTransform,
  materializeAflTradeAdmittedPlayerContributionSet,
} from '@/server/aflTradeIntelligence/modeling/admittedPlayerContributionCandidate';
import {
  aflTradePlayerBaselineFitSchema,
  type AflTradePlayerObservationSetV2,
} from '@/server/aflTradeIntelligence/modeling/playerContributionContracts';
import { fitAflTradePlayerContributionBaseline } from '@/server/aflTradeIntelligence/modeling/playerContributionBaseline';
import { createAflTradePlayerPredictionSet } from '@/server/aflTradeIntelligence/modeling/playerContributionValidation';
import {
  evaluateAflTradePlayerAggregateStatResiduals,
  type AflTradePlayerAggregateStatResidualAuditConfig,
} from '@/server/aflTradeIntelligence/modeling/playerAggregateStatResidualAudit';
import {
  createAflTradePlayerPavObservation,
  createAflTradePlayerPavObservationSet,
  createAflTradePlayerPavPolicy,
  type AflTradePlayerPavObservationSet,
} from '@/server/aflTradeIntelligence/modeling/playerPavObservationContracts';

import { admittedRunFixture, runContent } from '../testUtils/admittedPlayerModelRunFixture';

const digest = (marker: string) => marker.repeat(64);
const methodId = `hpn-pav-method:${digest('a')}`;
const releaseId = `outcome-release:${digest('b')}`;

const config: AflTradePlayerAggregateStatResidualAuditConfig = {
  schemaVersion: 'afl-trade-player-aggregate-stat-residual-audit-config/v1',
  minimumComparableObservations: 1,
  minimumCorrelationObservations: 3,
  governanceEffect: 'evidence_only_no_gate_model_selection_promotion_or_publication',
};

function calculation(seasonYear: number) {
  const sha = seasonYear.toString(16).padStart(64, '0');
  return {
    calculationId: `hpn-pav-season:${sha}`,
    calculationSha256: sha,
    inputSetId: createAflTradeContentAddress('hpn-pav-input-set', { seasonYear }),
    methodId,
    seasonYear,
    effectiveThrough: `${seasonYear}-12-31T23:59:59.000Z`,
    calculatedAt: `${seasonYear}-12-31T23:59:59.999Z`,
  };
}

function pavObservation(
  observation: AflTradePlayerObservationSetV2['content']['observations'][number],
  ordinal: number
) {
  const predictionSeason = observation.season - 1;
  const finalized = calculation(predictionSeason);
  const scale = ordinal;
  return createAflTradePlayerPavObservation({
    ordinal,
    partition: observation.partition,
    predictionSeason,
    predictionCutoffAt: `${predictionSeason}-12-31T23:59:59.999Z`,
    outcomeHorizonEndsAt: `${observation.season}-12-31T23:59:59.999Z`,
    outcomeObservedAt: `${observation.season}-12-31T23:59:59.999Z`,
    releaseId,
    playerId: observation.playerId,
    acquisitionSpell: {
      spellId: observation.acquisitionSpellId,
      spellVersionId: observation.acquisitionSpellVersionId,
      clubId: observation.clubId,
      effectiveFrom: `${predictionSeason}-01-01`,
      effectiveThrough: null,
      recordedAt: `${predictionSeason}-01-01T00:00:00.000Z`,
    },
    featureCalculationSeasons: [predictionSeason],
    featureValues: [
      {
        calculationId: finalized.calculationId,
        calculationSha256: finalized.calculationSha256,
        seasonYear: finalized.seasonYear,
        effectiveThrough: finalized.effectiveThrough,
        calculatedAt: finalized.calculatedAt,
        spellVersionId: observation.acquisitionSpellVersionId,
        playerId: observation.playerId,
        playerSha256: digest(String(ordinal)),
        clubId: observation.clubId,
        sourceRowIds: [`source-row:${ordinal}`],
        gamesPlayed: 1,
        offensivePav: scale,
        midfieldPav: scale * 2,
        defensivePav: scale * 3,
        totalPav: scale * 6,
      },
    ],
    targetCalculationSeasons: [observation.season],
    targetValues: [],
    outcome: { state: 'unavailable', reason: 'source_missing' },
  });
}

function fixture(additionalFinalRows = 0) {
  const admitted = admittedRunFixture('non_production', undefined, { additionalFinalRows });
  const contributionObservationSet = admitted.observationSet;
  const observations = contributionObservationSet.content.observations;
  const transform = loadGovernedScalarTransform({
    protocol: admitted.protocol,
    executableArtifacts: admitted.evidence.executableArtifacts,
  });
  const featureSet = loadGovernedAflTradePlayerFeatureSet({
    protocol: admitted.protocol,
    executableArtifacts: admitted.evidence.executableArtifacts,
    observationSet: contributionObservationSet,
  });
  const materialized = materializeAflTradeAdmittedPlayerContributionSet({
    observationSet: contributionObservationSet,
    transform,
    featureSet,
    spellMetrics: admitted.evidence.spellMetrics,
  });
  const materializedContributionObservationSet = materialized.set;
  const baselineFit = fitAflTradePlayerContributionBaseline(
    materializedContributionObservationSet,
    {
      schemaVersion: 'afl-trade-player-baseline-config/v1' as const,
      replacementQuantile: 0.5,
      minimumGamesForReplacementFit: 1,
      minimumTrainingObservationsPerGroup: 2,
      weighting: 'games_played' as const,
      replacementStratification: 'role_and_era' as const,
      unavailableAndZeroTreatment: 'distinct' as const,
      activeCareerTreatment: 'right_censored' as const,
    }
  );
  const candidateModel = {
    schemaVersion: 'afl-trade-admitted-player-candidate/v1' as const,
    modelId: admitted.intent.content.modelId,
    sourceObservationSetId: contributionObservationSet.observationSetId,
    materializedObservationSetId: materializedContributionObservationSet.observationSetId,
    scalarTransformArtifactId: admitted.protocol.content.scalarValueTransformArtifact.artifactId,
    pointInTimeFeatureValuesArtifactId:
      admitted.protocol.content.pointInTimeFeatureValuesArtifact!.artifactId,
    configurationArtifactId: admitted.intent.content.configurationArtifact.artifactId,
    baselineFitId: baselineFit.baselineFitId,
    coefficients: { gamesOnly: 0, candidateGames: 0, candidatePriorContribution: 0 },
    trainingPartition: 'train' as const,
    finalTestRetuning: 'prohibited' as const,
  };
  const candidateModelArtifact = createAflTradeCanonicalJsonArtifactRef(
    candidateModel,
    '2026-08-10T00:03:01.000Z'
  );
  const baselineArtifact = createAflTradeCanonicalJsonArtifactRef(
    baselineFit,
    '2026-08-10T00:03:01.000Z'
  );
  const runTemplate = runContent(admitted.protocol);
  const modelRunContent = {
    ...runTemplate,
    environment: 'non_production' as const,
    modelId: candidateModel.modelId,
    datasetId: contributionObservationSet.content.datasetId,
    datasetAdmissionId: contributionObservationSet.content.datasetAdmissionId,
    modelProtocolId: admitted.protocol.protocolId,
    runIntentId: admitted.intent.intentId,
    observationSetId: contributionObservationSet.observationSetId,
    modelTrainingEvaluationReceiptIds: admitted.intent.content.modelTrainingEvaluationReceiptIds,
    configurationArtifact: admitted.intent.content.configurationArtifact,
    outcome: {
      ...runTemplate.outcome,
      modelArtifact: candidateModelArtifact,
      baselineComparisonArtifact: baselineArtifact,
    },
  };
  const modelRunManifest = aflTradeModelRunManifestV3Schema.parse({
    runId: createAflTradeContentAddress('model-run', modelRunContent),
    content: modelRunContent,
  });
  const executableArtifacts = [
    ...admitted.evidence.executableArtifacts,
    {
      artifactId: candidateModelArtifact.artifactId,
      bytes: new TextEncoder().encode(canonicalizeAflTradeJson(candidateModel)),
    },
  ];
  const predictionSet = createAflTradeAdmittedPlayerPredictions({
    partition: 'final_test',
    set: materializedContributionObservationSet,
    baseline: baselineFit,
    predictorByObservationId: materialized.predictorByObservationId,
    coefficients: candidateModel.coefficients,
    modelId: candidateModel.modelId,
  });
  const pavObservations = observations.map((observation, index) =>
    pavObservation(observation, index + 1)
  );
  const policy = createAflTradePlayerPavPolicy({
    schemaVersion: 'afl-trade-player-pav-policy/v1',
    authorityBoundary:
      'private_released_acquisition_spell_exact_finalized_hpn_pav_no_grade_publication_or_fantasy_ownership',
    publicationEligible: false,
    environment: 'non_production',
    competition: 'AFLM',
    policyVersion: 'aggregate-stat-residual-audit-fixture-v1',
    featureHistorySeasons: 1,
    fixedHorizonSeasons: 1,
    methodId,
    sourceValueUnit: 'season_pav',
    outcomeValueUnit: 'fixed_horizon_pav',
    partitions: [
      { role: 'train', fromPredictionSeason: 2010, throughPredictionSeason: 2010 },
      { role: 'calibration', fromPredictionSeason: 2013, throughPredictionSeason: 2013 },
      { role: 'validation', fromPredictionSeason: 2016, throughPredictionSeason: 2016 },
      { role: 'final_test', fromPredictionSeason: 2019, throughPredictionSeason: 2019 },
    ],
    approvalDecision: { id: `review-decision:${digest('c')}`, sha256: digest('c') },
    createdAt: '2026-08-10T00:00:00.000Z',
  });
  const pavObservationSet = createAflTradePlayerPavObservationSet({
    schemaVersion: 'afl-trade-player-pav-observation-set/v1',
    authorityBoundary:
      'private_released_acquisition_spell_exact_finalized_hpn_pav_no_grade_publication_or_fantasy_ownership',
    publicationEligible: false,
    environment: 'non_production',
    competition: 'AFLM',
    createdAt: '2026-08-10T00:00:00.000Z',
    knowledgeCutoffAt: '2026-08-09T23:59:59.999Z',
    releaseId,
    policy,
    calculations: [...new Set(observations.map(({ season }) => season - 1))].map(calculation),
    observations: pavObservations,
    observationCount: pavObservations.length,
    observationSetSha256: digest('0'),
  });
  return {
    contributionObservationSet,
    materializedContributionObservationSet,
    protocol: admitted.protocol,
    candidateModelArtifact,
    modelRunManifest,
    spellMetrics: admitted.evidence.spellMetrics,
    executableArtifacts,
    baselineFit,
    predictionSet,
    pavObservationSet,
  };
}

function rebuildPavSet(
  set: AflTradePlayerPavObservationSet,
  options: {
    observations?: AflTradePlayerPavObservationSet['content']['observations'];
    calculations?: AflTradePlayerPavObservationSet['content']['calculations'];
  }
) {
  const observations = options.observations ?? set.content.observations;
  return createAflTradePlayerPavObservationSet({
    ...set.content,
    observations,
    calculations: options.calculations ?? set.content.calculations,
    observationCount: observations.length,
  });
}

function withFinalPavTarget(set: AflTradePlayerPavObservationSet, components: number[]) {
  const targetCalculation = calculation(2020);
  const observations = set.content.observations.map((observation) => {
    if (observation.partition !== 'final_test') return observation;
    const [offensivePav, midfieldPav, defensivePav] = components;
    const totalPav = offensivePav! + midfieldPav! + defensivePav!;
    return createAflTradePlayerPavObservation({
      ...observation,
      targetValues: [
        {
          calculationId: targetCalculation.calculationId,
          calculationSha256: targetCalculation.calculationSha256,
          seasonYear: targetCalculation.seasonYear,
          effectiveThrough: targetCalculation.effectiveThrough,
          calculatedAt: targetCalculation.calculatedAt,
          spellVersionId: observation.acquisitionSpell.spellVersionId,
          playerId: observation.playerId,
          playerSha256: digest('9'),
          clubId: observation.acquisitionSpell.clubId,
          sourceRowIds: ['source-row:future'],
          gamesPlayed: 1,
          offensivePav,
          midfieldPav,
          defensivePav,
          totalPav,
        },
      ],
      outcome: {
        state: 'mature_observed',
        contribution: totalPav,
        gamesPlayed: 1,
        seasonsObserved: 1,
      },
    });
  });
  return rebuildPavSet(set, {
    observations,
    calculations: [...set.content.calculations, targetCalculation],
  });
}

function workedRelationshipFixture() {
  const base = fixture(3);
  const componentRows = [
    { components: [5, 10, 15], games: 1 },
    { components: [12, 3, 3], games: 1 },
    { components: [3, 12, 3], games: 2 },
    { components: [5, 5, 1], games: 3 },
  ];
  const pavObservationSet = rebuildPavSet(base.pavObservationSet, {
    observations: base.pavObservationSet.content.observations.map((observation) => {
      if (observation.partition !== 'final_test') return observation;
      const finalIndex = base.pavObservationSet.content.observations
        .filter(({ partition }) => partition === 'final_test')
        .findIndex(({ observationId }) => observationId === observation.observationId);
      const [offensivePav, midfieldPav, defensivePav] = componentRows[finalIndex]!.components;
      const gamesPlayed = componentRows[finalIndex]!.games;
      return createAflTradePlayerPavObservation({
        ...observation,
        featureValues: observation.featureValues.map((value) => ({
          ...value,
          sourceRowIds: Array.from(
            { length: gamesPlayed },
            (_, rowIndex) => `source-row:final:${finalIndex + 1}:${rowIndex + 1}`
          ),
          gamesPlayed,
          offensivePav,
          midfieldPav,
          defensivePav,
          totalPav: offensivePav! + midfieldPav! + defensivePav!,
        })),
      });
    }),
  });
  return { ...base, pavObservationSet };
}

describe('player aggregate-stat residual audit', () => {
  it('relates held-out contribution errors to historical PAV components without reading targets', () => {
    const report = evaluateAflTradePlayerAggregateStatResiduals({ ...fixture(), config });

    expect(report.auditReportId).toMatch(/^player-aggregate-stat-residual-audit:[a-f0-9]{64}$/);
    expect(report.content.coverage).toEqual({
      evaluatedObservationCount: 1,
      comparableObservationCount: 1,
      excludedObservations: [],
    });
    expect(report.content.featureResiduals).toContainEqual({
      feature: 'defensive_pav_per_game',
      count: 1,
      candidate: {
        meanAbsoluteError: 28,
        meanError: -28,
        signedResidualCorrelation: null,
        absoluteResidualCorrelation: null,
      },
      gamesOnly: {
        meanAbsoluteError: 28,
        meanError: -28,
        signedResidualCorrelation: null,
        absoluteResidualCorrelation: null,
      },
      correlationStatus: 'insufficient_support',
    });
    expect(report.content.componentProfiles).toEqual([
      {
        profile: 'defensive',
        count: 1,
        candidate: { meanAbsoluteError: 28, meanError: -28 },
        gamesOnly: { meanAbsoluteError: 28, meanError: -28 },
      },
    ]);
    expect(report.content.leakageFence).toMatchObject({ pavTargetValuesUsed: false });
    expect(report.content.config.governanceEffect).toBe(
      'evidence_only_no_gate_model_selection_promotion_or_publication'
    );
  });

  it('replays deterministically and fails closed below declared support', () => {
    const inputs = fixture();

    expect(evaluateAflTradePlayerAggregateStatResiduals({ ...inputs, config })).toEqual(
      evaluateAflTradePlayerAggregateStatResiduals({ ...inputs, config })
    );
    expect(() =>
      evaluateAflTradePlayerAggregateStatResiduals({
        ...inputs,
        config: { ...config, minimumComparableObservations: 2 },
      })
    ).toThrow('do not meet the declared minimum');
  });

  it('requires the exact acquisition-spell match and point-in-time PAV calculation', () => {
    const inputs = fixture();
    const forgedPredictions = createAflTradePlayerPredictionSet({
      ...inputs.predictionSet.content,
      predictions: inputs.predictionSet.content.predictions.map((prediction) => ({
        ...prediction,
        candidatePredictedContributionAboveReplacement:
          prediction.candidatePredictedContributionAboveReplacement + 1,
      })),
    });
    expect(() =>
      evaluateAflTradePlayerAggregateStatResiduals({
        ...inputs,
        predictionSet: forgedPredictions,
        config,
      })
    ).toThrow('locked candidate-model replay');

    const unretainedRunContent = {
      ...inputs.modelRunManifest.content,
      outcome: {
        ...inputs.modelRunManifest.content.outcome,
        modelArtifact: inputs.modelRunManifest.content.configurationArtifact,
      },
    };
    const unretainedRun = aflTradeModelRunManifestV3Schema.parse({
      runId: createAflTradeContentAddress('model-run', unretainedRunContent),
      content: unretainedRunContent,
    });
    expect(() =>
      evaluateAflTradePlayerAggregateStatResiduals({
        ...inputs,
        modelRunManifest: unretainedRun,
        config,
      })
    ).toThrow('candidate model must bind');

    const changedBaselineContent = {
      ...inputs.baselineFit.content,
      scores: inputs.baselineFit.content.scores.map((score) =>
        score.partition === 'final_test' ? { ...score, playerId: 'afl-player:wrong' } : score
      ),
    };
    const changedBaseline = aflTradePlayerBaselineFitSchema.parse({
      baselineFitId: createAflTradeContentAddress('player-baseline-fit', changedBaselineContent),
      content: changedBaselineContent,
    });
    const changedBaselinePrediction = createAflTradePlayerPredictionSet({
      ...inputs.predictionSet.content,
      baselineFitId: changedBaseline.baselineFitId,
    });
    expect(() =>
      evaluateAflTradePlayerAggregateStatResiduals({
        ...inputs,
        baselineFit: changedBaseline,
        predictionSet: changedBaselinePrediction,
        config,
      })
    ).toThrow('deterministic fit');

    const changedIdentity = rebuildPavSet(inputs.pavObservationSet, {
      observations: inputs.pavObservationSet.content.observations.map((observation) =>
        observation.partition === 'final_test'
          ? createAflTradePlayerPavObservation({
              ...observation,
              acquisitionSpell: {
                ...observation.acquisitionSpell,
                spellVersionId: `acquisition-spell-version:${digest('e')}`,
              },
            })
          : observation
      ),
    });
    expect(() =>
      evaluateAflTradePlayerAggregateStatResiduals({
        ...inputs,
        pavObservationSet: changedIdentity,
        config,
      })
    ).toThrow('do not meet the declared minimum');

    const leakedCalculationAt = '2020-01-09T00:00:00.000Z';
    const changedChronology = rebuildPavSet(inputs.pavObservationSet, {
      observations: inputs.pavObservationSet.content.observations.map((observation) =>
        observation.partition === 'final_test'
          ? createAflTradePlayerPavObservation({
              ...observation,
              featureValues: observation.featureValues.map((value) => ({
                ...value,
                calculatedAt: leakedCalculationAt,
              })),
            })
          : observation
      ),
      calculations: inputs.pavObservationSet.content.calculations.map((member) =>
        member.seasonYear === 2019 ? { ...member, calculatedAt: leakedCalculationAt } : member
      ),
    });
    expect(() =>
      evaluateAflTradePlayerAggregateStatResiduals({
        ...inputs,
        pavObservationSet: changedChronology,
        config,
      })
    ).toThrow('were not known by the admitted prediction cutoff');
  });

  it('does not let future PAV target values affect any residual metric', () => {
    const inputs = fixture();
    const lowTarget = evaluateAflTradePlayerAggregateStatResiduals({
      ...inputs,
      pavObservationSet: withFinalPavTarget(inputs.pavObservationSet, [1, 2, 3]),
      config,
    });
    const highTarget = evaluateAflTradePlayerAggregateStatResiduals({
      ...inputs,
      pavObservationSet: withFinalPavTarget(inputs.pavObservationSet, [10, 20, 30]),
      config,
    });

    expect(highTarget.content.featureResiduals).toEqual(lowTarget.content.featureResiduals);
    expect(highTarget.content.componentProfiles).toEqual(lowTarget.content.componentProfiles);
    expect(highTarget.content.coverage).toEqual(lowTarget.content.coverage);
    expect(highTarget.content.leakageFence.pavTargetValuesUsed).toBe(false);
  });

  it('finds worked component and availability relationships across every profile', () => {
    const report = evaluateAflTradePlayerAggregateStatResiduals({
      ...workedRelationshipFixture(),
      config: { ...config, minimumComparableObservations: 4 },
    });

    expect(report.content.featureResiduals).toHaveLength(5);
    expect(
      report.content.featureResiduals.every(
        ({ correlationStatus }) => correlationStatus === 'available'
      )
    ).toBe(true);
    expect(
      report.content.featureResiduals.find(
        ({ feature }) => feature === 'historical_games_per_feature_season'
      )?.candidate.signedResidualCorrelation
    ).not.toBeNull();
    expect(report.content.componentProfiles.map(({ profile }) => profile)).toEqual([
      'offensive',
      'midfield',
      'defensive',
      'mixed',
    ]);
  });
});
