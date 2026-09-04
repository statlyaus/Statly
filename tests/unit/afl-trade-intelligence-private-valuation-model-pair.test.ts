import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  createAflTradeDispatchBoundAdmittedPlayerExecutor,
  createAflTradeDispatchBoundGovernedPickExecutor,
  createAflTradeDispatchBoundQualificationRegistrar,
} from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationModelPair';
import {
  createAflTradePrivateValuationModelOperation,
  createAflTradePrivateValuationModelPairCoordinator,
  type AflTradePrivateValuationModelOperationState,
  type AflTradePrivateValuationModelPairRepository,
} from '@/server/aflTradeIntelligence/valuation/privateValuationModelPair';
import { createGovernedValuationModelQualificationPolicy } from '@/server/aflTradeIntelligence/valuation/internal/governedValuationModelQualification';

import { createGovernedPickPavModelExecutionFixture } from '../testUtils/governedPickPavModelExecutionFixture';

const digest = (character: string) => character.repeat(64);
const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const id = (prefix: string, character: string) => `${prefix}:${digest(character)}`;

function exactInput(requestId = id('private-valuation-dispatch', '1')) {
  return {
    requestId,
    scopeKey: 'afl-men:2026-trades',
    factualOutputId: id('private-valuation-factual-output', '2'),
    hpnCalculationId: id('hpn-pav-season', '3'),
    substantive: {
      factualValuesSha256: digest('4'),
      hpnValuesSha256: digest('5'),
      hpnMethodId: id('hpn-pav-method', '6'),
      player: {
        modelId: 'player-value-model',
        modelVersion: '2026.08.1',
        protocolId: id('model-protocol', '7'),
        datasetId: id('dataset', '8'),
        datasetAdmissionId: id('dataset-admission', '9'),
      },
      pick: {
        protocolId: id('model-protocol', 'a'),
        datasetId: id('dataset', 'b'),
        datasetAdmissionId: id('dataset-admission', 'c'),
        policyId: id('pick-pav-policy', 'e'),
      },
      qualificationPolicyId: id('model-qualification-policy', 'd'),
    },
  } as const;
}

const claim = {
  claimId: id('private-valuation-dispatch-claim', 'e'),
  leaseToken: digest('f'),
};

class MemoryPairRepository implements AflTradePrivateValuationModelPairRepository {
  private readonly operations = new Map<string, AflTradePrivateValuationModelOperationState>();
  readonly requestOperations = new Map<string, string>();
  attemptNumber = 1;

  async bindInput(input: Parameters<AflTradePrivateValuationModelPairRepository['bindInput']>[0]) {
    const operation = createAflTradePrivateValuationModelOperation({
      scopeKey: input.exactInput.scopeKey,
      ...input.exactInput.substantive,
    });
    this.requestOperations.set(input.exactInput.requestId, operation.operationId);
    const retained = this.operations.get(operation.operationId) ?? {
      operation,
      attemptNumber: this.attemptNumber,
      playerRunId: null,
      pickRunId: null,
      pairAccepted: false,
      qualificationId: null,
      qualificationOutcome: null,
    };
    const claimed = { ...retained, attemptNumber: this.attemptNumber };
    this.operations.set(operation.operationId, claimed);
    return claimed;
  }

  async acceptComponent(
    input: Parameters<AflTradePrivateValuationModelPairRepository['acceptComponent']>[0]
  ) {
    const state = this.operations.get(input.operationId)!;
    const key = input.role === 'player' ? 'playerRunId' : 'pickRunId';
    const existing = state[key];
    if (existing !== null && existing !== input.runId) throw new Error('component conflict');
    const next = { ...state, [key]: input.runId };
    this.operations.set(input.operationId, next);
    return next;
  }

  async acceptPair(
    input: Parameters<AflTradePrivateValuationModelPairRepository['acceptPair']>[0]
  ) {
    const state = this.operations.get(input.operationId)!;
    if (state.playerRunId !== input.playerRunId || state.pickRunId !== input.pickRunId) {
      throw new Error('pair conflict');
    }
    const next = { ...state, pairAccepted: true };
    this.operations.set(input.operationId, next);
    return next;
  }

  async bindQualification(
    input: Parameters<AflTradePrivateValuationModelPairRepository['bindQualification']>[0]
  ) {
    const state = this.operations.get(input.operationId)!;
    const next = {
      ...state,
      qualificationId: input.qualificationId,
      qualificationOutcome: input.outcome,
    };
    this.operations.set(input.operationId, next);
    return next;
  }

  operation(operationId: string) {
    return this.operations.get(operationId)!;
  }
}

function coordinator(input?: {
  repository?: MemoryPairRepository;
  pickResults?: Array<'completed' | 'transient_failure'>;
  qualificationOutcome?: 'qualified' | 'failed';
  qualificationError?: 'deterministic_failure' | 'stale_authority';
}) {
  const repository = input?.repository ?? new MemoryPairRepository();
  const calls: string[] = [];
  const pickResults = [...(input?.pickResults ?? ['completed'])];
  return {
    repository,
    calls,
    value: createAflTradePrivateValuationModelPairCoordinator({
      prepareExactInput: async ({ requestId }) => {
        calls.push('prepare_input');
        return exactInput(requestId);
      },
      repository,
      executePlayer: async ({ exactInput: prepared, attemptNumber }) => {
        calls.push(
          `player:${attemptNumber}:${prepared.factualOutputId}:${prepared.hpnCalculationId}`
        );
        return { state: 'completed', runId: id('model-run', 'a') };
      },
      executePick: async ({ exactInput: prepared, attemptNumber }) => {
        calls.push(
          `pick:${attemptNumber}:${prepared.factualOutputId}:${prepared.hpnCalculationId}`
        );
        const result = pickResults.shift() ?? 'completed';
        return result === 'completed'
          ? { state: 'completed', runId: id('model-run', 'b') }
          : { state: 'transient_failure', reason: 'temporary executor outage' };
      },
      qualify: async ({ playerRunId, pickRunId }) => {
        calls.push(`qualify:${playerRunId}:${pickRunId}`);
        if (input?.qualificationError !== undefined) {
          return { state: input.qualificationError, reason: 'qualification input is invalid' };
        }
        return {
          qualificationId: id('model-qualification', 'c'),
          outcome: input?.qualificationOutcome ?? 'qualified',
        };
      },
    }),
  };
}

describe('private valuation dispatch-bound model pair', () => {
  it('composes the existing admitted player runner with fixed claim-bound policy authority', async () => {
    const preparedAuthorities: unknown[] = [];
    const runRequests: unknown[] = [];
    const intent = {
      intentId: id('model-run-intent', '1'),
      content: {
        environment: 'non_production',
        datasetId: exactInput().substantive.player.datasetId,
        datasetAdmissionId: exactInput().substantive.player.datasetAdmissionId,
        modelProtocolId: exactInput().substantive.player.protocolId,
        observationSetId: id('player-observation-set', '2'),
        startedAt: '2026-08-24T01:00:00.000Z',
      },
    };
    const operation = createAflTradePrivateValuationModelOperation({
      scopeKey: exactInput().scopeKey,
      ...exactInput().substantive,
    });
    const executor = createAflTradeDispatchBoundAdmittedPlayerExecutor({
      authorityPreparation: {
        async prepare(value) {
          preparedAuthorities.push(value.operationalAuthorization);
        },
      },
      admittedRunner: {
        async run(value) {
          runRequests.push(value);
          return {
            status: 'completed',
            authorization: {} as never,
            run: {
              runId: id('model-run', '3'),
              content: { outcome: { status: 'succeeded' } },
            } as never,
            blockers: [],
          };
        },
      },
      prepareRun: async () =>
        ({
          intent,
          protocol: { protocolId: exactInput().substantive.player.protocolId },
          observationSet: {},
          runStartEvaluationReceipts: [],
          validThrough: '2026-08-24T01:00:20.000Z',
        }) as never,
      registerComponent: async () => ({ runId: id('model-run', '4') }),
    });

    const result = await executor.execute({
      exactInput: exactInput(),
      operation,
      attemptNumber: 1,
      claim,
    });

    expect(result).toEqual({ state: 'completed', runId: id('model-run', '4') });
    expect(runRequests).toHaveLength(1);
    expect(preparedAuthorities).toMatchObject([
      {
        content: {
          dispatchRequestId: exactInput().requestId,
          substantiveOperationId: operation.operationId,
          dispatchClaimId: claim.claimId,
          dispatchAttemptNumber: 1,
          dispatchLeaseTokenSha256: sha256(claim.leaseToken),
          factualOutputId: exactInput().factualOutputId,
          hpnCalculationId: exactInput().hpnCalculationId,
          publicationProhibited: true,
        },
      },
    ]);
  });

  it('returns an exact retained player component without preparing or retraining', async () => {
    const operation = createAflTradePrivateValuationModelOperation({
      scopeKey: exactInput().scopeKey,
      ...exactInput().substantive,
    });
    const calls: string[] = [];
    const retainedRunId = id('model-run', '9');
    const executor = createAflTradeDispatchBoundAdmittedPlayerExecutor({
      loadRetainedComponent: async () => {
        calls.push('load_retained');
        return { runId: retainedRunId };
      },
      prepareRun: async () => {
        calls.push('prepare');
        throw new Error('retained replay must not prepare');
      },
      authorityPreparation: {
        async prepare() {
          calls.push('persist_authority');
        },
      },
      admittedRunner: {
        async run() {
          calls.push('fit');
          throw new Error('retained replay must not fit');
        },
      },
      registerComponent: async () => {
        calls.push('register');
        throw new Error('retained replay must not register');
      },
    });

    await expect(
      executor.execute({ exactInput: exactInput(), operation, attemptNumber: 2, claim })
    ).resolves.toEqual({ state: 'completed', runId: retainedRunId });
    expect(calls).toEqual(['load_retained']);
  });

  it('retains but does not register a player run that fails validation', async () => {
    const operation = createAflTradePrivateValuationModelOperation({
      scopeKey: exactInput().scopeKey,
      ...exactInput().substantive,
    });
    let registrations = 0;
    const executor = createAflTradeDispatchBoundAdmittedPlayerExecutor({
      authorityPreparation: { async prepare() {} },
      prepareRun: async () =>
        ({
          intent: {
            intentId: id('model-run-intent', '1'),
            content: {
              environment: 'non_production',
              datasetId: exactInput().substantive.player.datasetId,
              datasetAdmissionId: exactInput().substantive.player.datasetAdmissionId,
              modelProtocolId: exactInput().substantive.player.protocolId,
              observationSetId: id('player-observation-set', '2'),
              startedAt: '2026-08-24T01:00:00.000Z',
            },
          },
          protocol: { protocolId: exactInput().substantive.player.protocolId },
          observationSet: {},
          runStartEvaluationReceipts: [],
          validThrough: '2026-08-24T01:00:20.000Z',
        }) as never,
      admittedRunner: {
        async run() {
          return {
            status: 'completed',
            authorization: {} as never,
            run: {
              runId: id('model-run', '3'),
              content: { outcome: { status: 'failed' } },
            } as never,
            blockers: [],
          };
        },
      },
      registerComponent: async () => {
        registrations += 1;
        return { runId: id('model-run', '4') };
      },
    });

    await expect(
      executor.execute({ exactInput: exactInput(), operation, attemptNumber: 1, claim })
    ).resolves.toEqual({
      state: 'deterministic_failure',
      reason: 'Player candidate run failed before it could be accepted.',
    });
    expect(registrations).toBe(0);
  });

  it('runs and retains the existing governed pick execution with exact dispatch ancestry', async () => {
    const fixture = createGovernedPickPavModelExecutionFixture();
    const source = fixture.execution.content;
    const prepared = {
      outputs: {
        observationSet: source.observationSet,
        benchmarkConfig: source.benchmarkConfig,
        validationConfig: source.validationConfig,
        benchmark: source.benchmark,
        validationReport: source.validationReport,
      },
      completedAt: source.completedAt,
      registeredAt: '2015-01-03T00:00:02.000Z',
      authority: {
        datasetId: source.datasetId,
        datasetArtifact: source.datasetArtifact,
        datasetAdmissionId: source.datasetAdmissionId,
        datasetAdmissionArtifact: source.datasetAdmissionArtifact,
        datasetAdmissionGateLedgerRevision: source.datasetAdmissionGateLedgerRevision,
        protocolId: source.protocolId,
        protocolArtifact: source.protocolArtifact,
      },
    };
    const dispatchInput = {
      ...exactInput(),
      substantive: {
        ...exactInput().substantive,
        pick: {
          protocolId: source.protocolId,
          datasetId: source.datasetId,
          datasetAdmissionId: source.datasetAdmissionId,
          policyId: source.policyId,
        },
      },
    };
    const operation = createAflTradePrivateValuationModelOperation({
      scopeKey: dispatchInput.scopeKey,
      ...dispatchInput.substantive,
    });
    const retainedExecutions: unknown[] = [];
    const executor = createAflTradeDispatchBoundGovernedPickExecutor({
      runModel: async () => prepared,
      retainArtifact: async ({ document, createdAt }) =>
        createAflTradeCanonicalJsonArtifactRef(document, createdAt),
      executionRepository: {
        async register(value) {
          retainedExecutions.push(value.execution);
          return value;
        },
      },
      componentRepository: {
        async register(value) {
          return value;
        },
      },
    });

    const result = await executor.execute({
      exactInput: dispatchInput,
      operation,
      attemptNumber: 2,
      claim,
    });

    expect(result.state).toBe('completed');
    expect(retainedExecutions).toMatchObject([
      {
        content: {
          schemaVersion: 'afl-trade-pick-pav-model-execution/v4',
          privateInput: {
            requestId: dispatchInput.requestId,
            operationId: operation.operationId,
            claimId: claim.claimId,
            attemptNumber: 2,
            leaseTokenSha256: sha256(claim.leaseToken),
            factualOutputId: dispatchInput.factualOutputId,
            hpnCalculationId: dispatchInput.hpnCalculationId,
          },
        },
      },
    ]);
  });

  it('derives and registers qualification only for the accepted pair and operation policy', async () => {
    const evaluatedAt = '2026-08-24T02:00:00.000Z';
    const operation = createAflTradePrivateValuationModelOperation({
      scopeKey: exactInput().scopeKey,
      ...exactInput().substantive,
    });
    const policy = createGovernedValuationModelQualificationPolicy({
      player: {
        schemaVersion: 'governed-player-model-qualification-criteria/v1',
        minimumComparableObservations: 1,
        minimumRelativeMaeImprovement: 0.01,
        minimumRelativeRmseImprovement: 0.01,
        requiredAcceptanceOutcome: 'meets_declared_predictive_thresholds',
      },
      pick: {
        schemaVersion: 'governed-pick-model-qualification-criteria/v1',
        evaluatedScope: 'final_test',
        minimumObservations: 1,
        maximumMulticlassBrierScore: 0.1,
        maximumMulticlassLogLoss: 0.1,
        maximumRankedProbabilityScore: 0.1,
        maximumContributionCrps: 1,
        maximumMeanAbsoluteContributionError: 1,
        maximumRootMeanSquaredContributionError: 1,
        maximumMeanAbsoluteGamesError: 1,
        maximumRootMeanSquaredGamesError: 1,
        minimumEmpiricalP10P90Coverage: 0.7,
        maximumEmpiricalP10P90Coverage: 0.9,
        maximumMeanEmpiricalIntervalWidth: 1,
        maximumZeroProbabilityObservationCount: 0,
      },
    });
    const boundOperation = createAflTradePrivateValuationModelOperation({
      ...operation.content,
      qualificationPolicyId: policy.policyVersion,
    });
    const qualificationExactInput = {
      ...exactInput(),
      substantive: {
        ...exactInput().substantive,
        qualificationPolicyId: policy.policyVersion,
      },
    };
    const playerRunId = id('model-run', 'a');
    const pickRunId = id('model-run', 'b');
    const artifact = (value: unknown) => createAflTradeCanonicalJsonArtifactRef(value, evaluatedAt);
    const playerEvidence = {
      schemaVersion: 'governed-player-model-qualification-evidence/v1' as const,
      validationReportId: id('player-validation-report', '1'),
      comparableObservationCount: 2,
      acceptanceOutcome: 'meets_declared_predictive_thresholds' as const,
      relativeMaeImprovement: 0.02,
      relativeRmseImprovement: 0.02,
    };
    const pickEvidence = {
      schemaVersion: 'governed-pick-model-qualification-evidence/v1' as const,
      validationReportId: id('pick-pav-validation-report', '2'),
      evaluationStatus: 'scored_not_approved' as const,
      scope: 'final_test' as const,
      observationCount: 2,
      metrics: {
        multiclassBrierScore: 0.2,
        multiclassLogLoss: 0.2,
        rankedProbabilityScore: 0.2,
        contributionCrps: 2,
        meanAbsoluteContributionError: 2,
        rootMeanSquaredContributionError: 2,
        meanAbsoluteGamesError: 2,
        rootMeanSquaredGamesError: 2,
        empiricalP10P90Coverage: 0.8,
        meanEmpiricalIntervalWidth: 2,
        zeroProbabilityObservationCount: 0,
      },
    };
    const registered: unknown[] = [];
    const fences: unknown[] = [];
    const registrar = createAflTradeDispatchBoundQualificationRegistrar({
      prepareQualification: async () => ({
        environment: 'non_production',
        scopeKey: boundOperation.content.scopeKey,
        evaluatedAt,
        policy,
        policyArtifact: artifact(policy),
        components: {
          player: {
            role: 'player_contribution_and_availability',
            runId: playerRunId,
            runArtifact: artifact({ playerRunId }),
            protocolId: boundOperation.content.player.protocolId,
            protocolArtifact: artifact({ playerProtocol: true }),
            criteriaArtifact: artifact(policy.player),
            validationEvidence: playerEvidence,
            validationEvidenceArtifact: artifact(playerEvidence),
          },
          pick: {
            role: 'draft_pick_and_future_pick_distribution',
            runId: pickRunId,
            runArtifact: artifact({ pickRunId }),
            protocolId: boundOperation.content.pick.protocolId,
            protocolArtifact: artifact({ pickProtocol: true }),
            criteriaArtifact: artifact(policy.pick),
            validationEvidence: pickEvidence,
            validationEvidenceArtifact: artifact(pickEvidence),
          },
        },
      }),
      retainArtifact: async ({ document, createdAt }) =>
        createAflTradeCanonicalJsonArtifactRef(document, createdAt),
      prepareRegistration: async () => ({
        expectedGateLedgerRevision: 1,
        expectedCurrentRevision: 1,
      }),
      repository: {
        async register(value, options) {
          fences.push(options?.dispatchClaimFence);
          registered.push(value.qualification);
          return {
            status: 'failed_retained',
            qualification: value.qualification,
            current: null,
            idempotentReplay: false,
          };
        },
      },
    });

    const result = await registrar.register({
      exactInput: qualificationExactInput,
      operation: boundOperation,
      playerRunId,
      pickRunId,
      claim,
    });

    if (!('outcome' in result)) {
      throw new Error('Expected a retained qualification result.');
    }
    expect(result.outcome).toBe('failed');
    expect(fences).toEqual([
      {
        requestId: exactInput().requestId,
        claimId: claim.claimId,
        leaseTokenSha256: sha256(claim.leaseToken),
      },
    ]);
    expect(registered).toMatchObject([
      {
        content: {
          scopeKey: boundOperation.content.scopeKey,
          policy: { policyVersion: policy.policyVersion },
          player: { runId: playerRunId },
          pick: { runId: pickRunId },
        },
      },
    ]);
    await expect(
      registrar.register({
        exactInput: exactInput(),
        operation,
        playerRunId,
        pickRunId,
        claim,
      })
    ).resolves.toMatchObject({ state: 'deterministic_failure' });
  });

  it('classifies thrown deterministic adapter failures instead of leaking them into lease retry', async () => {
    const operation = createAflTradePrivateValuationModelOperation({
      scopeKey: exactInput().scopeKey,
      ...exactInput().substantive,
    });
    const execution = { exactInput: exactInput(), operation, attemptNumber: 1, claim };
    const player = createAflTradeDispatchBoundAdmittedPlayerExecutor({
      prepareRun: async () => {
        throw new TypeError('invalid player input');
      },
      authorityPreparation: {} as never,
      admittedRunner: {} as never,
      registerComponent: async () => {
        throw new Error('unreachable');
      },
    });
    const pick = createAflTradeDispatchBoundGovernedPickExecutor({
      runModel: async () => {
        throw new RangeError('invalid pick input');
      },
      retainArtifact: async () => {
        throw new Error('unreachable');
      },
      executionRepository: {} as never,
      componentRepository: {} as never,
    });
    const codedPick = (code: string) =>
      createAflTradeDispatchBoundGovernedPickExecutor({
        runModel: async () => {
          throw Object.assign(new Error(code), { code });
        },
        retainArtifact: async () => {
          throw new Error('unreachable');
        },
        executionRepository: {} as never,
        componentRepository: {} as never,
      });

    await expect(player.execute(execution)).resolves.toEqual({
      state: 'deterministic_failure',
      reason: 'invalid player input',
    });
    await expect(pick.execute(execution)).resolves.toEqual({
      state: 'deterministic_failure',
      reason: 'invalid pick input',
    });
    await expect(codedPick('READBACK_MISMATCH').execute(execution)).resolves.toMatchObject({
      state: 'deterministic_failure',
    });
    await expect(codedPick('08006').execute(execution)).resolves.toMatchObject({
      state: 'transient_failure',
    });
    await expect(codedPick('EAI_AGAIN').execute(execution)).resolves.toMatchObject({
      state: 'transient_failure',
    });
  });

  it('uses the exact private factual and HPN inputs and accepts one qualified pair', async () => {
    const fixture = coordinator();

    const result = await fixture.value.prepare({
      requestId: exactInput().requestId,
      claim,
    });

    expect(result).toMatchObject({ state: 'qualified', attemptNumber: 1 });
    expect(fixture.calls).toEqual([
      'prepare_input',
      `player:1:${exactInput().factualOutputId}:${exactInput().hpnCalculationId}`,
      `pick:1:${exactInput().factualOutputId}:${exactInput().hpnCalculationId}`,
      `qualify:${id('model-run', 'a')}:${id('model-run', 'b')}`,
    ]);
  });

  it('rejects a repository no-op instead of qualifying an unaccepted pair', async () => {
    const fixture = coordinator();
    const acceptPair = fixture.repository.acceptPair.bind(fixture.repository);
    fixture.repository.acceptPair = async (input) => ({
      ...(await acceptPair(input)),
      pairAccepted: false,
    });

    await expect(
      fixture.value.prepare({ requestId: exactInput().requestId, claim })
    ).rejects.toThrow('Private valuation pair was not accepted with the exact retained runs.');
  });

  it('rejects a repository no-op instead of returning a null qualification identity', async () => {
    const fixture = coordinator();
    const bindQualification = fixture.repository.bindQualification.bind(fixture.repository);
    fixture.repository.bindQualification = async (input) =>
      ({
        ...(await bindQualification(input)),
        qualificationId: null,
        qualificationOutcome: null,
      }) as never;

    await expect(
      fixture.value.prepare({ requestId: exactInput().requestId, claim })
    ).rejects.toThrow(
      'Private valuation qualification was not bound to the accepted pair exactly once.'
    );
  });

  it('retains a successful player output when the pick execution fails transiently', async () => {
    const fixture = coordinator({ pickResults: ['transient_failure', 'completed'] });
    const first = await fixture.value.prepare({ requestId: exactInput().requestId, claim });
    expect(first).toMatchObject({ state: 'transient_failure', attemptNumber: 1 });

    fixture.repository.attemptNumber = 2;
    const second = await fixture.value.prepare({ requestId: exactInput().requestId, claim });

    expect(second).toMatchObject({ state: 'qualified' });
    expect(fixture.calls.filter((entry) => entry.startsWith('player:'))).toHaveLength(1);
    expect(fixture.calls.filter((entry) => entry.startsWith('pick:'))).toHaveLength(2);
  });

  it('recovers after pair acceptance without rerunning either component', async () => {
    const fixture = coordinator();
    const operation = createAflTradePrivateValuationModelOperation({
      scopeKey: exactInput().scopeKey,
      ...exactInput().substantive,
    });
    await fixture.repository.bindInput({ exactInput: exactInput(), claim });
    await fixture.repository.acceptComponent({
      operationId: operation.operationId,
      role: 'player',
      runId: id('model-run', 'a'),
      claim,
    });
    await fixture.repository.acceptComponent({
      operationId: operation.operationId,
      role: 'pick',
      runId: id('model-run', 'b'),
      claim,
    });
    await fixture.repository.acceptPair({
      operationId: operation.operationId,
      playerRunId: id('model-run', 'a'),
      pickRunId: id('model-run', 'b'),
      claim,
    });

    const result = await fixture.value.prepare({ requestId: exactInput().requestId, claim });

    expect(result).toMatchObject({ state: 'qualified' });
    expect(fixture.calls).toEqual([
      'prepare_input',
      `qualify:${id('model-run', 'a')}:${id('model-run', 'b')}`,
    ]);
  });

  it('converges different request identities on substantive inputs and replays qualification', async () => {
    const fixture = coordinator();
    const first = await fixture.value.prepare({ requestId: exactInput().requestId, claim });
    const otherRequestId = createAflTradeContentAddress('private-valuation-dispatch', 'ad-hoc');
    const second = await fixture.value.prepare({ requestId: otherRequestId, claim });

    expect(second).toMatchObject({
      state: 'already_qualified',
      operationId: first.operationId,
    });
    expect(fixture.repository.requestOperations.get(otherRequestId)).toBe(first.operationId);
    expect(fixture.calls.filter((entry) => entry.startsWith('player:'))).toHaveLength(1);
    expect(fixture.calls.filter((entry) => entry.startsWith('pick:'))).toHaveLength(1);
    expect(fixture.calls.filter((entry) => entry.startsWith('qualify:'))).toHaveLength(1);
  });

  it('retains a failed qualification without reporting the pair as current', async () => {
    const fixture = coordinator({ qualificationOutcome: 'failed' });
    const result = await fixture.value.prepare({ requestId: exactInput().requestId, claim });

    expect(result).toMatchObject({
      state: 'qualification_failed',
      qualificationId: id('model-qualification', 'c'),
    });
    expect(fixture.repository.operation(result.operationId)).toMatchObject({
      pairAccepted: true,
      qualificationOutcome: 'failed',
    });
  });

  it('terminates deterministic qualification errors without binding or blind retry', async () => {
    const fixture = coordinator({ qualificationError: 'deterministic_failure' });
    const result = await fixture.value.prepare({ requestId: exactInput().requestId, claim });

    expect(result).toMatchObject({
      state: 'deterministic_failure',
      reason: 'qualification input is invalid',
    });
    expect(fixture.repository.operation(result.operationId).qualificationId).toBeNull();
  });
});
