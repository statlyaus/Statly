import { describe, expect, it } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  AFL_TRADE_PLAYER_MODEL_SUBGROUPS,
  aflTradePlayerContributionModelProtocolSchema,
} from '@/server/aflTradeIntelligence/artifacts/modelProtocol';

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

function protocolContent() {
  return {
    schemaVersion: 'afl-trade-model-protocol/v1' as const,
    environment: 'test_fixture' as const,
    protocolKey: 'fixture-player-contribution',
    version: 1,
    modelKind: 'player_contribution_and_availability' as const,
    datasetId: `dataset:${digest('1')}`,
    preparedAt: '2026-08-04T00:00:00.000Z',
    preparedBy: 'fixture-model-owner',
    proposalOrigin: 'agent_assisted' as const,
    publicIdentityBoundary: 'source_native_no_fantasy_ownership' as const,
    estimands: [
      'at_trade_future_contribution' as const,
      'realized_club_contribution' as const,
      'remaining_contribution' as const,
    ],
    valueUnit: {
      valueUnitId: 'fixture-contribution-above-replacement',
      label: 'Fixture contribution above replacement',
      definitionArtifact: artifact('2'),
      aggregation: 'additive_contribution' as const,
    },
    footballContext: {
      roleTaxonomyArtifact: artifact('3'),
      eraDefinitionArtifact: artifact('4'),
      roleAssignmentTiming: 'as_known_at_prediction_cutoff' as const,
      unknownRoleTreatment: 'explicit_unknown_role' as const,
    },
    replacementBaseline: {
      definitionArtifact: artifact('5'),
      stratification: 'role_and_era' as const,
      estimationData: 'training_partition_only' as const,
      validationAndTestRefit: 'prohibited' as const,
    },
    featurePolicy: {
      knowledgeJoin: 'point_in_time_as_known_at_prediction_cutoff' as const,
      correctionAvailability: 'only_after_known_from' as const,
      unknownAndZero: 'distinct' as const,
      targetDerivedFeatures: 'prohibited' as const,
      postOutcomeFeatures: 'prohibited' as const,
      featureAvailabilityArtifact: artifact('6'),
    },
    contributionAndCensoringPolicy: {
      clubContributionEnd: 'real_club_departure_or_observation_end' as const,
      activeCareerTreatment: 'right_censored' as const,
      unavailableObservationTreatmentArtifact: artifact('7'),
      censoringDefinitionArtifact: artifact('8'),
    },
    windows: {
      train: { from: '2020-01-01T00:00:00.000Z', to: '2021-01-01T00:00:00.000Z' },
      calibration: { from: '2021-01-08T00:00:00.000Z', to: '2022-01-01T00:00:00.000Z' },
      validation: { from: '2022-01-08T00:00:00.000Z', to: '2023-01-01T00:00:00.000Z' },
      finalTest: { from: '2023-01-08T00:00:00.000Z', to: '2024-01-01T00:00:00.000Z' },
      embargoDays: 7,
    },
    modelSelectionPolicy: {
      candidateSelectionData: 'train_calibration_validation_only' as const,
      finalTestUse: 'single_evaluation_after_candidate_lock' as const,
      finalTestRetuning: 'prohibited' as const,
    },
    validationPlan: {
      baselineDefinitionArtifacts: [artifact('9')],
      metricDefinitionArtifacts: [artifact('a')],
      intervalCalibrationArtifact: artifact('b'),
      subgroupDimensions: [...AFL_TRADE_PLAYER_MODEL_SUBGROUPS],
      sensitivityAnalysisArtifacts: [artifact('c')],
      acceptanceCriteriaArtifact: artifact('d'),
    },
    limitations: ['Fabricated protocol with no production authority.'],
  };
}

function protocol(content = protocolContent()) {
  return aflTradePlayerContributionModelProtocolSchema.parse({
    protocolId: createAflTradeContentAddress('model-protocol', content),
    content,
  });
}

describe('AFL trade-intelligence player contribution model protocol', () => {
  it('accepts a source-native, leakage-controlled, chronologically sealed protocol', () => {
    const candidate = protocol();

    expect(candidate.content.publicIdentityBoundary).toBe(
      'source_native_no_fantasy_ownership'
    );
    expect(candidate.content.modelSelectionPolicy.finalTestRetuning).toBe('prohibited');
  });

  it.each([
    ['publicIdentityBoundary', { publicIdentityBoundary: 'fantasy_player_identity' }],
    [
      'replacementBaseline',
      {
        replacementBaseline: {
          ...protocolContent().replacementBaseline,
          estimationData: 'all_partitions',
        },
      },
    ],
    [
      'featurePolicy',
      {
        featurePolicy: {
          ...protocolContent().featurePolicy,
          targetDerivedFeatures: 'allowed',
        },
      },
    ],
    [
      'modelSelectionPolicy',
      {
        modelSelectionPolicy: {
          ...protocolContent().modelSelectionPolicy,
          finalTestUse: 'iterative_model_selection',
        },
      },
    ],
  ])('rejects an unsafe %s policy', (_field, replacement) => {
    const content = { ...protocolContent(), ...replacement };

    expect(
      aflTradePlayerContributionModelProtocolSchema.safeParse({
        protocolId: createAflTradeContentAddress('model-protocol', content),
        content,
      }).success
    ).toBe(false);
  });

  it('requires every prespecified player subgroup exactly once', () => {
    const valid = protocolContent();
    const content = {
      ...valid,
      validationPlan: {
        ...valid.validationPlan,
        subgroupDimensions: valid.validationPlan.subgroupDimensions.slice(0, -1),
      },
    };

    expect(
      aflTradePlayerContributionModelProtocolSchema.safeParse({
        protocolId: createAflTradeContentAddress('model-protocol', content),
        content,
      }).success
    ).toBe(false);
  });

  it('rejects protocol windows that violate their embargo', () => {
    const valid = protocolContent();
    const content = {
      ...valid,
      windows: {
        ...valid.windows,
        calibration: { ...valid.windows.calibration, from: valid.windows.train.to },
      },
    };

    expect(
      aflTradePlayerContributionModelProtocolSchema.safeParse({
        protocolId: createAflTradeContentAddress('model-protocol', content),
        content,
      }).success
    ).toBe(false);
  });

  it('rejects protocol content altered after hashing', () => {
    const candidate = protocol();

    expect(
      aflTradePlayerContributionModelProtocolSchema.safeParse({
        ...candidate,
        content: { ...candidate.content, version: 2 },
      }).success
    ).toBe(false);
  });
});
