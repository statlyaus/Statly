import { beforeAll, expect, it } from 'vitest';
import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradePlayerPavModelProtocol } from '@/server/aflTradeIntelligence/artifacts/modelProtocol';
import { interpretAflTradeNativePavValidationDefinitions } from '@/server/aflTradeIntelligence/modeling/admittedPlayerPavValidationPlan';
import { admittedPavModelRunFixture } from '../testUtils/admittedPavModelRunFixture';
import { createAflTradeModelRunIntent } from '@/server/aflTradeIntelligence/artifacts/modelRunManifest';
import { createAflTradePlayerObservationSetV3 } from '@/server/aflTradeIntelligence/modeling/playerContributionContracts';
import { fitAflTradeAdmittedPlayerPavCandidate } from '@/server/aflTradeIntelligence/modeling/admittedPlayerPavCandidate';
import {
  evaluateAflTradeAdmittedPlayerPavPreFinal,
  prepareAflTradeAdmittedPlayerPavValidationPlan,
  authenticateAflTradeAdmittedPlayerPavValidationPlan,
} from '@/server/aflTradeIntelligence/modeling/admittedPlayerPavPreFinalEvaluation';
import { restorePlayerPavForecast } from '@/server/aflTradeIntelligence/modeling/playerPavForecastFit';
import { preparePlayerPavForecastRows } from '@/server/aflTradeIntelligence/modeling/playerPavForecastDesign';
let fixture: Awaited<ReturnType<typeof admittedPavModelRunFixture>>;
beforeAll(async () => {
  fixture = await admittedPavModelRunFixture();
}, 60_000);
const baseline = {
  schemaVersion: 'afl-trade-native-pav-baseline-definition/v1',
  definitionKey: 'synthetic-persistence',
  candidate: { kind: 'persistence', historySeasons: 1 },
  fitPartition: 'train',
  evaluatedPartitions: ['validation', 'final_test'],
};
const sensitivity = {
  schemaVersion: 'afl-trade-native-pav-sensitivity-definition/v1',
  definitionKey: 'synthetic-ridge-alternative',
  candidate: { kind: 'ridge', historySeasons: 1, penalty: 2 },
  fitPartition: 'train',
  evaluatedPartition: 'validation',
  purpose: 'sensitivity_not_candidate_selection',
};
function definitions(base: unknown = baseline, variant: unknown = sensitivity) {
  const artifacts = [base, variant].map((document) => ({
    reference: createAflTradeCanonicalJsonArtifactRef(
      document,
      fixture.protocol.content.preparedAt
    ),
    bytes: new TextEncoder().encode(canonicalizeAflTradeJson(document)),
  }));
  const protocol = createAflTradePlayerPavModelProtocol({
    ...fixture.protocol.content,
    validationPlan: {
      ...fixture.protocol.content.validationPlan,
      baselineDefinitionArtifacts: [artifacts[0]!.reference],
      sensitivityAnalysisArtifacts: [artifacts[1]!.reference],
    },
  });
  return { protocol, artifacts };
}
it('interprets only exact registered explicit native baseline and validation-only sensitivity declarations', () => {
  const input = definitions();
  const result = interpretAflTradeNativePavValidationDefinitions(input.protocol, input.artifacts);
  expect(result.map((item) => item.definition.candidate)).toEqual([
    { kind: 'persistence', historySeasons: 1 },
    { kind: 'ridge', historySeasons: 1, penalty: 2 },
  ]);
  expect(result.map((item) => item.kind)).toEqual(['baseline', 'sensitivity']);
});

it('rejects missing, substituted and undeclared artifact custody', () => {
  const input = definitions();
  expect(() =>
    interpretAflTradeNativePavValidationDefinitions(input.protocol, input.artifacts.slice(1))
  ).toThrow();
  expect(() =>
    interpretAflTradeNativePavValidationDefinitions(input.protocol, [
      input.artifacts[0]!,
      input.artifacts[0]!,
    ])
  ).toThrow();
  expect(() =>
    interpretAflTradeNativePavValidationDefinitions(
      input.protocol,
      input.artifacts.map((item, index) =>
        index ? item : { ...item, bytes: new TextEncoder().encode('{}') }
      )
    )
  ).toThrow(/bytes differ/);
});

it.each([
  { ...sensitivity, evaluatedPartition: 'final_test' },
  { ...sensitivity, purpose: 'candidate_selection' },
  { ...sensitivity, candidate: { kind: 'ridge', historySeasons: 1 } },
  { ...sensitivity, approved: true },
  baseline,
])('rejects unsupported sensitivity semantics instead of supplying defaults', (variant) => {
  const input = definitions(baseline, variant);
  expect(() =>
    interpretAflTradeNativePavValidationDefinitions(input.protocol, input.artifacts)
  ).toThrow();
});

it('retains exact declared training fits and validation-only sensitivity without changing the primary candidate', () => {
  const declared = definitions();
  const configuration = {
    schemaVersion: 'afl-trade-native-pav-pre-final-config/v1',
    method: 'empirical_calibration_residual_paths',
    minimumCalibrationObservations: 2,
    intervalCoverage: 0.8,
  };
  const calibrationConfigurationArtifact = createAflTradeCanonicalJsonArtifactRef(
    configuration,
    fixture.startedAt
  );
  const protocol = createAflTradePlayerPavModelProtocol({
    ...declared.protocol.content,
    validationPlan: {
      ...declared.protocol.content.validationPlan,
      intervalCalibrationArtifact: calibrationConfigurationArtifact,
    },
  });
  const observationSet = createAflTradePlayerObservationSetV3({
    candidate: fixture.base.dataset,
    datasetAdmissionId: fixture.intent.content.datasetAdmissionId,
    modelProtocolId: protocol.protocolId,
    pavObservationSet: fixture.evidence.pavObservationSet,
  });
  const fitConfig = {
    schemaVersion: 'afl-trade-admitted-player-pav-fit-config/v1',
    candidate: { kind: 'ridge', historySeasons: 1, penalty: 1 },
  };
  const intent = createAflTradeModelRunIntent({
    ...fixture.intent.content,
    modelProtocolId: protocol.protocolId,
    observationSetId: observationSet.observationSetId,
    configurationArtifact: createAflTradeCanonicalJsonArtifactRef(fitConfig, fixture.startedAt),
  });
  const fitInput = {
    intent,
    protocol,
    observationSet,
    datasetCandidate: fixture.base.dataset,
    pavObservationSet: fixture.evidence.pavObservationSet,
    hpnMethod: fixture.evidence.hpnMethod,
    configurationBytes: new TextEncoder().encode(canonicalizeAflTradeJson(fitConfig)),
  };
  const candidate = fitAflTradeAdmittedPlayerPavCandidate(fitInput);
  const preFinalInput = {
    fitInput,
    candidate,
    candidateArtifact: createAflTradeCanonicalJsonArtifactRef(candidate, fixture.startedAt),
    calibrationConfigurationArtifact,
    calibrationConfigurationBytes: new TextEncoder().encode(
      canonicalizeAflTradeJson(configuration)
    ),
  };
  const preFinalEvidence = evaluateAflTradeAdmittedPlayerPavPreFinal(preFinalInput);
  const report = prepareAflTradeAdmittedPlayerPavValidationPlan({
    preFinalInput,
    preFinalEvidence,
    definitionArtifacts: declared.artifacts,
  });
  const retained = JSON.parse(JSON.stringify(report));
  expect(
    authenticateAflTradeAdmittedPlayerPavValidationPlan(retained, {
      preFinalInput,
      preFinalEvidence,
      definitionArtifacts: declared.artifacts,
    })
  ).toEqual(report);
  retained.content.evaluations[0].trainingObservationIds = [];
  retained.evaluationId = createAflTradeContentAddress(
    'native-pav-validation-plan-evidence',
    retained.content
  );
  expect(() =>
    authenticateAflTradeAdmittedPlayerPavValidationPlan(retained, {
      preFinalInput,
      preFinalEvidence,
      definitionArtifacts: declared.artifacts,
    })
  ).toThrow(/training membership/);
  const wrongParent = JSON.parse(JSON.stringify(report));
  wrongParent.content.methodId = createAflTradeContentAddress('hpn-pav-method', {
    transplanted: true,
  });
  wrongParent.evaluationId = createAflTradeContentAddress(
    'native-pav-validation-plan-evidence',
    wrongParent.content
  );
  expect(() =>
    authenticateAflTradeAdmittedPlayerPavValidationPlan(wrongParent, {
      preFinalInput,
      preFinalEvidence,
      definitionArtifacts: declared.artifacts,
    })
  ).toThrow(/exact parents/);
  const wrongFit = JSON.parse(JSON.stringify(report));
  wrongFit.content.evaluations[1].fitState.content.penalty = 3;
  wrongFit.content.evaluations[1].fitState.fitId = createAflTradeContentAddress(
    'player-pav-forecast-fit',
    wrongFit.content.evaluations[1].fitState.content
  );
  wrongFit.evaluationId = createAflTradeContentAddress(
    'native-pav-validation-plan-evidence',
    wrongFit.content
  );
  expect(() =>
    authenticateAflTradeAdmittedPlayerPavValidationPlan(wrongFit, {
      preFinalInput,
      preFinalEvidence,
      definitionArtifacts: declared.artifacts,
    })
  ).toThrow(/declared fit/);
  expect(report.content.primaryCandidateId).toBe(candidate.candidateId);
  expect(report.content.evaluations.map((item) => item.kind)).toEqual(['baseline', 'sensitivity']);
  expect(report.content.evaluations.map((item) => item.fitState.content.kind)).toEqual([
    'persistence',
    'ridge',
  ]);
  const rows = preparePlayerPavForecastRows(
    fitInput.pavObservationSet,
    { featureHistories: [1], knowledgePolicy: 'retrospective_finalized_measurements' },
    []
  );
  for (const evaluation of report.content.evaluations) {
    expect(evaluation.trainingObservationIds).toHaveLength(1);
    expect(evaluation.validationForecasts.every((row) => row.partition === 'validation')).toBe(
      true
    );
    const restored = restorePlayerPavForecast(JSON.parse(JSON.stringify(evaluation.fitState)));
    const forecast = evaluation.validationForecasts[0]!;
    expect(
      restored.predict(rows.find((row) => row.observationId === forecast.observationId)!)
    ).toEqual(forecast.annualPointPav);
  }
});
