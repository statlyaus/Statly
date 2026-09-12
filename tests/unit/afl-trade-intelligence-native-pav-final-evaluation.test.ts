import { beforeAll, expect, it } from 'vitest';
import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeModelRunCheckpoint } from '@/server/aflTradeIntelligence/artifacts/modelRunCheckpoint';
import {
  createAflTradeModelRunContinuationIntent,
  createAflTradeModelRunIntent,
} from '@/server/aflTradeIntelligence/artifacts/modelRunManifest';
import { nativePavFinalEvidenceFixture } from '../testUtils/nativePavFinalEvidenceFixture';
import { evaluateAflTradeAdmittedPlayerPavFinal } from '@/server/aflTradeIntelligence/modeling/admittedPlayerPavFinalEvaluation';
import { nativePavModelRunSqlFixture } from '../testUtils/nativePavModelRunSqlFixture';
import { preparePlayerPavForecastRows } from '@/server/aflTradeIntelligence/modeling/playerPavForecastDesign';

let fixture: Awaited<ReturnType<typeof nativePavModelRunSqlFixture>>;
beforeAll(async () => {
  fixture = await nativePavModelRunSqlFixture();
}, 120_000);
function input() {
  return nativePavFinalEvidenceFixture(fixture);
}
it('keeps the original numerical fit when a current child starts the final test', () => {
  const parents = input();
  const executionIntent = createAflTradeModelRunContinuationIntent({
    previousIntent: fixture.intent,
    checkpoint: parents.candidateLockedCheckpoint,
    startedAt: new Date(Date.parse(fixture.startedAt) + 40_000).toISOString(),
    dispatchClaimId: createAflTradeContentAddress('private-valuation-dispatch-claim', {
      synthetic: 'numerical child',
    }),
    dispatchLeaseTokenSha256: 'b'.repeat(64),
    dispatchAttemptNumber: 2,
    modelTrainingEvaluationReceiptIds: fixture.intent.content.modelTrainingEvaluationReceiptIds,
  });
  if (executionIntent.content.schemaVersion !== 'afl-trade-model-run-intent/v2')
    throw new Error('Expected child.');
  const finalTestStartedCheckpoint = createAflTradeModelRunCheckpoint({
    ...parents.finalTestStartedCheckpoint.content,
    intentId: executionIntent.intentId,
    authorizationId: createAflTradeContentAddress('model-run-authorization', {
      synthetic: 'child numerical authority',
    }),
    dispatchClaimId: executionIntent.content.continuation.dispatchClaimId,
    dispatchAttemptNumber: 2,
    recordedAt: executionIntent.content.startedAt,
  });
  const child = { ...parents, executionIntent, finalTestStartedCheckpoint };
  const result = evaluateAflTradeAdmittedPlayerPavFinal(child);
  expect(result.content.finalForecasts).toEqual(
    evaluateAflTradeAdmittedPlayerPavFinal(parents).content.finalForecasts
  );
  expect(() =>
    evaluateAflTradeAdmittedPlayerPavFinal({
      ...child,
      finalTestStartedCheckpoint: createAflTradeModelRunCheckpoint({
        ...finalTestStartedCheckpoint.content,
        dispatchClaimId: parents.finalTestStartedCheckpoint.content.dispatchClaimId,
      }),
    })
  ).toThrow('bindings');
  expect(() =>
    evaluateAflTradeAdmittedPlayerPavFinal({
      ...child,
      fitInput: {
        ...parents.fitInput,
        intent: createAflTradeModelRunIntent({
          ...fixture.intent.content,
          seed: fixture.intent.content.seed + 1,
        }),
      },
    })
  ).toThrow('bindings');
});
it('scores only selected final observations with retained numerical candidate and calibration', () => {
  // Checkpoints here are synthetic documents, not genuine committed execution authority.
  const parents = input();
  const result = evaluateAflTradeAdmittedPlayerPavFinal(parents);
  expect(result.content.schemaVersion).toBe('afl-trade-native-pav-final-evaluation/v2');
  expect(
    result.content.baselineComparisons[0]!.pairedScores.map((row) => row.observationId)
  ).toEqual(result.content.baselineComparisons[0]!.pairedObservationIds);
  expect(result.content.authorityBoundary).toBe(
    'numerical_final_evidence_no_execution_completion_or_qualification_authority'
  );
  expect(result.content.finalTestStartedCheckpointId).toBe(
    parents.finalTestStartedCheckpoint.checkpointId
  );
  expect(result.content.finalForecasts).toHaveLength(1);
  expect(result.content.baselineComparisons).toHaveLength(1);
  expect(result.content.baselineComparisons[0]!.pairedObservationIds).toEqual(
    result.content.finalObservationIds
  );
  expect(result.content.baselineComparisons[0]!.baselineMetrics.observationCount).toBe(1);
  expect(result.content.finalObservationIds).toEqual(
    parents.fitInput.observationSet.content.observations
      .filter(({ pavObservation }) => pavObservation.partition === 'final_test')
      .map(({ pavObservation }) => pavObservation.observationId)
  );
  expect(result.content.finalForecasts.every((row) => row.partition === 'final_test')).toBe(true);
  expect(result.content.finalMetrics.observationCount).toBe(1);
  expect(result.content.calibrationId).toBe(
    parents.preFinalEvidence.content.calibrationState.calibrationId
  );
});

it('leaves calibration and validation numerical targets sealed at the final extraction interface', () => {
  const original = fixture.evidence.pavObservationSet;
  const protectedSet = {
    ...original,
    content: {
      ...original.content,
      observations: original.content.observations.map((row) => {
        if (row.partition === 'final_test') return row;
        const protectedRow = { ...row };
        for (const field of ['targetValues', 'outcome', 'outcomeObservedAt'])
          Object.defineProperty(protectedRow, field, {
            get() {
              throw new Error(`Sealed ${row.partition} ${field}`);
            },
          });
        return protectedRow;
      }),
    },
  };
  const rows = preparePlayerPavForecastRows(
    protectedSet,
    { featureHistories: [1], knowledgePolicy: 'retrospective_finalized_measurements' },
    ['final_test']
  );
  expect(
    rows.filter((row) => row.partition !== 'final_test').every((row) => row.target === null)
  ).toBe(true);
  expect(rows.some((row) => row.partition === 'final_test' && row.target !== null)).toBe(true);
});

it('rejects wrong start stages and altered calibration configuration bytes', () => {
  const parents = input();
  expect(() =>
    evaluateAflTradeAdmittedPlayerPavFinal({
      ...parents,
      finalTestStartedCheckpoint: parents.candidateLockedCheckpoint,
    })
  ).toThrow(/start bindings/i);
  expect(() =>
    evaluateAflTradeAdmittedPlayerPavFinal({
      ...parents,
      calibrationConfigurationBytes: new TextEncoder().encode('{}'),
    })
  ).toThrow(/configuration/i);
});

it('rejects a coherently readdressed pre-final parent transplant', () => {
  const parents = input();
  const content = {
    ...parents.preFinalEvidence.content,
    methodId: createAflTradeContentAddress('hpn-pav-method', { wrong: true }),
  };
  const preFinalEvidence = {
    evaluationId: createAflTradeContentAddress('native-pav-pre-final-evaluation', content),
    content,
  };
  const preFinalArtifact = createAflTradeCanonicalJsonArtifactRef(
    preFinalEvidence,
    fixture.startedAt
  );
  const custody = {
    ...JSON.parse(new TextDecoder().decode(parents.candidateCustodyBytes)),
    preFinalArtifact,
  };
  const candidateLockedCheckpoint = createAflTradeModelRunCheckpoint({
    ...parents.candidateLockedCheckpoint.content,
    evidenceArtifact: createAflTradeCanonicalJsonArtifactRef(custody, fixture.startedAt),
  });
  const finalTestStartedCheckpoint = createAflTradeModelRunCheckpoint({
    ...candidateLockedCheckpoint.content,
    stage: 'final_test_started',
    previousCheckpointId: candidateLockedCheckpoint.checkpointId,
  });
  expect(() =>
    evaluateAflTradeAdmittedPlayerPavFinal({
      ...parents,
      preFinalEvidence,
      preFinalArtifact,
      candidateLockedCheckpoint,
      finalTestStartedCheckpoint,
      candidateCustodyBytes: new TextEncoder().encode(canonicalizeAflTradeJson(custody)),
    })
  ).toThrow(/pre-final parents/i);
});
