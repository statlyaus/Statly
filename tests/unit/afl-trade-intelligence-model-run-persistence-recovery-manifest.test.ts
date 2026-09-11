import { describe, expect, it } from 'vitest';
import {
  createAflTradeModelRunIntent,
  createAflTradeModelRunContinuationIntent,
  createAflTradeNativeFinalTestCompletionEvidence,
  createAflTradeModelRunPersistenceRecoveryManifest,
  aflTradeModelRunManifestV4Schema,
  aflTradeModelRunManifestV3Schema,
  aflTradeAnyModelRunManifestSchema,
  aflTradeModelRunIntentSchema,
} from '@/server/aflTradeIntelligence/artifacts/modelRunManifest';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeModelRunCheckpoint } from '@/server/aflTradeIntelligence/artifacts/modelRunCheckpoint';
import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { admittedRunFixture, runContent } from '../testUtils/admittedPlayerModelRunFixture';

const id = (prefix: string, value = 'a') => `${prefix}:${value.repeat(64)}`;
const time = (minute: number) => `2026-08-10T00:${String(minute).padStart(2, '0')}:00.000Z`;
function fixture() {
  const root = createAflTradeModelRunIntent({
    ...admittedRunFixture().intent.content,
    environment: 'non_production',
    startedAt: time(3),
    job: {
      jobId: id('private-valuation-model-operation'),
      attempt: 1,
      initiatedBy: 'system:weekly-valuation-coordinator',
      workerIdentity: 'system:weekly-valuation-coordinator',
    },
  });
  const started = createAflTradeModelRunCheckpoint({
    intentId: root.intentId,
    rootIntentId: root.intentId,
    authorizationId: id('model-run-authorization'),
    dispatchRequestId: id('private-valuation-dispatch'),
    substantiveOperationId: root.content.job.jobId,
    dispatchClaimId: id('private-valuation-dispatch-claim'),
    dispatchAttemptNumber: 1,
    stage: 'started',
    previousCheckpointId: null,
    recordedAt: time(3),
    candidateArtifact: null,
    evidenceArtifact: null,
  });
  const outcome = runContent().outcome;
  if (outcome.status !== 'succeeded') throw new Error('Expected successful structural fixture.');
  const locked = createAflTradeModelRunCheckpoint({
    ...started.content,
    stage: 'candidate_locked',
    previousCheckpointId: started.checkpointId,
    recordedAt: time(4),
    candidateArtifact: outcome.modelArtifact,
    evidenceArtifact: createAflTradeCanonicalJsonArtifactRef({ fixture: 'lock' }, time(4)),
  });
  const testStarted = createAflTradeModelRunCheckpoint({
    ...locked.content,
    stage: 'final_test_started',
    previousCheckpointId: locked.checkpointId,
    recordedAt: time(5),
  });
  const completionEvidence = createAflTradeNativeFinalTestCompletionEvidence({
    finalTestStartedCheckpoint: testStarted,
    evaluatedAt: time(6),
    recordedAt: time(7),
    outcome,
  });
  const completed = createAflTradeModelRunCheckpoint({
    ...testStarted.content,
    stage: 'final_test_completed',
    previousCheckpointId: testStarted.checkpointId,
    recordedAt: time(8),
    evidenceArtifact: createAflTradeCanonicalJsonArtifactRef(
      completionEvidence,
      completionEvidence.recordedAt
    ),
  });
  const child = createAflTradeModelRunContinuationIntent({
    previousIntent: root,
    checkpoint: completed,
    startedAt: time(9),
    dispatchClaimId: id('private-valuation-dispatch-claim', 'b'),
    dispatchAttemptNumber: 2,
    dispatchLeaseTokenSha256: 'b'.repeat(64),
    modelTrainingEvaluationReceiptIds: [id('gate0a-evaluation', 'b')],
  });
  return {
    intentChain: [root, child],
    checkpoints: [started, locked, testStarted, completed],
    completionEvidence,
    runAuthorizationId: id('model-run-authorization', 'b'),
    finishedAt: time(10),
  };
}

describe('persistence-only continuation terminal manifest', () => {
  it('preserves child execution identity and original scientific timestamps', () => {
    const input = fixture();
    const result = createAflTradeModelRunPersistenceRecoveryManifest(input);
    expect(result.content).toMatchObject({
      schemaVersion: 'afl-trade-model-run/v4',
      startedAt: time(9),
      candidateLockedAt: time(4),
      finalTestEvaluatedAt: time(6),
      finishedAt: time(10),
      runIntentId: input.intentChain[1]!.intentId,
      runAuthorizationId: input.runAuthorizationId,
      job: { attempt: 2 },
      publicationEligible: false,
    });
    expect(result.content.recovery.completionEvidence).toEqual(input.completionEvidence);
  });
  it('replays its exact identity while existing terminal readers remain closed', () => {
    const input = fixture();
    const result = createAflTradeModelRunPersistenceRecoveryManifest(input);
    expect(createAflTradeModelRunPersistenceRecoveryManifest(input)).toEqual(result);
    expect(aflTradeModelRunManifestV4Schema.parse(JSON.parse(JSON.stringify(result)))).toEqual(
      result
    );
    expect(aflTradeModelRunManifestV3Schema.safeParse(result).success).toBe(false);
    expect(aflTradeAnyModelRunManifestSchema.safeParse(result).success).toBe(false);
  });
  it.each([
    { startedAt: time(3) },
    { candidateLockedAt: time(9) },
    { finalTestEvaluatedAt: time(8) },
    { runIntentId: id('model-run-intent', 'f') },
    { datasetId: id('dataset', 'f') },
    { codeCommitSha: 'f'.repeat(64) },
    { modelTrainingEvaluationReceiptIds: [id('gate0a-evaluation', 'f')] },
  ])('rejects re-addressed child/scientific substitutions %j', (change) => {
    const result = createAflTradeModelRunPersistenceRecoveryManifest(fixture());
    const content = { ...result.content, ...change };
    expect(
      aflTradeModelRunManifestV4Schema.safeParse({
        runId: createAflTradeContentAddress('model-run', content),
        content,
      }).success
    ).toBe(false);
  });
  it('rejects unknown envelope and recovery fields and unbound content identities', () => {
    const result = createAflTradeModelRunPersistenceRecoveryManifest(fixture());
    expect(aflTradeModelRunManifestV4Schema.safeParse({ ...result, approved: true }).success).toBe(
      false
    );
    expect(
      aflTradeModelRunManifestV4Schema.safeParse({ ...result, runId: id('model-run', 'f') }).success
    ).toBe(false);
    const content = {
      ...result.content,
      recovery: { ...result.content.recovery, executionGranted: true },
    };
    expect(
      aflTradeModelRunManifestV4Schema.safeParse({
        runId: createAflTradeContentAddress('model-run', content),
        content,
      }).success
    ).toBe(false);
  });
  it('rejects incomplete, reordered or duplicated intent/checkpoint ancestry', () => {
    const input = fixture();
    for (const intentChain of [
      [input.intentChain[1]!],
      [...input.intentChain].reverse(),
      [...input.intentChain, input.intentChain[1]!],
    ]) {
      expect(() =>
        createAflTradeModelRunPersistenceRecoveryManifest({ ...input, intentChain })
      ).toThrow();
    }
    for (const checkpoints of [input.checkpoints.slice(0, 3), [...input.checkpoints].reverse()]) {
      expect(() =>
        createAflTradeModelRunPersistenceRecoveryManifest({ ...input, checkpoints })
      ).toThrow();
    }
  });
  it('rejects a re-addressed continuation with changed scientific configuration', () => {
    const input = fixture();
    const content = { ...input.intentChain[1]!.content, codeCommitSha: 'f'.repeat(64) };
    const substituted = aflTradeModelRunIntentSchema.parse({
      intentId: createAflTradeContentAddress('model-run-intent', content),
      content,
    });
    expect(() =>
      createAflTradeModelRunPersistenceRecoveryManifest({
        ...input,
        intentChain: [input.intentChain[0]!, substituted],
      })
    ).toThrow();
  });
  it.each([
    { previousCheckpointId: id('model-run-checkpoint', 'f') },
    { dispatchClaimId: id('private-valuation-dispatch-claim', 'f') },
    { dispatchAttemptNumber: 2 },
    { authorizationId: id('model-run-authorization', 'f') },
    { candidateArtifact: createAflTradeCanonicalJsonArtifactRef({ substitute: true }, time(4)) },
  ])('rejects re-addressed stage-owner or candidate substitution %j', (change) => {
    const input = fixture();
    const checkpoints = [...input.checkpoints];
    checkpoints[1] = createAflTradeModelRunCheckpoint({ ...checkpoints[1]!.content, ...change });
    expect(() =>
      createAflTradeModelRunPersistenceRecoveryManifest({ ...input, checkpoints })
    ).toThrow();
  });
  it('rejects substituted completion bytes and mismatched report artifact timestamps', () => {
    const input = fixture();
    const completionEvidence = createAflTradeNativeFinalTestCompletionEvidence({
      ...input.completionEvidence,
      evaluatedAt: '2026-08-10T00:06:30.000Z',
    });
    expect(() =>
      createAflTradeModelRunPersistenceRecoveryManifest({ ...input, completionEvidence })
    ).toThrow();
    const checkpoints = [...input.checkpoints];
    checkpoints[3] = createAflTradeModelRunCheckpoint({
      ...checkpoints[3]!.content,
      evidenceArtifact: createAflTradeCanonicalJsonArtifactRef(
        input.completionEvidence,
        '2026-08-10T00:07:30.000Z'
      ),
    });
    const oldChild = input.intentChain[1]!;
    if (oldChild.content.schemaVersion !== 'afl-trade-model-run-intent/v2')
      throw new Error('Expected child.');
    const binding = oldChild.content.continuation;
    const child = createAflTradeModelRunContinuationIntent({
      previousIntent: input.intentChain[0]!,
      checkpoint: checkpoints[3],
      startedAt: oldChild.content.startedAt,
      ...binding,
      modelTrainingEvaluationReceiptIds: oldChild.content.modelTrainingEvaluationReceiptIds,
    });
    expect(() =>
      createAflTradeModelRunPersistenceRecoveryManifest({
        ...input,
        checkpoints,
        intentChain: [input.intentChain[0]!, child],
      })
    ).toThrow();
  });
  it('rejects a prior owner authorization or finish before child start', () => {
    const input = fixture();
    expect(() =>
      createAflTradeModelRunPersistenceRecoveryManifest({
        ...input,
        runAuthorizationId: input.checkpoints[0]!.content.authorizationId,
      })
    ).toThrow();
    expect(() =>
      createAflTradeModelRunPersistenceRecoveryManifest({ ...input, finishedAt: time(8) })
    ).toThrow();
  });
  it('allows unconsumed intermediate continuations on the same dispatch attempt', () => {
    const input = fixture();
    for (let index = 1; index <= 4; index++) {
      const previousIntent = input.intentChain.at(-1)!;
      input.intentChain.push(
        createAflTradeModelRunContinuationIntent({
          previousIntent,
          checkpoint: input.checkpoints[3]!,
          startedAt: `2026-08-10T00:09:${index}0.000Z`,
          dispatchClaimId: id('private-valuation-dispatch-claim', 'b'),
          dispatchAttemptNumber: 2,
          dispatchLeaseTokenSha256: 'b'.repeat(64),
          modelTrainingEvaluationReceiptIds:
            previousIntent.content.modelTrainingEvaluationReceiptIds,
        })
      );
    }
    const result = createAflTradeModelRunPersistenceRecoveryManifest(input);
    expect(result.content.recovery.intentChain).toHaveLength(6);
    expect(result.content.job.attempt).toBe(2);
  });
  it('preserves stages completed by a later worker before persistence-only recovery', () => {
    const input = fixture();
    const root = input.intentChain[0]!;
    const worker = createAflTradeModelRunContinuationIntent({
      previousIntent: root,
      checkpoint: input.checkpoints[1]!,
      startedAt: '2026-08-10T00:04:30.000Z',
      dispatchClaimId: id('private-valuation-dispatch-claim', 'b'),
      dispatchAttemptNumber: 2,
      dispatchLeaseTokenSha256: 'b'.repeat(64),
      modelTrainingEvaluationReceiptIds: [id('gate0a-evaluation', 'b')],
    });
    const testStarted = createAflTradeModelRunCheckpoint({
      ...input.checkpoints[2]!.content,
      intentId: worker.intentId,
      authorizationId: id('model-run-authorization', 'b'),
      dispatchClaimId: id('private-valuation-dispatch-claim', 'b'),
      dispatchAttemptNumber: 2,
    });
    const completionEvidence = createAflTradeNativeFinalTestCompletionEvidence({
      ...input.completionEvidence,
      finalTestStartedCheckpoint: testStarted,
    });
    const completed = createAflTradeModelRunCheckpoint({
      ...testStarted.content,
      stage: 'final_test_completed',
      previousCheckpointId: testStarted.checkpointId,
      recordedAt: time(8),
      evidenceArtifact: createAflTradeCanonicalJsonArtifactRef(completionEvidence, time(7)),
    });
    const child = createAflTradeModelRunContinuationIntent({
      previousIntent: worker,
      checkpoint: completed,
      startedAt: time(9),
      dispatchClaimId: id('private-valuation-dispatch-claim', 'c'),
      dispatchAttemptNumber: 3,
      dispatchLeaseTokenSha256: 'c'.repeat(64),
      modelTrainingEvaluationReceiptIds: [id('gate0a-evaluation', 'c')],
    });
    const result = createAflTradeModelRunPersistenceRecoveryManifest({
      ...input,
      intentChain: [root, worker, child],
      checkpoints: [...input.checkpoints.slice(0, 2), testStarted, completed],
      completionEvidence,
      runAuthorizationId: id('model-run-authorization', 'c'),
    });
    expect(result.content.recovery.checkpoints[2].content.intentId).toBe(worker.intentId);
    expect(result.content.startedAt).toBe(time(9));
    expect(result.content.finalTestEvaluatedAt).toBe(time(6));
  });
  it('rejects a prior worker recording a stage after its successor started', () => {
    const input = fixture();
    const root = input.intentChain[0]!;
    const earlyChild = createAflTradeModelRunContinuationIntent({
      previousIntent: root,
      checkpoint: input.checkpoints[1]!,
      startedAt: '2026-08-10T00:04:30.000Z',
      dispatchClaimId: id('private-valuation-dispatch-claim', 'b'),
      dispatchAttemptNumber: 2,
      dispatchLeaseTokenSha256: 'b'.repeat(64),
      modelTrainingEvaluationReceiptIds: [id('gate0a-evaluation', 'b')],
    });
    expect(() =>
      createAflTradeModelRunPersistenceRecoveryManifest({
        ...input,
        intentChain: [root, earlyChild],
      })
    ).toThrow('exact completed native run ancestry');
  });
});
