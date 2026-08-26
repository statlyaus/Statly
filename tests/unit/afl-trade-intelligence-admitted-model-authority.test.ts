import { describe, expect, it } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeFixtureArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import { createAflTradeValuationDatasetAdmissionReceipt } from '@/server/aflTradeIntelligence/artifacts/valuationDatasetAdmissionContracts';
import {
  aflTradeAnyPlayerContributionModelProtocolSchema,
  createAflTradePlayerContributionModelProtocolV2,
} from '@/server/aflTradeIntelligence/artifacts/modelProtocol';
import {
  aflTradeAnyModelRunManifestSchema,
  createAflTradeModelRunIntent,
} from '@/server/aflTradeIntelligence/artifacts/modelRunManifest';
import {
  AflTradeAdmittedModelRunner,
  AflTradeAdmittedModelRunAuthorityService,
  createAflTradeModelRunOperationalAuthorization,
  createAflTradePrivateValuationModelRunOperationalAuthorization,
  type AflTradeAdmittedModelRunEvidence,
  type AflTradeModelRunAuthorizationStore,
} from '@/server/aflTradeIntelligence/modeling/admittedModelRunAuthority';
import { createAflTradeAdmittedPlayerContributionExecutor } from '@/server/aflTradeIntelligence/modeling/admittedPlayerContributionCandidate';

import {
  admittedRunFixture,
  artifact,
  digest,
  outcomeMetricCodes,
  protocolContent,
  runContent,
} from '../testUtils/admittedPlayerModelRunFixture';

function fixedClock(value = '2026-08-10T00:03:00.000Z') {
  return { now: async () => value };
}

function memoryFailureRecorder() {
  return {
    recordExecutionFailure: async ({ failedAt }: { failedAt: string }) => ({
      candidateLockedAt: null,
      finalTestEvaluatedAt: null,
      finishedAt: failedAt,
      outcome: {
        status: 'failed' as const,
        failureClassification: 'training_failure' as const,
        failureArtifact: artifact('d'),
        diagnosticsArtifact: artifact('e'),
      },
    }),
  };
}

function memoryAuthorizationStore(): AflTradeModelRunAuthorizationStore & {
  persistCompletedRun: (run: { runId: string }) => Promise<boolean>;
} {
  const authorizationByIntent = new Map<string, string>();
  const consumedIntents = new Set<string>();
  return {
    issueOnceForIntent: async ({ authorization, intent }) => {
      const prior = authorizationByIntent.get(intent.intentId);
      if (prior !== undefined && prior !== authorization.authorizationId) return false;
      authorizationByIntent.set(intent.intentId, authorization.authorizationId);
      return true;
    },
    consumeIntentOnce: async ({ authorizationId, intentId }) => {
      if (
        authorizationByIntent.get(intentId) !== authorizationId ||
        consumedIntents.has(intentId)
      ) {
        return false;
      }
      consumedIntents.add(intentId);
      return true;
    },
    persistCompletedRun: async () => true,
  };
}

function authorityService(
  evidence: AflTradeAdmittedModelRunEvidence,
  store = memoryAuthorizationStore(),
  clock = fixedClock(),
  authorizationLifetimeMs?: number
) {
  return {
    clock,
    store,
    service: new AflTradeAdmittedModelRunAuthorityService({
      authenticator: { authenticate: async () => evidence },
      clock,
      authorizationStore: store,
      authorizationLifetimeMs,
    }),
  };
}

describe('admitted AFL trade model authority contracts', () => {
  it('keeps legacy protocol and model-run documents readable', () => {
    const legacyProtocol = { ...protocolContent(), schemaVersion: 'afl-trade-model-protocol/v1' };
    delete (legacyProtocol as Partial<typeof legacyProtocol>).datasetAdmission;
    delete (legacyProtocol as Partial<typeof legacyProtocol>).scalarValueTransformArtifact;
    const protocol = {
      protocolId: createAflTradeContentAddress('model-protocol', legacyProtocol),
      content: legacyProtocol,
    };
    const legacyRun = { ...runContent(), schemaVersion: 'afl-trade-model-run/v2' };
    delete (legacyRun as Partial<typeof legacyRun>).datasetAdmissionId;
    delete (legacyRun as Partial<typeof legacyRun>).runIntentId;
    delete (legacyRun as Partial<typeof legacyRun>).runAuthorizationId;
    delete (legacyRun as Partial<typeof legacyRun>).observationSetId;
    delete (legacyRun as Partial<typeof legacyRun>).modelTrainingEvaluationReceiptIds;
    const run = {
      runId: createAflTradeContentAddress('model-run', legacyRun),
      content: legacyRun,
    };

    expect(aflTradeAnyPlayerContributionModelProtocolSchema.safeParse(protocol).success).toBe(true);
    expect(aflTradeAnyModelRunManifestSchema.safeParse(run).success).toBe(true);
  });

  it('creates a protocol that binds the exact admitted dataset contract', () => {
    const protocol = createAflTradePlayerContributionModelProtocolV2(protocolContent());

    expect(protocol.protocolId).toMatch(/^model-protocol:[a-f0-9]{64}$/);
    expect(protocol.content.observationGrain).toBe('player_acquisition_spell_prediction');
    expect(protocol.content.sourceOutcomeVector).toEqual(outcomeMetricCodes);
  });

  it('rejects protocol chronology and duplicate or unordered run-start rights evidence', () => {
    expect(() =>
      createAflTradePlayerContributionModelProtocolV2({
        ...protocolContent(),
        preparedAt: '2026-08-10T00:00:00.000Z',
      })
    ).toThrow();

    const fixture = admittedRunFixture();
    expect(() =>
      createAflTradeModelRunIntent({
        ...fixture.intent.content,
        modelTrainingEvaluationReceiptIds: [
          `gate0a-evaluation:${digest('2')}`,
          `gate0a-evaluation:${digest('1')}`,
        ],
      })
    ).toThrow();

    expect(() =>
      createAflTradeValuationDatasetAdmissionReceipt({
        ...fixture.admission.content,
        gate2Decision: {
          ...fixture.admission.content.gate2Decision,
          evaluatedAt: '2026-08-10T00:00:59.000Z',
        },
      })
    ).toThrow();
    expect(() =>
      createAflTradeModelRunIntent({
        ...fixture.intent.content,
        modelTrainingEvaluationReceiptIds: [
          `gate0a-evaluation:${digest('1')}`,
          `gate0a-evaluation:${digest('1')}`,
        ],
      })
    ).toThrow();
  });

  it('authorizes one exact admitted observation set before constructing its model run', async () => {
    const fixture = admittedRunFixture();
    const boundary = authorityService(fixture.evidence);
    const runner = new AflTradeAdmittedModelRunner(
      boundary.service,
      {
        execute: async () => ({
          candidateLockedAt: '2026-08-10T00:04:00.000Z',
          finalTestEvaluatedAt: '2026-08-10T00:05:00.000Z',
          finishedAt: '2026-08-10T00:06:00.000Z',
          outcome: runContent(fixture.protocol).outcome,
        }),
      },
      boundary.store,
      boundary.clock,
      boundary.store,
      memoryFailureRecorder()
    );

    const result = await runner.run({ intent: fixture.intent, protocol: fixture.protocol });

    if (result.status !== 'completed') throw new Error(JSON.stringify(result));
    expect(result.status).toBe('completed');
    expect(result.authorization.content).toMatchObject({
      datasetId: fixture.admission.content.datasetId,
      datasetAdmissionId: fixture.admission.admissionId,
      modelProtocolId: fixture.protocol.protocolId,
      observationSetId: fixture.observationSet.observationSetId,
      gateLedgerRevision: fixture.evidence.gateLedgerRevision,
      operationalAuthorizationReceiptId: fixture.operationalAuthorization.receiptId,
      authorizedAt: fixture.intent.content.startedAt,
      publicationEligible: false,
    });
    expect(result.run.content.runAuthorizationId).toBe(result.authorization.authorizationId);
    const replay = await runner.run({ intent: fixture.intent, protocol: fixture.protocol });
    expect(replay).toMatchObject({ status: 'blocked' });

    const capped = await authorityService(
      fixture.evidence,
      memoryAuthorizationStore(),
      fixedClock(),
      60_000
    ).service.authorize({ intent: fixture.intent, protocol: fixture.protocol });
    if (capped.status !== 'authorized') throw new Error(JSON.stringify(capped));
    expect(capped.authorization.content.validThrough).toBe('2026-08-10T00:03:30.000Z');

    const advancingInstants = [
      '2026-08-10T00:03:00.000Z',
      '2026-08-10T00:03:00.000Z',
      '2026-08-10T00:03:01.000Z',
    ];
    const advancingClock = {
      now: async () => advancingInstants.shift() ?? '2026-08-10T00:03:01.000Z',
    };
    const advancingBoundary = authorityService(
      fixture.evidence,
      memoryAuthorizationStore(),
      advancingClock
    );
    const advancingRunner = new AflTradeAdmittedModelRunner(
      advancingBoundary.service,
      {
        execute: async () => ({
          candidateLockedAt: '2026-08-10T00:04:00.000Z',
          finalTestEvaluatedAt: '2026-08-10T00:05:00.000Z',
          finishedAt: '2026-08-10T00:06:00.000Z',
          outcome: runContent(fixture.protocol).outcome,
        }),
      },
      advancingBoundary.store,
      advancingBoundary.clock,
      advancingBoundary.store,
      memoryFailureRecorder()
    );
    expect(
      await advancingRunner.run({ intent: fixture.intent, protocol: fixture.protocol })
    ).toMatchObject({ status: 'completed' });
    expect(
      await advancingRunner.run({ intent: fixture.intent, protocol: fixture.protocol })
    ).toMatchObject({
      status: 'blocked',
      blockers: [{ code: 'authorization_unavailable' }],
    });
  });

  it('executes the real admitted player candidate from authenticated bytes and retains every evidence artifact', async () => {
    const fixture = admittedRunFixture();
    const boundary = authorityService(fixture.evidence);
    const outputRepository = createAflTradeFixtureArtifactRepository({
      artifactClass: 'derived_private',
    });
    const executionTimes = [
      '2026-08-10T00:04:00.000Z',
      '2026-08-10T00:05:00.000Z',
      '2026-08-10T00:06:00.000Z',
    ];
    let executionCause: unknown = null;
    const runner = new AflTradeAdmittedModelRunner(
      boundary.service,
      createAflTradeAdmittedPlayerContributionExecutor({
        artifactRepository: outputRepository,
        maximumArtifactBytes: 1024 * 1024,
        now: () => executionTimes.shift() ?? '2026-08-10T00:06:00.000Z',
      }),
      boundary.store,
      boundary.clock,
      boundary.store,
      {
        recordExecutionFailure: async ({ failedAt, cause }) => {
          executionCause = cause;
          return memoryFailureRecorder().recordExecutionFailure({ failedAt });
        },
      }
    );

    const result = await runner.run({ intent: fixture.intent, protocol: fixture.protocol });

    if (result.status !== 'completed') throw new Error(JSON.stringify(result));
    if (result.run.content.outcome.status !== 'succeeded') throw executionCause;
    expect(result.run.content.outcome.status).toBe('succeeded');
    if (result.run.content.outcome.status !== 'succeeded') throw new Error('Expected success.');
    const references = Object.values(result.run.content.outcome).filter(
      (value): value is ReturnType<typeof artifact> =>
        typeof value === 'object' && value !== null && 'artifactId' in value
    );
    expect(references).toHaveLength(10);
    for (const reference of references) {
      await expect(outputRepository.loadExact(reference, 1024 * 1024)).resolves.not.toBeNull();
    }
  });

  it('preserves two acquisition spells for the same player and season as distinct rows', () => {
    const fixture = admittedRunFixture();
    const shared = fixture.observationSet.content.observations.filter(
      (observation) => observation.playerId === 'afl-player:shared' && observation.season === 2011
    );

    expect(shared).toHaveLength(2);
    expect(new Set(shared.map(({ acquisitionSpellId }) => acquisitionSpellId)).size).toBe(2);
  });

  it('does not report an executed model run as completed until its manifest is durable', async () => {
    const fixture = admittedRunFixture();
    const store = memoryAuthorizationStore();
    store.persistCompletedRun = async () => false;
    const boundary = authorityService(fixture.evidence, store);
    let executions = 0;
    const runner = new AflTradeAdmittedModelRunner(
      boundary.service,
      {
        execute: async () => {
          executions += 1;
          return {
            candidateLockedAt: '2026-08-10T00:04:00.000Z',
            finalTestEvaluatedAt: '2026-08-10T00:05:00.000Z',
            finishedAt: '2026-08-10T00:06:00.000Z',
            outcome: runContent(fixture.protocol).outcome,
          };
        },
      },
      store,
      boundary.clock,
      store,
      memoryFailureRecorder()
    );

    const failed = await runner.run({ intent: fixture.intent, protocol: fixture.protocol });

    expect(failed).toMatchObject({
      status: 'persistence_failed',
      run: { runId: expect.stringMatching(/^model-run:[a-f0-9]{64}$/) },
      blockers: [{ code: 'run_persistence_failed' }],
    });
    expect(executions).toBe(1);
    expect(await runner.run({ intent: fixture.intent, protocol: fixture.protocol })).toMatchObject({
      status: 'blocked',
    });
    expect(executions).toBe(1);
  });

  it('persists an immutable failed run when the executor rejects after consumption', async () => {
    const fixture = admittedRunFixture();
    const store = memoryAuthorizationStore();
    const persistedRuns: { content: { outcome: { status: string } } }[] = [];
    store.persistCompletedRun = async (run) => {
      persistedRuns.push(run as unknown as (typeof persistedRuns)[number]);
      return true;
    };
    const boundary = authorityService(fixture.evidence, store);
    const runner = new AflTradeAdmittedModelRunner(
      boundary.service,
      {
        execute: async () => {
          throw new Error('fitter rejected');
        },
      },
      store,
      boundary.clock,
      store,
      memoryFailureRecorder()
    );

    const result = await runner.run({ intent: fixture.intent, protocol: fixture.protocol });

    expect(result).toMatchObject({
      status: 'completed',
      run: { content: { outcome: { status: 'failed' } } },
    });
    expect(persistedRuns).toHaveLength(1);
    expect(persistedRuns[0]?.content.outcome.status).toBe('failed');
    expect(await runner.run({ intent: fixture.intent, protocol: fixture.protocol })).toMatchObject({
      status: 'blocked',
    });
  });

  it('never invokes the fitter until the exact intent is authorized', async () => {
    const fixture = admittedRunFixture();
    let executions = 0;
    const boundary = authorityService({
      ...fixture.evidence,
      gate2Ledger: { ...fixture.evidence.gate2Ledger, decisions: [] },
    });
    const runner = new AflTradeAdmittedModelRunner(
      boundary.service,
      {
        execute: async () => {
          executions += 1;
          return {
            candidateLockedAt: '2026-08-10T00:04:00.000Z',
            finalTestEvaluatedAt: '2026-08-10T00:05:00.000Z',
            finishedAt: '2026-08-10T00:06:00.000Z',
            outcome: runContent(fixture.protocol).outcome,
          };
        },
      },
      boundary.store,
      boundary.clock,
      boundary.store,
      memoryFailureRecorder()
    );

    const result = await runner.run({ intent: fixture.intent, protocol: fixture.protocol });

    expect(result.status).toBe('blocked');
    expect(executions).toBe(0);

    const instants = ['2026-08-10T00:03:00.000Z', '2026-08-09T14:03:31.000-10:00'];
    const offsetClock = {
      now: async () => instants.shift() ?? '2026-08-09T14:03:31.000-10:00',
    };
    const offsetBoundary = authorityService(
      fixture.evidence,
      memoryAuthorizationStore(),
      offsetClock
    );
    const offsetRunner = new AflTradeAdmittedModelRunner(
      offsetBoundary.service,
      {
        execute: async () => {
          executions += 1;
          return {
            candidateLockedAt: '2026-08-10T00:04:00.000Z',
            finalTestEvaluatedAt: '2026-08-10T00:05:00.000Z',
            finishedAt: '2026-08-10T00:06:00.000Z',
            outcome: runContent(fixture.protocol).outcome,
          };
        },
      },
      offsetBoundary.store,
      offsetBoundary.clock,
      offsetBoundary.store,
      memoryFailureRecorder()
    );
    const offsetExpired = await offsetRunner.run({
      intent: fixture.intent,
      protocol: fixture.protocol,
    });
    expect(offsetExpired).toMatchObject({
      status: 'blocked',
      blockers: [{ code: 'authorization_not_consumable' }],
    });
    expect(executions).toBe(0);
  });

  it('blocks omitted, fabricated, or no-longer-current model-training authority', async () => {
    const fixture = admittedRunFixture();
    const request = {
      intent: fixture.intent,
      protocol: fixture.protocol,
    };

    const omitted = await authorityService({
      ...fixture.evidence,
      runStartEvaluationReceipts: [],
    }).service.authorize(request);
    expect(omitted).toMatchObject({ status: 'blocked' });

    const [firstMetric, ...remainingMetrics] = fixture.spellMetrics;
    if (firstMetric.content.availability.state !== 'complete') {
      throw new Error('The authority fixture requires a complete first spell metric.');
    }
    const changedOutcomeWithOriginalObservationSet = await authorityService({
      ...fixture.evidence,
      spellMetrics: [
        {
          ...firstMetric,
          content: {
            ...firstMetric.content,
            availability: { state: 'complete', numericValue: '999', reasonCode: null },
          },
        },
        ...remainingMetrics,
      ],
    }).service.authorize(request);
    expect(changedOutcomeWithOriginalObservationSet).toMatchObject({
      status: 'blocked',
      blockers: [{ code: 'invalid_evidence' }],
    });

    const fabricatedIntent = createAflTradeModelRunIntent({
      ...fixture.intent.content,
      seed: fixture.intent.content.seed + 1,
    });
    const fabricatedOperationalAuthorization = createAflTradeModelRunOperationalAuthorization({
      ...fixture.operationalAuthorization.content,
      runIntentId: fabricatedIntent.intentId,
    });
    const fabricated = await authorityService({
      ...fixture.evidence,
      operationalAuthorization: fabricatedOperationalAuthorization,
    }).service.authorize({
      ...request,
      intent: fabricatedIntent,
    });
    if (fabricated.status !== 'authorized') throw new Error(JSON.stringify(fabricated));
    expect(fabricated).toMatchObject({ status: 'authorized' });
    const original = await authorityService(fixture.evidence).service.authorize(request);
    if (original.status !== 'authorized') throw new Error(JSON.stringify(original));
    expect(fabricated.authorization.authorizationId).not.toBe(
      original.authorization.authorizationId
    );
    const withdrawn = await authorityService({
      ...fixture.evidence,
      gateDecisionLedger: { ...fixture.evidence.gateDecisionLedger, decisions: [] },
    }).service.authorize(request);
    expect(withdrawn).toMatchObject({ status: 'blocked' });

    const gate2Withdrawn = await authorityService({
      ...fixture.evidence,
      gate2Ledger: { ...fixture.evidence.gate2Ledger, decisions: [] },
    }).service.authorize(request);
    expect(gate2Withdrawn).toMatchObject({ status: 'blocked' });

    const substitutedArtifact = await authorityService({
      ...fixture.evidence,
      executableArtifacts: fixture.evidence.executableArtifacts.map((proof, index) =>
        index === 0 ? { ...proof, bytes: new TextEncoder().encode('substituted') } : proof
      ),
    }).service.authorize(request);
    expect(substitutedArtifact).toMatchObject({
      status: 'blocked',
      blockers: [{ code: 'execution_artifact_mismatch' }],
    });

    const missingScalarTransform = await authorityService({
      ...fixture.evidence,
      executableArtifacts: fixture.evidence.executableArtifacts.filter(
        ({ artifactId }) =>
          artifactId !== fixture.protocol.content.scalarValueTransformArtifact.artifactId
      ),
    }).service.authorize(request);
    expect(missingScalarTransform).toMatchObject({
      status: 'blocked',
      blockers: [{ code: 'execution_artifact_mismatch' }],
    });

    const mismatchedFeatureIntent = createAflTradeModelRunIntent({
      ...fixture.intent.content,
      featureDefinitionArtifacts: [artifact('2')],
    });
    const mismatchedFeature = await authorityService(fixture.evidence).service.authorize({
      intent: mismatchedFeatureIntent,
      protocol: fixture.protocol,
    });
    expect(mismatchedFeature).toMatchObject({
      status: 'blocked',
      blockers: [{ code: 'execution_artifact_mismatch' }],
    });

    const backdated = await authorityService(
      fixture.evidence,
      memoryAuthorizationStore(),
      fixedClock('2026-08-10T00:04:00.000Z')
    ).service.authorize(request);
    expect(backdated).toMatchObject({
      status: 'blocked',
      blockers: [{ code: 'invalid_request' }],
    });
  });

  it('requires current human operational authorization for the exact executable intent', async () => {
    const fixture = admittedRunFixture();
    const request = { intent: fixture.intent, protocol: fixture.protocol };

    const omitted = await authorityService({
      ...fixture.evidence,
      operationalAuthorization: null as never,
    }).service.authorize(request);
    expect(omitted).toMatchObject({ status: 'blocked' });

    const wrongIntent = createAflTradeModelRunOperationalAuthorization({
      ...fixture.operationalAuthorization.content,
      runIntentId: `model-run-intent:${digest('f')}`,
    });
    const substituted = await authorityService({
      ...fixture.evidence,
      operationalAuthorization: wrongIntent,
    }).service.authorize(request);
    expect(substituted).toMatchObject({
      status: 'blocked',
      blockers: [{ code: 'operational_authorization_invalid' }],
    });

    const expired = createAflTradeModelRunOperationalAuthorization({
      ...fixture.operationalAuthorization.content,
      authorizedAt: '2026-08-10T00:02:00.000Z',
      validThrough: '2026-08-10T00:02:59.999Z',
    });
    const stale = await authorityService({
      ...fixture.evidence,
      operationalAuthorization: expired,
    }).service.authorize(request);
    expect(stale).toMatchObject({
      status: 'blocked',
      blockers: [{ code: 'operational_authorization_invalid' }],
    });

    expect(() =>
      createAflTradeModelRunOperationalAuthorization({
        ...fixture.operationalAuthorization.content,
        authorityEvidence: {
          ...fixture.operationalAuthorization.content.authorityEvidence,
          sha256: digest('0'),
        },
      })
    ).toThrow(/authority evidence/i);
  });

  it('creates exact local non-production authority through the fixed private valuation policy', () => {
    const fixture = admittedRunFixture();
    const policyAuthorization = createAflTradePrivateValuationModelRunOperationalAuthorization({
      runIntentId: fixture.intent.intentId,
      datasetId: fixture.intent.content.datasetId,
      datasetAdmissionId: fixture.intent.content.datasetAdmissionId,
      modelProtocolId: fixture.intent.content.modelProtocolId,
      observationSetId: fixture.intent.content.observationSetId,
      dispatchRequestId: `private-valuation-dispatch:${digest('d')}`,
      substantiveOperationId: `private-valuation-model-operation:${digest('e')}`,
      dispatchClaimId: `private-valuation-dispatch-claim:${digest('f')}`,
      dispatchAttemptNumber: 1,
      dispatchLeaseTokenSha256: digest('a'),
      factualOutputId: `private-valuation-factual-output:${digest('1')}`,
      hpnCalculationId: `hpn-pav-season:${digest('2')}`,
      factualValuesSha256: digest('3'),
      hpnValuesSha256: digest('4'),
      authorizedAt: fixture.intent.content.startedAt,
      validThrough: '2026-08-10T00:03:30.000Z',
    });

    expect(policyAuthorization.content).toMatchObject({
      authorityBoundary: 'policy_owned_local_private_valuation_for_one_exact_model_run_intent',
      principalRef: 'system:weekly-valuation-coordinator',
      role: 'afl_trade_private_evaluation_coordinator',
      environment: 'non_production',
      executionMode: 'local',
      publicationEligible: false,
      publicationProhibited: true,
    });
  });

  it('does not let callers override the private valuation policy authorization', () => {
    const fixture = admittedRunFixture();
    const input = {
      runIntentId: fixture.intent.intentId,
      datasetId: fixture.intent.content.datasetId,
      datasetAdmissionId: fixture.intent.content.datasetAdmissionId,
      modelProtocolId: fixture.intent.content.modelProtocolId,
      observationSetId: fixture.intent.content.observationSetId,
      dispatchRequestId: `private-valuation-dispatch:${digest('d')}`,
      substantiveOperationId: `private-valuation-model-operation:${digest('e')}`,
      dispatchClaimId: `private-valuation-dispatch-claim:${digest('f')}`,
      dispatchAttemptNumber: 1,
      dispatchLeaseTokenSha256: digest('a'),
      factualOutputId: `private-valuation-factual-output:${digest('1')}`,
      hpnCalculationId: `hpn-pav-season:${digest('2')}`,
      factualValuesSha256: digest('3'),
      hpnValuesSha256: digest('4'),
      authorizedAt: fixture.intent.content.startedAt,
      validThrough: '2026-08-10T00:03:30.000Z',
    };

    const authorization = createAflTradePrivateValuationModelRunOperationalAuthorization({
      ...input,
      principalRef: 'caller-controlled-principal',
      role: 'afl_trade_model_run_operator',
      environment: 'production',
      executionMode: 'remote',
      publicationEligible: true,
      publicationProhibited: false,
    } as never);
    expect(authorization.content).toMatchObject({
      principalRef: 'system:weekly-valuation-coordinator',
      role: 'afl_trade_private_evaluation_coordinator',
      environment: 'non_production',
      executionMode: 'local',
      publicationEligible: false,
      publicationProhibited: true,
    });
  });
});
