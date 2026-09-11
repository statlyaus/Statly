import { beforeAll, describe, expect, it } from 'vitest';
import {
  AflTradeAdmittedModelRunAuthorityService,
  authenticateAflTradeNativePavStageEvidence,
  createAflTradePrivateValuationModelRunOperationalAuthorization,
} from '@/server/aflTradeIntelligence/modeling/admittedModelRunAuthority';
import { createAflTradeModelRunContinuationIntent } from '@/server/aflTradeIntelligence/artifacts/modelRunManifest';
import { createAflTradeModelRunCheckpoint } from '@/server/aflTradeIntelligence/artifacts/modelRunCheckpoint';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeGate0AReceipt } from '@/server/aflTradeIntelligence/source/gate0aReceipt';
import { nativePavModelRunSqlFixture } from '../testUtils/nativePavModelRunSqlFixture';

describe('native PAV public continuation authorization', () => {
  let source: Awaited<ReturnType<typeof nativePavModelRunSqlFixture>>;
  beforeAll(async () => {
    source = await nativePavModelRunSqlFixture();
  }, 30_000);

  function resumed(stage: 'started' | 'final_test_completed' = 'started') {
    const root = source.intent;
    const original = source.operationalAuthorization.content;
    if (
      original.authorityBoundary !==
      'policy_owned_local_private_valuation_for_one_exact_model_run_intent'
    )
      throw new Error('Expected synthetic private fixture authority.');
    const startedAt = new Date(Date.parse(source.startedAt) + 40_000).toISOString();
    const checkpoint = createAflTradeModelRunCheckpoint({
      intentId: root.intentId,
      rootIntentId: root.intentId,
      authorizationId: source.authorization.authorizationId,
      dispatchRequestId: original.dispatchRequestId,
      substantiveOperationId: original.substantiveOperationId,
      dispatchClaimId: original.dispatchClaimId,
      dispatchAttemptNumber: original.dispatchAttemptNumber,
      stage,
      previousCheckpointId:
        stage === 'started'
          ? null
          : createAflTradeContentAddress('model-run-checkpoint', { synthetic: 'final started' }),
      recordedAt: root.content.startedAt,
      candidateArtifact: stage === 'started' ? null : root.content.configurationArtifact,
      evidenceArtifact: stage === 'started' ? null : root.content.configurationArtifact,
    });
    const runStartEvaluationReceipts = source.evidence.runStartEvaluationReceipts.map((receipt) => {
      const rights = source.evidence.sourceRightsProposals.find(
        (candidate) => candidate.rightsArtifactId === receipt.content.request.rightsArtifactId
      )!;
      return createAflTradeGate0AReceipt(
        source.evidence.gateDecisionLedger,
        rights,
        { ...receipt.content.request, evaluatedAt: startedAt },
        startedAt
      );
    });
    const intent = createAflTradeModelRunContinuationIntent({
      previousIntent: root,
      checkpoint,
      startedAt,
      dispatchClaimId: createAflTradeContentAddress('private-valuation-dispatch-claim', {
        synthetic: 'second attempt',
      }),
      dispatchLeaseTokenSha256: 'b'.repeat(64),
      dispatchAttemptNumber: 2,
      modelTrainingEvaluationReceiptIds: runStartEvaluationReceipts
        .map(({ receiptId }) => receiptId)
        .sort(),
    });
    if (intent.content.schemaVersion !== 'afl-trade-model-run-intent/v2')
      throw new Error('Expected child.');
    const binding = intent.content.continuation;
    const operationalAuthorization = createAflTradePrivateValuationModelRunOperationalAuthorization(
      {
        ...original,
        runIntentId: intent.intentId,
        dispatchClaimId: binding.dispatchClaimId,
        dispatchLeaseTokenSha256: binding.dispatchLeaseTokenSha256,
        dispatchAttemptNumber: binding.dispatchAttemptNumber,
        authorizedAt: startedAt,
        validThrough: new Date(Date.parse(startedAt) + 60_000).toISOString(),
      }
    );
    return {
      intent,
      startedAt,
      evidence: {
        ...source.evidence,
        runStartEvaluationReceipts,
        operationalAuthorization,
        continuationAuthority: { rootIntent: root, previousIntent: root, checkpoint },
      },
    };
  }

  it('issues only the current child authorization after the original operational claim expires', async () => {
    const child = resumed();
    expect(Date.parse(source.operationalAuthorization.content.validThrough)).toBeLessThan(
      Date.parse(child.startedAt)
    );
    const issued: string[] = [];
    const service = new AflTradeAdmittedModelRunAuthorityService({
      authenticator: { authenticate: async () => child.evidence },
      clock: { now: async () => child.startedAt },
      authorizationStore: {
        issueOnceForIntent: async ({ intent }) => {
          issued.push(intent.intentId);
          return true;
        },
        consumeIntentOnce: async () => {
          throw new Error('Issuance must not consume any intent.');
        },
      },
    });
    expect(
      await service.authorize({ intent: child.intent, protocol: source.protocol })
    ).toMatchObject({
      status: 'authorized',
      intent: child.intent,
      authorization: {
        content: {
          runIntentId: child.intent.intentId,
          operationalAuthorizationReceiptId: child.evidence.operationalAuthorization.receiptId,
        },
      },
    });
    expect(issued).toEqual([child.intent.intentId]);
  });

  it('resumes a stage under the fresh child claim without extending the expired root claim', () => {
    const child = resumed();
    expect(
      authenticateAflTradeNativePavStageEvidence({
        intent: child.intent,
        evidence: child.evidence,
        evaluatedAt: new Date(Date.parse(child.startedAt) + 10_000).toISOString(),
      })
    ).toHaveProperty('operationalAuthorization', child.evidence.operationalAuthorization);
    expect(() =>
      authenticateAflTradeNativePavStageEvidence({
        intent: child.intent,
        evidence: { ...child.evidence, operationalAuthorization: source.operationalAuthorization },
        evaluatedAt: child.startedAt,
      })
    ).toThrow();
  });

  it('rejects a child with no authenticated retained ancestry before issuing any authorization', async () => {
    const child = resumed();
    const { continuationAuthority: _ancestry, ...evidence } = child.evidence;
    const service = new AflTradeAdmittedModelRunAuthorityService({
      authenticator: { authenticate: async () => evidence },
      clock: { now: async () => child.startedAt },
      authorizationStore: {
        issueOnceForIntent: async () => {
          throw new Error('Missing ancestry must never reach issuance.');
        },
        consumeIntentOnce: async () => {
          throw new Error('Missing ancestry must never consume.');
        },
      },
    });
    expect(
      await service.authorize({ intent: child.intent, protocol: source.protocol })
    ).toMatchObject({ status: 'blocked', blockers: [{ code: 'ancestry_mismatch' }] });
  });

  it('does not authorize numerical work again after a retained final-test completion', async () => {
    const child = resumed('final_test_completed');
    const service = new AflTradeAdmittedModelRunAuthorityService({
      authenticator: { authenticate: async () => child.evidence },
      clock: { now: async () => child.startedAt },
      authorizationStore: {
        issueOnceForIntent: async () => {
          throw new Error('Final completion permits no new numerical authorization.');
        },
        consumeIntentOnce: async () => {
          throw new Error('Final completion permits no new numerical consume.');
        },
      },
    });
    expect(
      await service.authorize({ intent: child.intent, protocol: source.protocol })
    ).toMatchObject({ status: 'blocked', blockers: [{ code: 'ancestry_mismatch' }] });
    expect(() =>
      authenticateAflTradeNativePavStageEvidence({
        intent: child.intent,
        evidence: child.evidence,
        evaluatedAt: child.startedAt,
      })
    ).toThrow();
  });

  it('issues explicit persistence-only authority after completion without exposing numerical inputs', async () => {
    const child = resumed('final_test_completed');
    const issued: string[] = [];
    const purposes: unknown[] = [];
    const service = new AflTradeAdmittedModelRunAuthorityService({
      authenticator: {
        authenticate: async (request) => {
          purposes.push(request.purpose);
          return child.evidence;
        },
      },
      clock: { now: async () => child.startedAt },
      authorizationStore: {
        issueOnceForIntent: async ({ intent }) => {
          issued.push(intent.intentId);
          return true;
        },
        consumeIntentOnce: async () => {
          throw new Error('Issuance must not consume or execute.');
        },
      },
    });
    const result = await service.authorizePersistenceRecovery({
      intent: child.intent,
      protocol: source.protocol,
    });
    expect(result).toMatchObject({
      status: 'authorized_for_persistence_only',
      intent: child.intent,
      authorization: { content: { runIntentId: child.intent.intentId } },
      blockers: [],
    });
    expect(result).not.toHaveProperty('modelFamily');
    expect(result).not.toHaveProperty('executableArtifacts');
    expect(result).not.toHaveProperty('observationSet');
    expect(issued).toEqual([child.intent.intentId]);
    expect(purposes).toEqual(['persistence_only']);
  });

  it('refuses persistence-only issuance before final completion', async () => {
    const child = resumed();
    const issued: string[] = [];
    const service = new AflTradeAdmittedModelRunAuthorityService({
      authenticator: { authenticate: async () => child.evidence },
      clock: { now: async () => child.startedAt },
      authorizationStore: {
        issueOnceForIntent: async ({ intent }) => {
          issued.push(intent.intentId);
          return true;
        },
        consumeIntentOnce: async () => {
          throw new Error('Issuance cannot consume.');
        },
      },
    });
    expect(
      await service.authorizePersistenceRecovery({
        intent: child.intent,
        protocol: source.protocol,
      })
    ).toMatchObject({ status: 'blocked', blockers: [{ code: 'ancestry_mismatch' }] });
    expect(issued).toEqual([]);
  });

  it('requires current operational authority even when only saving completed results', async () => {
    const child = resumed('final_test_completed');
    const issued: string[] = [];
    const service = new AflTradeAdmittedModelRunAuthorityService({
      authenticator: { authenticate: async () => child.evidence },
      clock: { now: async () => new Date(Date.parse(child.startedAt) + 61_000).toISOString() },
      maximumStartDelayMs: 120_000,
      authorizationStore: {
        issueOnceForIntent: async ({ intent }) => {
          issued.push(intent.intentId);
          return true;
        },
        consumeIntentOnce: async () => {
          throw new Error('Issuance cannot consume.');
        },
      },
    });
    expect(
      await service.authorizePersistenceRecovery({
        intent: child.intent,
        protocol: source.protocol,
      })
    ).toMatchObject({
      status: 'blocked',
      blockers: [{ code: 'operational_authorization_invalid' }],
    });
    expect(issued).toEqual([]);
  });

  it('rejects a structurally valid operational receipt naming another child lease', () => {
    const child = resumed();
    const original = child.evidence.operationalAuthorization.content;
    if (
      original.authorityBoundary !==
      'policy_owned_local_private_valuation_for_one_exact_model_run_intent'
    )
      throw new Error('Expected private receipt.');
    const operationalAuthorization = createAflTradePrivateValuationModelRunOperationalAuthorization(
      {
        ...original,
        dispatchLeaseTokenSha256: 'c'.repeat(64),
      }
    );
    expect(() =>
      authenticateAflTradeNativePavStageEvidence({
        intent: child.intent,
        evidence: { ...child.evidence, operationalAuthorization },
        evaluatedAt: child.startedAt,
      })
    ).toThrow();
  });

  it('rejects substitution of an otherwise valid retained predecessor checkpoint', () => {
    const child = resumed();
    const ancestry = child.evidence.continuationAuthority;
    const checkpoint = createAflTradeModelRunCheckpoint({
      ...ancestry.checkpoint.content,
      recordedAt: new Date(Date.parse(source.startedAt) + 1_000).toISOString(),
    });
    expect(checkpoint.checkpointId).not.toBe(ancestry.checkpoint.checkpointId);
    expect(() =>
      authenticateAflTradeNativePavStageEvidence({
        intent: child.intent,
        evidence: { ...child.evidence, continuationAuthority: { ...ancestry, checkpoint } },
        evaluatedAt: child.startedAt,
      })
    ).toThrow();
  });

  it('resumes an earlier worker checkpoint through an unconsumed intermediate intent on the same live claim', async () => {
    const worker = resumed();
    const at = (seconds: number) =>
      new Date(Date.parse(worker.startedAt) + seconds * 1000).toISOString();
    if (worker.intent.content.schemaVersion !== 'afl-trade-model-run-intent/v2')
      throw new Error('Expected worker child.');
    const binding = worker.intent.content.continuation;
    const checkpoint = createAflTradeModelRunCheckpoint({
      ...worker.evidence.continuationAuthority.checkpoint.content,
      intentId: worker.intent.intentId,
      dispatchClaimId: binding.dispatchClaimId,
      dispatchAttemptNumber: 2,
      stage: 'candidate_locked',
      previousCheckpointId: worker.evidence.continuationAuthority.checkpoint.checkpointId,
      candidateArtifact: source.intent.content.configurationArtifact,
      evidenceArtifact: source.intent.content.configurationArtifact,
      recordedAt: at(1),
    });
    const runStartEvaluationReceipts = source.evidence.runStartEvaluationReceipts.map((receipt) =>
      createAflTradeGate0AReceipt(
        source.evidence.gateDecisionLedger,
        source.evidence.sourceRightsProposals.find(
          (rights) => rights.rightsArtifactId === receipt.content.request.rightsArtifactId
        )!,
        { ...receipt.content.request, evaluatedAt: at(3) },
        at(3)
      )
    );
    const continueInput = {
      checkpoint,
      dispatchClaimId: binding.dispatchClaimId,
      dispatchLeaseTokenSha256: binding.dispatchLeaseTokenSha256,
      dispatchAttemptNumber: 2,
      modelTrainingEvaluationReceiptIds: runStartEvaluationReceipts
        .map((receipt) => receipt.receiptId)
        .sort(),
    };
    const intermediate = createAflTradeModelRunContinuationIntent({
      ...continueInput,
      previousIntent: worker.intent,
      startedAt: at(2),
    });
    const intent = createAflTradeModelRunContinuationIntent({
      ...continueInput,
      previousIntent: intermediate,
      startedAt: at(3),
    });
    const operational = worker.evidence.operationalAuthorization.content;
    if (
      operational.authorityBoundary !==
      'policy_owned_local_private_valuation_for_one_exact_model_run_intent'
    )
      throw new Error('Expected private authority.');
    const evidence = {
      ...worker.evidence,
      runStartEvaluationReceipts,
      operationalAuthorization: createAflTradePrivateValuationModelRunOperationalAuthorization({
        ...operational,
        runIntentId: intent.intentId,
        authorizedAt: at(3),
      }),
      continuationAuthority: {
        rootIntent: source.intent,
        previousIntent: intermediate,
        checkpoint,
        checkpointIntent: worker.intent,
      },
    };
    const issued: string[] = [];
    const service = new AflTradeAdmittedModelRunAuthorityService({
      authenticator: { authenticate: async () => evidence },
      clock: { now: async () => at(3) },
      authorizationStore: {
        issueOnceForIntent: async ({ intent: current }) => {
          issued.push(current.intentId);
          return true;
        },
        consumeIntentOnce: async () => {
          throw new Error('Issuance cannot reconsume any ancestor.');
        },
      },
    });
    expect(await service.authorize({ intent, protocol: source.protocol })).toMatchObject({
      status: 'authorized',
    });
    expect(issued).toEqual([intent.intentId]);
  });
});
