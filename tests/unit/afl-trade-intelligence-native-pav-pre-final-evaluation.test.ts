import { beforeAll, expect, it } from 'vitest';
import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradePlayerPavModelProtocol } from '@/server/aflTradeIntelligence/artifacts/modelProtocol';
import { createAflTradeModelRunIntent } from '@/server/aflTradeIntelligence/artifacts/modelRunManifest';
import { createAflTradePlayerObservationSetV3 } from '@/server/aflTradeIntelligence/modeling/playerContributionContracts';
import { fitAflTradeAdmittedPlayerPavCandidate } from '@/server/aflTradeIntelligence/modeling/admittedPlayerPavCandidate';
import {
  evaluateAflTradeAdmittedPlayerPavPreFinal,
  authenticateAflTradeAdmittedPlayerPavPreFinalEvidence,
} from '@/server/aflTradeIntelligence/modeling/admittedPlayerPavPreFinalEvaluation';
import { admittedPavModelRunFixture } from '../testUtils/admittedPavModelRunFixture';

let fixture: Awaited<ReturnType<typeof admittedPavModelRunFixture>>;
beforeAll(async () => {
  fixture = await admittedPavModelRunFixture();
}, 120_000);
function input(overrides: Record<string, unknown> = {}) {
  const calibrationConfiguration = {
    schemaVersion: 'afl-trade-native-pav-pre-final-config/v1',
    method: 'empirical_calibration_residual_paths',
    minimumCalibrationObservations: 2,
    intervalCoverage: 0.8,
    ...overrides,
  };
  const calibrationArtifact = createAflTradeCanonicalJsonArtifactRef(
    calibrationConfiguration,
    fixture.startedAt
  );
  const protocol = createAflTradePlayerPavModelProtocol({
    ...fixture.protocol.content,
    validationPlan: {
      ...fixture.protocol.content.validationPlan,
      intervalCalibrationArtifact: calibrationArtifact,
    },
  });
  const observationSet = createAflTradePlayerObservationSetV3({
    candidate: fixture.base.dataset,
    datasetAdmissionId: fixture.intent.content.datasetAdmissionId,
    modelProtocolId: protocol.protocolId,
    pavObservationSet: fixture.evidence.pavObservationSet,
  });
  const fitConfiguration = {
    schemaVersion: 'afl-trade-admitted-player-pav-fit-config/v1',
    candidate: { kind: 'ridge', historySeasons: 1, penalty: 1 },
  };
  const intent = createAflTradeModelRunIntent({
    ...fixture.intent.content,
    modelProtocolId: protocol.protocolId,
    observationSetId: observationSet.observationSetId,
    configurationArtifact: createAflTradeCanonicalJsonArtifactRef(
      fitConfiguration,
      fixture.startedAt
    ),
  });
  const fitInput = {
    intent,
    protocol,
    observationSet,
    datasetCandidate: fixture.base.dataset,
    pavObservationSet: fixture.evidence.pavObservationSet,
    hpnMethod: fixture.evidence.hpnMethod,
    configurationBytes: new TextEncoder().encode(canonicalizeAflTradeJson(fitConfiguration)),
  };
  const candidate = fitAflTradeAdmittedPlayerPavCandidate(fitInput);
  return {
    fitInput,
    candidate,
    candidateArtifact: createAflTradeCanonicalJsonArtifactRef(candidate, fixture.startedAt),
    calibrationConfigurationArtifact: calibrationArtifact,
    calibrationConfigurationBytes: new TextEncoder().encode(
      canonicalizeAflTradeJson(calibrationConfiguration)
    ),
  };
}
it('evaluates only selected validation rows and retains numerical-only exact-parent calibration evidence', () => {
  // Synthetic admitted graph exercises numerical composition, not a genuine execution grant.
  const parents = input();
  const report = evaluateAflTradeAdmittedPlayerPavPreFinal(parents);
  expect(report.content.authorityBoundary).toBe(
    'numerical_pre_final_evidence_no_execution_or_qualification_authority'
  );
  expect(report.content.candidateArtifact).toEqual(parents.candidateArtifact);
  expect(report.content.validationForecasts).toHaveLength(1);
  expect(report.content.validationForecasts.every((row) => row.partition === 'validation')).toBe(
    true
  );
  expect(report.content.calibrationState.content.residuals).toHaveLength(1);
  expect(report.content.validationForecasts[0]!.distribution).toMatchObject({
    state: 'unavailable',
    reason: 'insufficient_calibration_support',
  });
});

it.each([{ method: 'invented_method' }, { approved: true }, { intervalCoverage: 1 }])(
  'rejects unsupported exact-bound calibration semantics %j',
  (override) => {
    expect(() => evaluateAflTradeAdmittedPlayerPavPreFinal(input(override))).toThrow();
  }
);

it('rejects substituted candidate or calibration bytes before producing evidence', () => {
  const parents = input();
  expect(() =>
    evaluateAflTradeAdmittedPlayerPavPreFinal({
      ...parents,
      candidate: { ...parents.candidate, approved: true },
    })
  ).toThrow(/exact retained/);
  expect(() =>
    evaluateAflTradeAdmittedPlayerPavPreFinal({
      ...parents,
      calibrationConfigurationBytes: new TextEncoder().encode('{}'),
    })
  ).toThrow(/exact retained/);
});

it('authenticates exact retained report membership and rejects coherently readdressed transplants', () => {
  const parents = input();
  const report = evaluateAflTradeAdmittedPlayerPavPreFinal(parents);
  expect(
    authenticateAflTradeAdmittedPlayerPavPreFinalEvidence(
      JSON.parse(JSON.stringify(report)),
      parents
    )
  ).toEqual(report);
  const state = report.content.calibrationState;
  for (const stateContent of [
    { ...state.content, residuals: [] },
    { ...state.content, evaluationCutoff: 0 },
  ]) {
    const content = {
      ...report.content,
      calibrationState: {
        calibrationId: createAflTradeContentAddress(
          'player-pav-empirical-calibration',
          stateContent
        ),
        content: stateContent,
      },
    };
    const changed = {
      evaluationId: createAflTradeContentAddress('native-pav-pre-final-evaluation', content),
      content,
    };
    expect(() => authenticateAflTradeAdmittedPlayerPavPreFinalEvidence(changed, parents)).toThrow(
      /membership/i
    );
  }
  const content = { ...report.content, validationObservationIds: [] };
  expect(() =>
    authenticateAflTradeAdmittedPlayerPavPreFinalEvidence(
      {
        evaluationId: createAflTradeContentAddress('native-pav-pre-final-evaluation', content),
        content,
      },
      parents
    )
  ).toThrow(/membership/i);
});
