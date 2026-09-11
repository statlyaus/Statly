import { describe, expect, it } from 'vitest';
import {
  createAflTradeModelRunIntent,
  createAflTradeModelRunContinuationIntent,
} from '@/server/aflTradeIntelligence/artifacts/modelRunManifest';
import { createAflTradeModelRunCheckpoint } from '@/server/aflTradeIntelligence/artifacts/modelRunCheckpoint';
import { admittedRunFixture } from '../testUtils/admittedPlayerModelRunFixture';

const id = (prefix: string, digit: string) => `${prefix}:${digit.repeat(64)}`;

function continuationInput() {
  const base = admittedRunFixture().intent;
  const operationId = id('private-valuation-model-operation', 'b');
  const previousIntent = createAflTradeModelRunIntent({
    ...base.content,
    environment: 'non_production',
    job: {
      jobId: operationId,
      attempt: 1,
      initiatedBy: 'system:weekly-valuation-coordinator',
      workerIdentity: 'system:weekly-valuation-coordinator',
    },
  });
  const checkpoint = createAflTradeModelRunCheckpoint({
    intentId: previousIntent.intentId,
    rootIntentId: previousIntent.intentId,
    authorizationId: id('model-run-authorization', 'a'),
    dispatchRequestId: id('private-valuation-dispatch', 'c'),
    substantiveOperationId: operationId,
    dispatchClaimId: id('private-valuation-dispatch-claim', 'd'),
    dispatchAttemptNumber: 1,
    stage: 'started',
    previousCheckpointId: null,
    recordedAt: previousIntent.content.startedAt,
    candidateArtifact: null,
    evidenceArtifact: null,
  });
  const startedAt = new Date(Date.parse(previousIntent.content.startedAt) + 60_000).toISOString();
  const freshRights = [id('gate0a-evaluation', 'e')];
  return {
    previousIntent,
    checkpoint,
    startedAt,
    dispatchClaimId: id('private-valuation-dispatch-claim', 'f'),
    dispatchLeaseTokenSha256: 'a'.repeat(64),
    dispatchAttemptNumber: 2,
    modelTrainingEvaluationReceiptIds: freshRights,
  };
}

describe('private model-run continuation intent', () => {
  it('preserves fitting ancestry while binding a fresh attempt and rights receipts', () => {
    const input = continuationInput();
    const {
      previousIntent,
      checkpoint,
      startedAt,
      modelTrainingEvaluationReceiptIds: freshRights,
    } = input;
    const operationId = previousIntent.content.job.jobId;
    const continuation = createAflTradeModelRunContinuationIntent(input);
    expect(continuation.intentId).not.toBe(previousIntent.intentId);
    expect(continuation.content).toMatchObject({
      schemaVersion: 'afl-trade-model-run-intent/v2',
      configurationArtifact: previousIntent.content.configurationArtifact,
      sourceCodeArtifact: previousIntent.content.sourceCodeArtifact,
      datasetId: previousIntent.content.datasetId,
      observationSetId: previousIntent.content.observationSetId,
      startedAt,
      modelTrainingEvaluationReceiptIds: freshRights,
      job: { jobId: operationId, attempt: 2 },
      continuation: {
        rootIntentId: previousIntent.intentId,
        previousIntentId: previousIntent.intentId,
        checkpointId: checkpoint.checkpointId,
      },
    });
    expect(previousIntent.content.job.attempt).toBe(1);
    expect(previousIntent.content.modelTrainingEvaluationReceiptIds).not.toEqual(freshRights);
  });
  it('preserves the original root checkpoint when a continuation itself needs recovery', () => {
    const input = continuationInput();
    const second = createAflTradeModelRunContinuationIntent(input);
    const third = createAflTradeModelRunContinuationIntent({
      ...input,
      previousIntent: second,
      startedAt: new Date(Date.parse(input.startedAt) + 60_000).toISOString(),
      dispatchAttemptNumber: 3,
    });
    expect(third.content).toMatchObject({
      continuation: {
        rootIntentId: input.previousIntent.intentId,
        previousIntentId: second.intentId,
        checkpointId: input.checkpoint.checkpointId,
      },
    });
  });
  it('refuses recovery from an ambiguous final-test start', () => {
    const input = continuationInput();
    const checkpoint = createAflTradeModelRunCheckpoint({
      ...input.checkpoint.content,
      stage: 'final_test_started',
      previousCheckpointId: id('model-run-checkpoint', 'a'),
      candidateArtifact: input.previousIntent.content.configurationArtifact,
      evidenceArtifact: input.previousIntent.content.configurationArtifact,
    });
    expect(() => createAflTradeModelRunContinuationIntent({ ...input, checkpoint })).toThrow(
      'unambiguous'
    );
  });
});
