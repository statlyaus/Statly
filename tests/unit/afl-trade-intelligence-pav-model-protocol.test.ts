import { describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  AFL_TRADE_PLAYER_MODEL_SUBGROUPS,
  aflTradePlayerPavModelProtocolSchema,
  createAflTradePlayerPavModelProtocol,
} from '@/server/aflTradeIntelligence/artifacts/modelProtocol';

function protocolContent() {
  const preparedAt = '2026-10-01T00:30:00.000Z';
  const artifact = createAflTradeCanonicalJsonArtifactRef(
    { fixture: 'protocol shape only, no model approval' },
    preparedAt
  );
  return {
    schemaVersion: 'afl-trade-model-protocol/v3' as const,
    environment: 'test_fixture' as const,
    protocolKey: 'fixture-native-pav',
    version: 1,
    modelKind: 'player_contribution_and_availability' as const,
    datasetId: `dataset:${'1'.repeat(64)}`,
    datasetAdmission: {
      schemaVersion: 'afl-trade-dataset-admission/v3' as const,
      admissionId: `dataset-admission:${'2'.repeat(64)}`,
      admittedAt: '2026-10-01T00:20:00.000Z',
    },
    preparedAt,
    preparedBy: 'fixture-model-owner',
    proposalOrigin: 'agent_assisted' as const,
    publicIdentityBoundary: 'source_native_no_fantasy_ownership' as const,
    observationGrain: 'player_acquisition_spell_prediction' as const,
    sourceObservationSet: {
      observationSetId: `player-pav-observation-set:${'3'.repeat(64)}`,
      artifact,
    },
    pavPolicy: { policyId: `player-pav-policy:${'4'.repeat(64)}`, artifact },
    hpnMethod: { methodId: `hpn-pav-method:${'5'.repeat(64)}`, artifact },
    target: {
      fixedHorizonSeasons: 3 as const,
      annualValueUnit: 'season_pav' as const,
      aggregation: 'sum' as const,
      valueUnit: 'fixed_horizon_pav' as const,
    },
    featureDefinitionArtifact: artifact,
    featurePolicy: {
      knowledgeJoin: 'retrospective_as_captured_at_dataset_creation' as const,
      correctionAvailability: 'only_after_known_from' as const,
      unknownAndZero: 'distinct' as const,
      targetDerivedFeatures: 'prohibited' as const,
      postOutcomeFeatures: 'prohibited' as const,
      featureAvailabilityArtifact: artifact,
    },
    windows: {
      train: { from: '2003-01-01T00:00:00.000Z', to: '2008-12-31T00:00:00.000Z' },
      calibration: { from: '2009-01-01T00:00:00.000Z', to: '2012-12-31T00:00:00.000Z' },
      validation: { from: '2013-01-01T00:00:00.000Z', to: '2016-12-31T00:00:00.000Z' },
      finalTest: { from: '2017-01-01T00:00:00.000Z', to: '2020-12-31T00:00:00.000Z' },
      embargoDays: 1,
    },
    modelSelectionPolicy: {
      candidateSelectionData: 'train_calibration_validation_only' as const,
      finalTestUse: 'single_evaluation_after_candidate_lock' as const,
      finalTestRetuning: 'prohibited' as const,
    },
    validationPlan: {
      baselineDefinitionArtifacts: [artifact],
      metricDefinitionArtifacts: [artifact],
      intervalCalibrationArtifact: artifact,
      subgroupDimensions: [...AFL_TRADE_PLAYER_MODEL_SUBGROUPS],
      sensitivityAnalysisArtifacts: [artifact],
      acceptanceCriteriaArtifact: artifact,
    },
    limitations: ['Synthetic contract test; no genuine dataset or model authority.'],
  };
}

describe('native PAV model protocol', () => {
  it.each([
    { scalarValueTransformArtifact: protocolContent().featureDefinitionArtifact },
    { sourceOutcomeVector: ['brownlow_votes', 'coaches_votes', 'games', 'goals'] },
    { environment: 'production' },
    { target: { ...protocolContent().target, fixedHorizonSeasons: 5 } },
    { target: { ...protocolContent().target, aggregation: 'mean' } },
    { featurePolicy: { ...protocolContent().featurePolicy, targetDerivedFeatures: 'allowed' } },
    {
      modelSelectionPolicy: {
        ...protocolContent().modelSelectionPolicy,
        finalTestRetuning: 'allowed',
      },
    },
  ])('rejects unsafe or scalar contract substitutions: %j', (replacement) => {
    const content = { ...protocolContent(), ...replacement };
    expect(
      aflTradePlayerPavModelProtocolSchema.safeParse({
        protocolId: createAflTradeContentAddress('model-protocol', content),
        content,
      }).success
    ).toBe(false);
  });

  it('rejects a retained protocol whose content no longer matches its identity', () => {
    const protocol = createAflTradePlayerPavModelProtocol(protocolContent());
    expect(
      aflTradePlayerPavModelProtocolSchema.safeParse({
        ...protocol,
        content: { ...protocol.content, protocolKey: 'substituted-protocol' },
      }).success
    ).toBe(false);
  });

  it('rejects duplicated subgroups that omit a required assessment', () => {
    const content = protocolContent();
    content.validationPlan.subgroupDimensions[0] = 'role';
    expect(() => createAflTradePlayerPavModelProtocol(content)).toThrow(/subgroup/);
  });

  it('rejects partitions that violate the declared embargo', () => {
    const content = protocolContent();
    content.windows.calibration.from = content.windows.train.to;
    expect(() => createAflTradePlayerPavModelProtocol(content)).toThrow(/embargo/);
  });

  it('rejects a protocol prepared before its dataset admission', () => {
    expect(() =>
      createAflTradePlayerPavModelProtocol({
        ...protocolContent(),
        preparedAt: '2026-10-01T00:19:59.000Z',
      })
    ).toThrow(/predate its dataset admission/);
  });

  it('retains native observations, policy and method without a scalar transformation', () => {
    const input = protocolContent();
    const protocol = createAflTradePlayerPavModelProtocol(input);
    expect(protocol.content.target).toEqual({
      fixedHorizonSeasons: 3,
      annualValueUnit: 'season_pav',
      aggregation: 'sum',
      valueUnit: 'fixed_horizon_pav',
    });
    expect(protocol.content.sourceObservationSet).toEqual(input.sourceObservationSet);
    expect(protocol.content.pavPolicy).toEqual(input.pavPolicy);
    expect(protocol.content.hpnMethod).toEqual(input.hpnMethod);
    expect(protocol.content).not.toHaveProperty('scalarValueTransformArtifact');
    expect(aflTradePlayerPavModelProtocolSchema.parse(protocol)).toEqual(protocol);
    expect(createAflTradePlayerPavModelProtocol(input)).toEqual(protocol);
  });
});
