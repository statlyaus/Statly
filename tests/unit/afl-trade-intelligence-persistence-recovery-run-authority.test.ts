import { describe, expect, it } from 'vitest';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeModelRunCheckpoint } from '@/server/aflTradeIntelligence/artifacts/modelRunCheckpoint';
import {
  createAflTradeModelRunIntent,
  createAflTradeModelRunContinuationIntent,
  createAflTradeModelRunPersistenceRecoveryManifest,
  createAflTradeNativeFinalTestCompletionEvidence,
} from '@/server/aflTradeIntelligence/artifacts/modelRunManifest';
import {
  authenticateAflTradeAuthorizedPersistenceRecoveryManifest,
  aflTradeModelRunAuthorizationSchema,
} from '@/server/aflTradeIntelligence/modeling/admittedModelRunAuthority';
import { admittedRunFixture, runContent } from '../testUtils/admittedPlayerModelRunFixture';

const id = (prefix: string, c = 'a') => `${prefix}:${c.repeat(64)}`;
const time = (minute: number) => `2026-08-10T00:${String(minute).padStart(2, '0')}:00.000Z`;

function fixture() {
  // Structural retained evidence only: no source, claim or consumed-authority proof is fabricated.
  const root = createAflTradeModelRunIntent({
    ...admittedRunFixture().intent.content,
    environment: 'non_production',
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
  if (outcome.status !== 'succeeded') throw new Error('Expected success fixture');
  const locked = createAflTradeModelRunCheckpoint({
    ...started.content,
    stage: 'candidate_locked',
    previousCheckpointId: started.checkpointId,
    recordedAt: time(4),
    candidateArtifact: outcome.modelArtifact,
    evidenceArtifact: createAflTradeCanonicalJsonArtifactRef({ fixture: 'candidate' }, time(4)),
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
    evidenceArtifact: createAflTradeCanonicalJsonArtifactRef(completionEvidence, time(7)),
  });
  const intent = createAflTradeModelRunContinuationIntent({
    previousIntent: root,
    checkpoint: completed,
    startedAt: time(9),
    dispatchClaimId: id('private-valuation-dispatch-claim', 'b'),
    dispatchAttemptNumber: 2,
    dispatchLeaseTokenSha256: 'b'.repeat(64),
    modelTrainingEvaluationReceiptIds: [id('gate0a-evaluation', 'b')],
  });
  const content = {
    schemaVersion: 'afl-trade-model-run-authorization/v1',
    authorityBoundary: 'model_run_start_authority_no_grade_publication_or_fantasy_ownership',
    publicationEligible: false,
    environment: 'non_production',
    runIntentId: intent.intentId,
    datasetId: intent.content.datasetId,
    datasetAdmissionId: intent.content.datasetAdmissionId,
    datasetRowSetSha256: 'a'.repeat(64),
    modelProtocolId: intent.content.modelProtocolId,
    observationSetId: intent.content.observationSetId,
    operationalAuthorizationReceiptId: id('architecture-operation-receipt'),
    gate2DecisionId: id('gate-decision'),
    gateLedgerRevision: 1,
    authorizedAt: time(9),
    validThrough: '2026-08-10T00:09:30.000Z',
    modelTrainingEvaluationReceiptIds: intent.content.modelTrainingEvaluationReceiptIds,
  };
  const authorization = aflTradeModelRunAuthorizationSchema.parse({
    authorizationId: createAflTradeContentAddress('model-run-authorization', content),
    content,
  });
  const run = createAflTradeModelRunPersistenceRecoveryManifest({
    intentChain: [root, intent],
    checkpoints: [started, locked, testStarted, completed],
    completionEvidence,
    runAuthorizationId: authorization.authorizationId,
    finishedAt: time(10),
  });
  return { run, intent, authorization };
}

describe('authorized persistence-only recovery manifest', () => {
  it('authenticates exact historical child authority without requiring it to remain unexpired', () => {
    const input = fixture();
    expect(authenticateAflTradeAuthorizedPersistenceRecoveryManifest(input)).toEqual(input.run);
  });
  it.each([
    { environment: 'test_fixture' },
    { runIntentId: id('model-run-intent', 'f') },
    { datasetId: id('dataset', 'f') },
    { datasetAdmissionId: id('dataset-admission', 'f') },
    { modelProtocolId: id('model-protocol', 'f') },
    { observationSetId: id('player-observation-set', 'f') },
    { modelTrainingEvaluationReceiptIds: [id('gate0a-evaluation', 'f')] },
    { authorizedAt: time(8) },
    { authorizedAt: time(11), validThrough: time(12) },
  ])('rejects coherently re-addressed wrong child authority %j', (change) => {
    const input = fixture();
    const content = { ...input.authorization.content, ...change };
    const authorization = aflTradeModelRunAuthorizationSchema.parse({
      authorizationId: createAflTradeContentAddress('model-run-authorization', content),
      content,
    });
    const run = createAflTradeModelRunPersistenceRecoveryManifest({
      ...input.run.content.recovery,
      runAuthorizationId: authorization.authorizationId,
      finishedAt: input.run.content.finishedAt,
    });
    expect(() =>
      authenticateAflTradeAuthorizedPersistenceRecoveryManifest({
        ...input,
        run,
        authorization,
      })
    ).toThrow('exact child intent and authorization');
  });
  it('allows issuance after child start and retention after the start authorization expires', () => {
    const input = fixture();
    const content = { ...input.authorization.content, authorizedAt: '2026-08-10T00:09:02.000Z' };
    const authorization = aflTradeModelRunAuthorizationSchema.parse({
      authorizationId: createAflTradeContentAddress('model-run-authorization', content),
      content,
    });
    const run = createAflTradeModelRunPersistenceRecoveryManifest({
      ...input.run.content.recovery,
      runAuthorizationId: authorization.authorizationId,
      finishedAt: input.run.content.finishedAt,
    });
    expect(
      authenticateAflTradeAuthorizedPersistenceRecoveryManifest({
        ...input,
        run,
        authorization,
      })
    ).toEqual(run);
  });
  it('rejects the original root as the supplied child and unbound authorization identities', () => {
    const input = fixture();
    expect(() =>
      authenticateAflTradeAuthorizedPersistenceRecoveryManifest({
        ...input,
        intent: input.run.content.recovery.intentChain[0]!,
      })
    ).toThrow('exact child intent and authorization');
    expect(() =>
      authenticateAflTradeAuthorizedPersistenceRecoveryManifest({
        ...input,
        authorization: {
          ...input.authorization,
          authorizationId: id('model-run-authorization', 'f'),
        },
      })
    ).toThrow();
    const content = { ...input.authorization.content, gateLedgerRevision: 2 };
    const authorization = aflTradeModelRunAuthorizationSchema.parse({
      authorizationId: createAflTradeContentAddress('model-run-authorization', content),
      content,
    });
    expect(() =>
      authenticateAflTradeAuthorizedPersistenceRecoveryManifest({ ...input, authorization })
    ).toThrow('exact child intent and authorization');
  });
});
