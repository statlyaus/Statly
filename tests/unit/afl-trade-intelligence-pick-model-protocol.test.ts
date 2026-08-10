import { describe, expect, it } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  AFL_TRADE_PICK_MODEL_SUBGROUPS,
  aflTradeModelProtocolSchema,
  aflTradePickDistributionModelProtocolSchema,
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
    protocolKey: 'fixture-pick-distribution',
    version: 1,
    modelKind: 'draft_pick_and_future_pick_distribution' as const,
    datasetId: `dataset:${digest('1')}`,
    preparedAt: '2026-08-04T00:00:00.000Z',
    preparedBy: 'fixture-model-owner',
    proposalOrigin: 'agent_assisted' as const,
    publicAssetBoundary: 'source_native_afl_draft_entitlement_no_fantasy_ownership' as const,
    estimands: [
      'draft_pick_outcome_distribution' as const,
      'future_pick_landing_distribution' as const,
    ],
    valueAlignment: {
      valueUnitId: 'fixture-contribution',
      playerContributionAlignmentArtifact: artifact('2'),
      aggregation: 'expected_additive_contribution' as const,
    },
    outcomeMixture: {
      hurdleOutcomeDefinitionArtifact: artifact('3'),
      regularOutcomeDefinitionArtifact: artifact('4'),
      eliteOutcomeDefinitionArtifact: artifact('5'),
      probabilityMass: 'mutually_exclusive_and_exhaustive' as const,
      activeCareerTreatment: 'right_censored' as const,
    },
    pickCurve: {
      domain: 'national_draft_selection_number' as const,
      smoother: 'constrained_monotonic' as const,
      expectedContributionDirection: 'non_increasing_with_pick_number' as const,
      monotonicViolations: 'prohibited' as const,
      uncertaintyTreatment: 'preserved_not_point_estimate_only' as const,
      extrapolationDefinitionArtifact: artifact('6'),
    },
    cohortPolicy: {
      eraDefinitionArtifact: artifact('7'),
      draftPathwayDefinitionArtifact: artifact('8'),
      incompleteCareerTreatmentArtifact: artifact('9'),
      delistedAndInactiveDefinitionArtifact: artifact('a'),
    },
    futurePickSimulation: {
      landingPositionModelArtifact: artifact('b'),
      selectionOrderRulesArtifact: artifact('c'),
      ruleVintage: 'as_known_at_valuation_cutoff' as const,
      timeDelayDefinitionArtifact: artifact('d'),
      correlatedLadderOutcomeArtifact: artifact('e'),
      simulationDraws: 10_000,
      randomSeedPolicy: 'model_run_manifest_seed' as const,
      landingCalibration: 'held_out_temporal_seasons' as const,
      scenarioSensitivityArtifacts: [artifact('f')],
    },
    featurePolicy: {
      knowledgeJoin: 'point_in_time_as_known_at_valuation_cutoff' as const,
      correctionAvailability: 'only_after_known_from' as const,
      unknownAndZero: 'distinct' as const,
      postOutcomeFeatures: 'prohibited' as const,
      featureAvailabilityArtifact: artifact('1'),
    },
    windows: {
      train: { from: '2000-01-01T00:00:00.000Z', to: '2015-01-01T00:00:00.000Z' },
      calibration: { from: '2015-01-08T00:00:00.000Z', to: '2018-01-01T00:00:00.000Z' },
      validation: { from: '2018-01-08T00:00:00.000Z', to: '2021-01-01T00:00:00.000Z' },
      finalTest: { from: '2021-01-08T00:00:00.000Z', to: '2024-01-01T00:00:00.000Z' },
      embargoDays: 7,
    },
    modelSelectionPolicy: {
      candidateSelectionData: 'train_calibration_validation_only' as const,
      finalTestUse: 'single_evaluation_after_candidate_lock' as const,
      finalTestRetuning: 'prohibited' as const,
    },
    validationPlan: {
      baselineDefinitionArtifacts: [artifact('2')],
      metricDefinitionArtifacts: [artifact('3')],
      probabilityCalibrationArtifact: artifact('4'),
      intervalCoverageArtifact: artifact('5'),
      monotonicityAuditArtifact: artifact('6'),
      subgroupDimensions: [...AFL_TRADE_PICK_MODEL_SUBGROUPS],
      sensitivityAnalysisArtifacts: [artifact('7')],
      acceptanceCriteriaArtifact: artifact('8'),
    },
    limitations: ['Fabricated protocol with no production authority.'],
  };
}

function parseCandidate(content: unknown) {
  return aflTradePickDistributionModelProtocolSchema.safeParse({
    protocolId: createAflTradeContentAddress('model-protocol', content),
    content,
  });
}

describe('AFL trade-intelligence draft and future-pick model protocol', () => {
  it('accepts a monotonic, censored, temporally calibrated pick protocol', () => {
    const content = protocolContent();
    const candidate = aflTradePickDistributionModelProtocolSchema.parse({
      protocolId: createAflTradeContentAddress('model-protocol', content),
      content,
    });

    expect(candidate.content.pickCurve.monotonicViolations).toBe('prohibited');
    expect(aflTradeModelProtocolSchema.parse(candidate)).toEqual(candidate);
  });

  it.each([
    ['publicAssetBoundary', { publicAssetBoundary: 'fantasy_owned_draft_pick' }],
    [
      'outcomeMixture',
      {
        outcomeMixture: {
          ...protocolContent().outcomeMixture,
          activeCareerTreatment: 'completed_as_zero',
        },
      },
    ],
    [
      'pickCurve',
      {
        pickCurve: {
          ...protocolContent().pickCurve,
          smoother: 'unconstrained',
        },
      },
    ],
    [
      'futurePickSimulation',
      {
        futurePickSimulation: {
          ...protocolContent().futurePickSimulation,
          ruleVintage: 'latest_rules',
        },
      },
    ],
    [
      'landingCalibration',
      {
        futurePickSimulation: {
          ...protocolContent().futurePickSimulation,
          landingCalibration: 'training_seasons',
        },
      },
    ],
    [
      'featurePolicy',
      {
        featurePolicy: {
          ...protocolContent().featurePolicy,
          postOutcomeFeatures: 'allowed',
        },
      },
    ],
  ])('rejects an unsafe %s policy', (_field, replacement) => {
    expect(parseCandidate({ ...protocolContent(), ...replacement }).success).toBe(false);
  });

  it('requires both pick estimands and every prespecified subgroup exactly once', () => {
    const valid = protocolContent();
    const missingEstimand = {
      ...valid,
      estimands: ['draft_pick_outcome_distribution'],
    };
    const missingSubgroup = {
      ...valid,
      validationPlan: {
        ...valid.validationPlan,
        subgroupDimensions: valid.validationPlan.subgroupDimensions.slice(0, -1),
      },
    };

    expect(parseCandidate(missingEstimand).success).toBe(false);
    expect(parseCandidate(missingSubgroup).success).toBe(false);
  });

  it('rejects overlapping windows and content altered after hashing', () => {
    const valid = protocolContent();
    const overlapping = {
      ...valid,
      windows: {
        ...valid.windows,
        calibration: { ...valid.windows.calibration, from: valid.windows.train.to },
      },
    };
    expect(parseCandidate(overlapping).success).toBe(false);

    const candidate = aflTradePickDistributionModelProtocolSchema.parse({
      protocolId: createAflTradeContentAddress('model-protocol', valid),
      content: valid,
    });
    expect(
      aflTradePickDistributionModelProtocolSchema.safeParse({
        ...candidate,
        content: { ...candidate.content, version: 2 },
      }).success
    ).toBe(false);
  });
});
